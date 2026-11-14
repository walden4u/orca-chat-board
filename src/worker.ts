// Chat Board worker: keeps the board in storage, lists chats through the orca CLI, tracks agent
// status from events, and answers the panel.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentState, BoardState, BoardView, CardView, Column, GoalFile, JudgeCheck, JudgeNote, JudgeState } from './protocol.ts'
import {
  activeTabsByWorktree,
  adoptCard,
  chatsOf,
  chatTabsOf,
  tabTitlesOf,
  clearArchived,
  deleteCard,
  dropUnusedDraft,
  endRunningJudges,
  markUnseen,
  mergeChats,
  moveCard,
  normalizeBoard,
  setColumns,
  setJudge,
  startInProgress,
  tallyDraft,
  updateCard,
  type LiveTerminal
} from './board.ts'
import {
  activateWorktree,
  launchAgent,
  CHAT_TAB_PREFIX,
  closeTerminalTab,
  listAgents,
  listTerminals,
  listWorkspaceStatuses,
  pasteIntoTerminal,
  pressEnter,
  readTerminal,
  readTerminalScreen,
  renameChat,
  renameTerminal,
  sendToTerminal,
  setWorkspaceStatus,
  switchTerminal,
  type PsWorktree
} from './cli.ts'
import { applyToolCall, monitorView, onRun, type StoredMonitor } from './monitor.ts'
import { dropAttachment, putAttachment, saveAttachment } from './attach.ts'
import { readWorkspaceStatusNames } from './profile.ts'
import { looksBusy, suggestionOf } from './screen.ts'
import { applyWorkspaceStatuses, editSyncedColumns, moveWorkspaceCards } from './sync.ts'
import { changedFiles, changesNote, clipDiff, draftReply, isKorean, judgeArgs, judgePrompt, readJudgeOutput, tailOf } from './judge.ts'
import { folderIsHere, readTextFile, runTool } from './tools.ts'
import { GOAL_FILE, parseGoalFile } from './goal.ts'
import { joinPath } from './cli.ts'

const BOARD_KEY = 'board'
const STATUS_KEY = 'status'
const MONITORS_KEY = 'monitors'
/** While synced, light refreshes re-read the workspace statuses at most this often. */
const STATUS_POLL_MS = 10_000
/** A prompt sent from the reply box travels as one command-line argument. */
const MAX_PROMPT_CHARS = 8000
const MAX_IMAGES = 5
const ATTACH_SETTLE_MS = 600
/** How long a reopened Claude gets to show its prompt before /resume is typed anyway. */
const REOPEN_WAIT_MS = 12_000
const REOPEN_POLL_MS = 1500
/** Terminal output this much newer than Orca's record of the chat: the record is behind. */
const STALE_RECORD_MS = 120_000
const MAX_SCREEN_CHARS = 20_000

/** A terminal with output this recent is doing something (the agent working, or you typing). */
const ACTIVE_MS = 6000
/** Output this long after Orca's record of a finished turn: worth a look at the screen. */
const STARTED_AFTER_MS = 10_000
/** A look at the screen that changed nothing is not repeated sooner than this. */
const PROBE_EVERY_MS = 5000

/**
 * How the judge runs: the cheapest model that passed the check in docs/auto-reply-research.md.
 * A review there took about 12 seconds and 3 cents; the caps are for a folder with far more to read.
 */
const JUDGE = { model: 'sonnet', effort: 'medium', budgetUsd: 0.5 }
const JUDGE_TIMEOUT_MS = 300_000
const GIT_TIMEOUT_MS = 15_000
/** A card's check command (a test run, say) gets this long. */
const CHECK_TIMEOUT_MS = 300_000
/** A reply sent from the board reaches the chat before the board hears how its draft was used: the count waits this long. */
const DROP_AFTER_MS = 3000
/** How much of a GOAL.md the judge is handed: far more than a checklist needs. */
const MAX_GOAL_CHARS = 12_000

type Status = {
  state: AgentState
  at: number
  outcome?: string | null
  main?: AgentState | null
  /** Read off the terminal's screen, because Orca reported nothing for this turn. */
  inferred?: boolean
}

export default function activate(orca: OrcaWorkerApi): void {
  /** Live handle and last output of each card key, from the latest listing. */
  let handles: Record<string, string> = {}
  let lastOutput: Record<string, number> = {}
  let lastError: string | null = null
  let refreshedAt = 0
  /** Chat tabs from the last `orca worktree ps`, reused by light refreshes. */
  let lastChatTabs: ReturnType<typeof chatTabsOf> = []
  /** Tab ids on screen in the focused workspace at the last listing. */
  let visible = new Set<string>()
  /** The folder each chat works in, by card key, from the latest listing. */
  let folders: Record<string, string> = {}
  /** The chat a judge is reviewing right now: one review at a time. */
  let judging: string | null = null
  /** The checklist (GOAL.md) of each chat's folder, by folder, as read at the latest listing with goal mode on. */
  let goals: Record<string, GoalFile | null> = {}
  /** Workspace statuses from the last `orca worktree list`, by worktree id (only read while synced). */
  let workspaceStatus = new Map<string, string>()
  let workspaceStatusAt = 0
  /** Orca's statuses with their names, from its profile; null while they cannot be read. */
  let statusNames: Column[] | null = null
  let statusNamesError = ''

  // Every read-modify-write of storage goes through this queue.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  /** UI language of the last panel that asked; only names the default columns of a new board. */
  let locale = 'en'
  const loadBoard = async (): Promise<BoardState> => normalizeBoard(await orca.storage.get(BOARD_KEY), locale)
  const loadStatus = async (): Promise<Record<string, Status>> =>
    ((await orca.storage.get(STATUS_KEY)) as Record<string, Status> | null) ?? {}
  /** Monitors by terminal handle. */
  const loadMonitors = async (): Promise<Record<string, StoredMonitor>> =>
    ((await orca.storage.get(MONITORS_KEY)) as Record<string, StoredMonitor> | null) ?? {}
  const liveMonitor = async (handle: string): Promise<boolean> => {
    const m = (await loadMonitors())[handle]
    return !!m && monitorView(m, Date.now())?.stale === false
  }

  async function view(state: BoardState): Promise<BoardView> {
    const status = await loadStatus()
    const monitors = await loadMonitors()
    const now = Date.now()
    const cards: CardView[] = Object.values(state.cards).map((c) => {
      const handle = c.closed ? null : (handles[c.key] ?? null)
      const s = handle ? status[handle] : undefined
      const m = handle ? monitors[handle] : undefined
      return {
        ...c,
        handle,
        state: s?.state ?? null,
        stateAt: s?.at ?? null,
        mainState: s?.main ?? null,
        outcome: s?.outcome ?? null,
        lastOutputAt: lastOutput[c.key] ?? null,
        monitor: m ? monitorView(m, now) : null,
        active: !c.closed && visible.has(c.key),
        goalFile: c.closed ? null : (goals[folders[c.key] ?? ''] ?? null)
      }
    })
    const synced = state.synced === true
    return { columns: state.columns, cards, refreshedAt, error: lastError, synced, orcaNames: synced && statusNames !== null }
  }

  async function seedStatus(): Promise<void> {
    try {
      const { agents } = await orca.host.call('agents.list')
      const status = await loadStatus()
      for (const a of agents) {
        if (!a.terminalId) continue
        const prev = status[a.terminalId]
        if (!prev || prev.at < a.stateStartedAt) status[a.terminalId] = { state: a.state, at: a.stateStartedAt, outcome: null }
      }
      await orca.storage.set(STATUS_KEY, status)
    } catch (err) {
      orca.log(`agents.list failed: ${(err as Error).message}`)
    }
  }

  /** Tabs on screen: the active tab of each split group in the focused workspace. */
  async function visibleTabs(terminals: { handle: string; worktreeId: string }[], layouts: unknown): Promise<Set<string>> {
    try {
      const ctx = await orca.host.call('workspace.readContext')
      const ids = new Set((ctx?.terminals ?? []).map((t) => t.id))
      const focused = terminals.find((t) => ids.has(t.handle))?.worktreeId
      return (focused && activeTabsByWorktree(layouts).get(focused)) || new Set()
    } catch (err) {
      orca.log(`workspace.readContext failed: ${(err as Error).message}`)
      return new Set()
    }
  }

  const autoMoveOn = async (): Promise<boolean> => {
    try {
      return (await orca.settings.get('autoMoveToInProgress')) !== false
    } catch {
      return true
    }
  }

  const syncOn = async (): Promise<boolean> => {
    try {
      return (await orca.settings.get('syncWorkspaceBoard')) === true
    } catch {
      return false
    }
  }

  /** Synced: columns and card columns follow the workspaces' statuses. Not synced: the board is its own. */
  async function applySync(state: BoardState, full: boolean): Promise<BoardState> {
    if (!(await syncOn())) return state.synced ? { ...state, synced: false } : state
    if (full || Date.now() - workspaceStatusAt > STATUS_POLL_MS) {
      try {
        workspaceStatus = await listWorkspaceStatuses()
        workspaceStatusAt = Date.now()
      } catch (err) {
        orca.log(`worktree list failed: ${(err as Error).message.split('\n')[0]}`)
      }
      try {
        statusNames = await readWorkspaceStatusNames()
        statusNamesError = ''
      } catch (err) {
        // The board keeps the names it has, and they can be edited here again.
        statusNames = null
        const reason = (err as Error).message.split('\n')[0] ?? ''
        if (reason !== statusNamesError) orca.log(`status names not read from Orca's profile: ${reason}`)
        statusNamesError = reason
      }
    }
    // Nothing read yet: leave the board alone rather than rebuild its columns from nothing.
    return workspaceStatusAt === 0 ? state : applyWorkspaceStatuses(state, workspaceStatus, statusNames)
  }

  const keyOfHandle = (handle: string) => Object.keys(handles).find((k) => handles[k] === handle) ?? null

  /** Status and Orca's own unread flag from `orca worktree ps`, for every agent tab it tracks. */
  async function applyPs(state: BoardState, ps: PsWorktree[]): Promise<BoardState> {
    const status = await loadStatus()
    let changed = false
    const unread: string[] = []
    const read: string[] = []
    const stopped: { key: string; handle: string; at: number }[] = []
    for (const w of ps) {
      for (const a of w.agents ?? []) {
        if (a.parentPaneKey) continue
        const tabId = a.paneKey.split(':')[0]
        const handle = handles[tabId]
        if (!handle) continue
        const at = a.stateStartedAt ?? a.updatedAt ?? 0
        const prev = status[handle]
        // Orca's record fills cards that never got a status event (e.g. sessions started earlier).
        const main = (a as { mainAgent?: { state?: AgentState } }).mainAgent?.state ?? null
        if (!prev || prev.at < at || (prev.at === at && (prev.main ?? null) !== main)) {
          status[handle] = { state: a.state, at, outcome: a.interrupted ? 'interruption' : null, main }
          changed = true
          // This listing can be ahead of the event for the same change (events wait their turn
          // behind a refresh). The event then finds nothing new, so the turn's end is noted here.
          if (prev?.state === 'working' && a.state !== 'working') stopped.push({ key: tabId, handle, at })
        }
        if (state.cards[tabId]?.sessionId) (a.activity?.unread ? unread : read).push(tabId)
      }
    }
    if (changed) await orca.storage.set(STATUS_KEY, status)
    // Chat tabs: Orca's own unread flag is the unseen mark (their focus cannot be read).
    let next = markUnseen(markUnseen(state, read, null), unread, Date.now())
    // The same rule as for the event: news unless it is a loop's run or you are looking at it.
    for (const s of stopped) {
      const card = next.cards[s.key]
      if (!card || card.sessionId || (await liveMonitor(s.handle)) || (!card.watch && visible.has(s.key))) continue
      if (card.watch) orca.log(`checked chat ${s.key.slice(0, 8)}: working -> stopped, seen in a listing before its event`)
      next = markUnseen(next, [s.key], s.at || Date.now())
    }
    return next
  }

  /** When a terminal's screen was last read without learning anything, to keep those reads rare. */
  const probedAt: Record<string, number> = {}

  /**
   * Status for the chats Orca has lost track of. Some sessions stop reporting to Orca (ones that
   * were open when it restarted, say): Orca's record stays at an old "done" while the agent goes
   * on working in its terminal. Their terminal still tells: fresh output plus a busy screen is a
   * turn running, and a quiet terminal with no busy screen is that turn over. The screen is read
   * only when the output and the record disagree, and a real event from Orca always wins.
   */
  async function inferStatus(state: BoardState, terminals: LiveTerminal[]): Promise<BoardState> {
    const status = await loadStatus()
    const now = Date.now()
    let changed = false
    for (const [key, handle] of Object.entries(handles)) {
      const card = state.cards[key]
      const term = terminals.find((t) => t.handle === handle)
      if (!card || card.closed || card.sessionId || !term) continue
      const out = term.lastOutputAt ?? 0
      const rec = status[handle]
      const active = now - out < ACTIVE_MS
      const ending = rec?.inferred === true && rec.state === 'working' && !active
      const starting = (!rec || rec.state === 'done') && active && out - (rec?.at ?? 0) > STARTED_AFTER_MS
      if ((!ending && !starting) || now - (probedAt[handle] ?? 0) < PROBE_EVERY_MS) continue
      let busy: boolean
      try {
        busy = looksBusy(await readTerminalScreen(handle))
      } catch {
        continue
      }
      if (starting && busy) {
        status[handle] = { state: 'working', at: now, outcome: null, main: null, inferred: true }
        state = markUnseen(state, [key], null)
        if (!(await liveMonitor(handle)) && (await autoMoveOn())) state = startInProgress(state, key)
      } else if (ending && !busy) {
        status[handle] = { state: 'done', at: out || now, outcome: null, main: null, inferred: true }
        // The same rule as for a turn Orca reports: news unless it is a loop's run or you are looking at it.
        if (!(await liveMonitor(handle)) && (card.watch || !visible.has(key))) state = markUnseen(state, [key], out || now)
      } else {
        // You typing, or the agent thinking quietly: look again later.
        probedAt[handle] = now
        continue
      }
      delete probedAt[handle]
      changed = true
    }
    if (changed) await orca.storage.set(STATUS_KEY, status)
    return state
  }

  /** Lists chats and merges them; `withAgents` also asks `orca worktree ps` (chat tabs, status). */
  async function refresh(withAgents = true): Promise<BoardState> {
    let state = await loadBoard()
    try {
      const { terminals, layouts } = await listTerminals()
      const titles = tabTitlesOf(layouts)
      const withTabTitles = terminals.map((t) => ({ ...t, tabTitle: titles.get(t.tabId) ?? null }))
      let ps: PsWorktree[] | null = null
      if (withAgents) {
        try {
          ps = await listAgents()
          lastChatTabs = chatTabsOf(ps, new Set(terminals.map((t) => t.tabId)), CHAT_TAB_PREFIX)
        } catch (err) {
          orca.log(`worktree ps failed: ${(err as Error).message.split('\n')[0]}`)
        }
      }
      const chats = [...chatsOf(withTabTitles), ...lastChatTabs]
      const merged = mergeChats(state, chats, Date.now())
      state = merged.state
      handles = merged.handles
      lastOutput = merged.lastOutput
      folders = Object.fromEntries(chats.map((t) => [t.tabId, t.worktreePath]))
      goals = (await goalModeOn()) ? Object.fromEntries([...new Set(Object.values(folders))].map((folder) => [folder, goalIn(folder)])) : {}
      // A review still marked as running, with no judge at work: the worker was reloaded under it.
      if (!judging) state = endRunningJudges(state)
      visible = await visibleTabs(terminals, layouts)
      // A chat on screen counts as seen. Not a checked one: its reply box is where you read it,
      // and the tab on screen may just be the one you left open while working from the board.
      state = markUnseen(state, [...visible].filter((k) => !state.cards[k]?.watch), null)
      if (ps) state = await applyPs(state, ps)
      state = await inferStatus(state, terminals)
      state = await applySync(state, withAgents)
      lastError = null
      refreshedAt = Date.now()
      await orca.storage.set(BOARD_KEY, state)
      // Forget status of terminals that no longer exist.
      const live = new Set(Object.values(handles))
      const status = await loadStatus()
      for (const h of Object.keys(status)) if (!live.has(h)) delete status[h]
      await orca.storage.set(STATUS_KEY, status)
      const monitors = await loadMonitors()
      const now = Date.now()
      let dropped = false
      for (const [h, m] of Object.entries(monitors)) {
        if (!live.has(h) || !monitorView(m, now)) {
          delete monitors[h]
          dropped = true
        }
      }
      if (dropped) await orca.storage.set(MONITORS_KEY, monitors)
    } catch (err) {
      lastError = (err as Error).message.split('\n')[0]
      orca.log(`terminal list failed: ${lastError}`)
    }
    await seedStatus()
    return state
  }

  async function mutate(fn: (s: BoardState) => BoardState): Promise<BoardView> {
    return serial(async () => {
      if (refreshedAt === 0) await refresh()
      const next = fn(await loadBoard())
      await orca.storage.set(BOARD_KEY, next)
      const v = await view(next)
      orca.panels.post('board.changed', v)
      return v
    })
  }

  orca.panels.handle('board.get', (input) =>
    serial(async () => {
      if (input?.locale) locale = input.locale
      const state = input?.refresh || refreshedAt === 0 ? await refresh() : await loadBoard()
      return view(state)
    })
  )

  orca.panels.handle('board.move', async ({ key, column, index }) => {
    const board = await loadBoard()
    const card = board.cards[key]
    const synced = board.synced === true && (await syncOn())
    if (!synced || !card || card.column === column) return mutate((s) => moveCard(s, key, column, index))
    // Another column is another workspace status: set it in Orca first, the board follows.
    if (!workspaceStatus.has(card.worktreeId) || !board.columns.some((c) => c.id === column)) return mutate((s) => s)
    const previous = workspaceStatus.get(card.worktreeId)!
    try {
      await setWorkspaceStatus(card.worktreeId, column)
      workspaceStatus.set(card.worktreeId, column)
    } catch (err) {
      orca.log(`workspace status failed: ${(err as Error).message.split('\n').pop()}`)
      // Orca kept the id it did not know: put the workspace back where it was.
      if ((err as { code?: unknown }).code === 'unknown_status') await setWorkspaceStatus(card.worktreeId, previous).catch(() => undefined)
      return mutate((s) => s)
    }
    return mutate((s) => moveWorkspaceCards(s, key, column, index))
  })
  orca.panels.handle('board.columns.set', async ({ columns }) => {
    const synced = (await loadBoard()).synced === true && (await syncOn())
    return mutate((s) => setColumns(s, synced ? editSyncedColumns(s.columns, columns, workspaceStatus.values(), statusNames) : columns))
  })
  /** Re-lists and tells the panels; the sync setting changed, so the columns may be other ones now. */
  const resync = () =>
    serial(async () => {
      const v = await view(await refresh())
      orca.panels.post('board.changed', v)
      return v
    })
  orca.panels.handle('sync.set', async ({ on }) => {
    await orca.settings.set('syncWorkspaceBoard', on === true)
    return resync()
  })
  orca.settings.onDidChange(() => void resync())

  // The name of an open chat is its Orca tab's title: rename the tab, then re-list.
  orca.panels.handle('card.update', async (patch) => {
    const handle = handles[patch.key]
    const sessionId = (await loadBoard()).cards[patch.key]?.sessionId
    if (typeof patch.label === 'string' && handle && (!sessionId || patch.label.trim())) {
      try {
        if (sessionId) await renameChat(sessionId, patch.label.trim())
        else await renameTerminal(handle, patch.label.trim())
        const { label: _label, ...rest } = patch
        await serial(refresh)
        return mutate((s) => updateCard(s, patch.key, { ...rest, label: '' }))
      } catch (err) {
        orca.log(`terminal rename failed: ${(err as Error).message}`)
      }
    }
    return mutate((s) => updateCard(s, patch.key, patch))
  })

  orca.panels.handle('card.seen', ({ key }) => mutate((s) => markUnseen(s, [key], null)))
  // The panel has no log of its own: its notes about the reply boxes land in the plugin's log.
  orca.panels.handle('trace', ({ message }) => {
    orca.log(`panel: ${String(message).slice(0, 200)}`)
    return null
  })
  orca.panels.handle('card.delete', ({ key }) => mutate((s) => deleteCard(s, key)))
  orca.panels.handle('archive.clear', () => mutate(clearArchived))

  orca.panels.handle('seen.check', () =>
    serial(async () => {
      const before = await loadBoard()
      const wasVisible = visible
      const state = await refresh(false) // every 3 s: terminals only, chat tabs from the last full listing
      const v = await view(state)
      const cleared = Object.values(before.cards).some((c) => c.unseenAt && !state.cards[c.key]?.unseenAt)
      const moved = wasVisible.size !== visible.size || [...visible].some((k) => !wasVisible.has(k))
      if (cleared || moved) orca.panels.post('board.changed', v)
      return v
    })
  )

  // Hover preview: asked on demand, answered from Orca's agent record, kept nowhere.
  orca.panels.handle('chat.preview', async ({ key, screen }) => {
    const found = {
      prompt: null as string | null,
      message: null as string | null,
      at: null as number | null,
      screen: null as string | null,
      suggestion: null as string | null
    }
    try {
      // The reply box also asks for the terminals (their last output tells whether Orca's record is
      // behind) and for this chat's screen: what the agent suggests as your next prompt is on it.
      const handle = screen ? handles[key] : undefined
      const [agents, live, shown] = await Promise.all([
        listAgents(),
        screen ? listTerminals().catch(() => null) : null,
        handle ? readTerminal(handle).catch(() => null) : null
      ])
      if (shown) found.suggestion = suggestionOf(shown.rows, shown.draft)
      for (const w of agents) {
        for (const a of w.agents ?? []) {
          if (a.parentPaneKey || a.paneKey.split(':')[0] !== key) continue
          found.prompt = a.prompt || null
          found.message = a.lastAssistantMessage || null
          found.at = a.updatedAt ?? null
        }
      }
      // Some sessions stop reporting to Orca (started before it restarted, say) and their record
      // stays at an old exchange while the terminal goes on. Then the screen itself is the news.
      const term = live?.terminals.find((t) => t.handle === handles[key])
      if (term && shown && (term.lastOutputAt ?? 0) - (found.at ?? 0) > STALE_RECORD_MS) {
        const rows = [...shown.rows]
        while (rows.length && !rows[rows.length - 1]!.trim()) rows.pop()
        found.screen = rows.map((r) => r.trimEnd()).join('\n').slice(-MAX_SCREEN_CHARS) || null
      }
    } catch (err) {
      orca.log(`preview failed: ${(err as Error).message.split('\n')[0]}`)
    }
    return found
  })

  // Reply box: what you typed goes to that chat's terminal as your prompt. Nothing else ever sends input.
  // Pictures pasted into the reply box arrive in pieces and wait here until Send.
  orca.panels.handle('attach.put', ({ id, type, data }) => ({ result: putAttachment(String(id), String(type), String(data ?? ''), Date.now()) }))
  orca.panels.handle('attach.drop', ({ id }) => {
    dropAttachment(String(id))
    return null
  })

  orca.panels.handle('chat.send', async ({ key, text, images }) => {
    const prompt = typeof text === 'string' ? text.trim().slice(0, MAX_PROMPT_CHARS) : ''
    const pictures = Array.isArray(images) ? images.filter((id): id is string => typeof id === 'string').slice(0, MAX_IMAGES) : []
    if (!prompt && !pictures.length) return { ok: false, error: 'empty' }
    if (refreshedAt === 0) await serial(refresh)
    const handle = handles[key]
    const card = (await loadBoard()).cards[key]
    if (!handle || !card || card.closed) return { ok: false, error: 'closed' }
    if (card.sessionId) return { ok: false, error: 'chat-tab' }
    try {
      // Checked against a fresh listing: the chat must still be that terminal. Asked directly and
      // not through the refresh queue, which can be seconds behind while you wait on Send.
      const { terminals } = await listTerminals()
      if (!terminals.some((t) => t.handle === handle && t.ptyId === card.ptyId)) return { ok: false, error: 'closed' }
      // Pictures first: each one's path is pasted into the agent's input, which attaches the image.
      const host = { platform: process.platform, env: process.env }
      for (const id of pictures) {
        const path = saveAttachment(id, host, Date.now())
        if (!path) return { ok: false, error: 'image-lost' }
        await pasteIntoTerminal(handle, path)
      }
      // The agent reads a pasted picture before it shows in the input; Enter must come after that.
      if (pictures.length) await new Promise((done) => setTimeout(done, ATTACH_SETTLE_MS))
      if (prompt) await sendToTerminal(handle, prompt)
      else await pressEnter(handle)
      return { ok: true, error: null }
    } catch (err) {
      const reason = (err as Error).message.split('\n').pop() ?? ''
      orca.log(`send failed: ${reason}`)
      return { ok: false, error: reason }
    }
  })

  // ---------- goal mode: the goal file, and the judge ----------

  /** Goal mode is a setting, off by default: while off, no goal file is read and no judge runs. */
  const goalModeOn = async (): Promise<boolean> => {
    try {
      return (await orca.settings.get('goalMode')) === true
    } catch {
      return false
    }
  }

  /** The checklist of a chat's folder, or null when the folder has no GOAL.md (or is not on this machine). */
  function goalIn(folder: string): GoalFile | null {
    const text = folder ? readTextFile(joinPath({ platform: process.platform, env: process.env }, folder, GOAL_FILE)) : null
    return text === null ? null : parseGoalFile(text)
  }

  /**
   * What a git command printed, or null when it failed (no git, not a repository, no such commit).
   * Git only reads here: without its optional locks, `git status` does not even refresh the index.
   */
  async function gitText(folder: string, args: string[]): Promise<string | null> {
    try {
      const r = await runTool('git', ['--no-optional-locks', ...args], { cwd: folder, timeoutMs: GIT_TIMEOUT_MS })
      return r.code === 0 ? r.stdout : null
    } catch {
      return null
    }
  }

  /**
   * What changed in a chat's folder, for the judge: since the commit that added GOAL.md when there
   * is one (`base`), else what is not committed yet, else (nothing uncommitted) the last commit.
   */
  async function changesIn(folder: string, base: string | null): Promise<{ files: string[]; diff: string | null; notes: JudgeNote[] }> {
    if ((await gitText(folder, ['rev-parse', '--is-inside-work-tree']))?.trim() !== 'true') return { files: [], diff: null, notes: ['no-git'] }
    const notes: JudgeNote[] = []
    const porcelain = (await gitText(folder, ['status', '--porcelain', '--untracked-files=all'])) ?? ''
    const from = base && (await gitText(folder, ['cat-file', '-e', `${base}^{commit}`])) !== null ? base : 'HEAD'
    let names = (await gitText(folder, ['diff', '--name-only', from])) ?? ''
    let diff = (await gitText(folder, ['diff', '--no-color', from])) ?? ''
    if (from === 'HEAD' && !names.trim() && !porcelain.trim()) {
      names = (await gitText(folder, ['show', '--name-only', '--format=', 'HEAD'])) ?? ''
      diff = (await gitText(folder, ['show', '--no-color', '--format=%h %s', 'HEAD'])) ?? ''
      if (diff.trim()) notes.push('last-commit')
    }
    const clipped = clipDiff(diff)
    if (clipped.cut) notes.push('diff-cut')
    return { files: changedFiles(names, porcelain), diff: clipped.text.trim() ? clipped.text : null, notes }
  }

  /** One review: gathers what was asked and what changed, runs the judge in the chat's folder, reads its answer. */
  async function runJudge(key: string, folder: string, started: number): Promise<JudgeState> {
    const board = await loadBoard()
    const card = board.cards[key]
    if (!card) return { state: 'failed', at: started, error: 'closed' }
    // The goal is the folder's GOAL.md, as it is now. Work on it began with the commit that added the file.
    const goalText = readTextFile(joinPath({ platform: process.platform, env: process.env }, folder, GOAL_FILE))
    const added = goalText === null ? null : (await gitText(folder, ['log', '--diff-filter=A', '--format=%H', '-1', '--', GOAL_FILE]))?.trim() || null
    const base = added && /^[0-9a-f]{7,64}$/i.test(added) ? added : null
    const [agents, changes] = await Promise.all([listAgents().catch(() => [] as PsWorktree[]), changesIn(folder, base)])
    let prompt: string | null = null
    let claim: string | null = null
    for (const w of agents) {
      for (const a of w.agents ?? []) {
        if (a.parentPaneKey || a.paneKey.split(':')[0] !== key) continue
        prompt = a.prompt || null
        claim = a.lastAssistantMessage || null
      }
    }
    const goal = goalText?.trim().slice(0, MAX_GOAL_CHARS) || null
    // Nothing says what was asked: there is nothing to judge the work against.
    if (!goal && !prompt) return { state: 'failed', at: started, error: 'nothing' }
    const notes: JudgeNote[] = [...changes.notes]
    if (!goal) notes.push('no-goal')
    if (Object.values(board.cards).some((c) => c.key !== key && !c.closed && c.worktreeId === card.worktreeId)) notes.push('shared-folder')
    // The check command GOAL.md names (its `verify:` line, written by the agent with the plan):
    // run here, because the judge can run nothing.
    let check: JudgeCheck | undefined
    const command = goalText !== null ? parseGoalFile(goalText).verify : undefined
    if (command) {
      const began = Date.now()
      try {
        const ran = await runTool('shell', [command], { cwd: folder, timeoutMs: CHECK_TIMEOUT_MS })
        check = { command, code: ran.code, ms: Date.now() - began, tail: tailOf(`${ran.stdout}${ran.stderr ? `\n${ran.stderr}` : ''}`) }
      } catch (err) {
        check = { command, code: null, ms: Date.now() - began, tail: (err as Error).message.split('\n')[0] ?? '' }
      }
    }
    const run = await runTool('claude', judgeArgs(JUDGE), {
      cwd: folder,
      input: judgePrompt({ goal, prompt, claim, files: changes.files, diff: changes.diff, diffNote: changesNote(notes), check }),
      timeoutMs: JUDGE_TIMEOUT_MS
    })
    const read = readJudgeOutput(run.stdout)
    const ms = Date.now() - started
    // What is kept of the check is enough to show; the judge had the longer end of it.
    const kept = check ? { ...check, tail: check.tail.slice(-1500) } : undefined
    if (!read.verdict) return { state: 'failed', at: started, error: read.error ?? 'failed', costUsd: read.costUsd, ms, notes, ...(kept ? { check: kept } : {}) }
    return { state: 'done', at: started, verdict: read.verdict, draft: draftReply(read.verdict, isKorean(goal, prompt)), costUsd: read.costUsd, ms, notes, ...(kept ? { check: kept } : {}) }
  }

  /** Starts a review and answers at once; its result reaches the panels with a board update. */
  async function startJudge(key: string): Promise<{ ok: boolean; error: string | null }> {
    if (!(await goalModeOn())) return { ok: false, error: 'off' }
    if (refreshedAt === 0) await serial(refresh)
    const card = (await loadBoard()).cards[key]
    if (!card || card.closed) return { ok: false, error: 'closed' }
    if (judging) return { ok: false, error: 'busy' }
    const folder = folders[key]
    if (!folder || !folderIsHere(folder)) return { ok: false, error: 'no-folder' }
    judging = key
    const started = Date.now()
    await mutate((s) => setJudge(s, key, { state: 'running', at: started }))
    void runJudge(key, folder, started)
      .catch((err): JudgeState => ({ state: 'failed', at: started, error: (err as Error).message.split('\n')[0] || 'failed', ms: Date.now() - started }))
      .then(async (result) => {
        const said = result.state === 'done' ? `${result.verdict?.verdict}, ${result.verdict?.mustFix.length ?? 0} to fix` : `failed (${result.error})`
        const cost = typeof result.costUsd === 'number' ? `, $${result.costUsd.toFixed(3)}` : ''
        orca.log(`judge ${key.slice(0, 8)}: ${said} in ${Math.round((result.ms ?? 0) / 1000)} s${cost}`)
        await mutate((s) => setJudge(s, key, result))
      })
      .catch((err) => orca.log(`judge result not kept: ${(err as Error).message.split('\n')[0]}`))
      .finally(() => {
        judging = null
      })
    return { ok: true, error: null }
  }

  // A review by the judge, asked for in a reply box. It sends nothing to the chat: the judge reads
  // the chat's folder, and what it finds is offered in the reply box as a draft you send or not.
  orca.panels.handle('judge.run', ({ key }) => startJudge(String(key)))
  orca.panels.handle('judge.tally', async ({ key, how }) => {
    if (how === 'asIs' || how === 'edited' || how === 'dropped') await mutate((s) => tallyDraft(s, String(key), how))
    return null
  })

  // A chat archived from its card: its tab is closed in Orca (there is no card without a tab to
  // keep it on the board), and the next listing archives the card with its column and note.
  orca.panels.handle('chat.archive', async ({ key }) => {
    if (refreshedAt === 0) await serial(refresh)
    const handle = handles[key]
    const card = (await loadBoard()).cards[key]
    if (!handle || !card || card.closed) return { ok: false, error: 'closed' }
    if (card.sessionId) return { ok: false, error: 'chat-tab' }
    try {
      // Checked against a fresh listing: the tab that closes must still be this chat's.
      const { terminals } = await listTerminals()
      if (!terminals.some((t) => t.handle === handle && t.ptyId === card.ptyId)) return { ok: false, error: 'closed' }
      await closeTerminalTab(handle)
      await resync()
      return { ok: true, error: null }
    } catch (err) {
      const reason = (err as Error).message.split('\n').pop() ?? ''
      orca.log(`archive failed: ${reason}`)
      return { ok: false, error: reason }
    }
  })

  // An archived Claude chat, opened again: a new Claude tab in its workspace (started by Orca, so
  // its status is tracked) showing Claude's own list of conversations to resume. You pick there;
  // nothing is chosen for you. The archived card moves to the new tab with its note and check.
  orca.panels.handle('chat.reopen', async ({ key }) => {
    const card = (await loadBoard()).cards[key]
    if (!card || !card.closed) return { ok: false, error: 'open' }
    if (card.sessionId || card.agent !== 'claude') return { ok: false, error: 'unsupported' }
    try {
      const handle = await launchAgent(card.worktreeId, 'claude')
      const { terminals } = await listTerminals()
      const tab = terminals.find((t) => t.handle === handle)?.tabId
      if (tab) await mutate((s) => adoptCard(s, key, tab))
      // The rest takes Claude's start-up time, longer than a panel waits for an answer: it goes on
      // after this one. Claude's prompt on the screen says it is ready for a command.
      void (async () => {
        for (let waited = 0; waited < REOPEN_WAIT_MS; waited += REOPEN_POLL_MS) {
          await new Promise((done) => setTimeout(done, REOPEN_POLL_MS))
          const rows = await readTerminalScreen(handle).catch(() => [])
          if (rows.some((row) => /^[❯›>]/.test(row))) break
        }
        await sendToTerminal(handle, '/resume')
        await resync()
      })().catch((err) => orca.log(`reopen failed: ${(err as Error).message.split('\n').pop()}`))
      return { ok: true, error: null }
    } catch (err) {
      const reason = (err as Error).message.split('\n').pop() ?? ''
      orca.log(`reopen failed: ${reason}`)
      return { ok: false, error: reason }
    }
  })

  orca.panels.handle('chat.focus', async ({ key }) => {
    let handle = handles[key]
    if (!handle) {
      await serial(refresh)
      handle = handles[key]
    }
    if (!handle) return { ok: false, error: 'closed' }
    const card = (await loadBoard()).cards[key]
    if (card?.sessionId) {
      // Orca cannot focus a chat tab from outside yet: show its workspace instead.
      try {
        await activateWorktree(card.worktreeId)
        return { ok: true, error: 'chat-workspace' }
      } catch (err) {
        return { ok: false, error: (err as Error).message.split('\n')[0] }
      }
    }
    try {
      await switchTerminal(handle)
      visible = new Set([key])
      void mutate((s) => markUnseen(s, [key], null))
      return { ok: true, error: null }
    } catch (err) {
      // The handle may be stale (terminal restarted): list again and retry once.
      await serial(refresh)
      const fresh = handles[key]
      if (fresh && fresh !== handle) {
        try {
          await switchTerminal(fresh)
          return { ok: true, error: null }
        } catch {}
      }
      return { ok: false, error: (err as Error).message.split('\n')[0] }
    }
  })

  // Terminals opened, closed or renamed, or focus moved: re-list, debounced.
  let timer: ReturnType<typeof setTimeout> | null = null
  orca.events.on('workspace.changed', () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void serial(async () => {
        const state = await refresh()
        orca.panels.post('board.changed', await view(state))
      })
    }, 400)
  })

  // Loops, schedules and background watchers, recognised from the tools the agent calls.
  orca.hooks.on('agent.tool.after', (event) => {
    const handle = event.terminalId
    if (!handle) return
    void serial(async () => {
      const monitors = await loadMonitors()
      const next = applyToolCall(monitors[handle] ?? null, event, Date.now())
      if (next === undefined) return
      if (next) monitors[handle] = next
      else if (monitors[handle]) delete monitors[handle]
      else return
      await orca.storage.set(MONITORS_KEY, monitors)
      orca.panels.post('board.changed', await view(await loadBoard()))
    })
  })

  orca.events.on('agent.status.changed', ({ terminalId: termId, paneKey, state, receivedAt, mainAgent }) =>
    serial(async () => {
      // A chat tab has no terminal: its tab id (the paneKey's first part) is its handle.
      const chatTab = paneKey.split(':')[0]
      const terminalId = termId ?? (chatTab.startsWith(CHAT_TAB_PREFIX) ? chatTab : undefined)
      if (!terminalId) return
      const status = await loadStatus()
      const prev = status[terminalId]
      const outcome = mainAgent?.outcome ?? null
      const main = mainAgent?.state ?? null
      if (prev && prev.state === state && (prev.outcome ?? null) === outcome && (prev.main ?? null) === main) return
      status[terminalId] = {
        state,
        at: prev && prev.state === state ? prev.at : (mainAgent?.stateStartedAt ?? receivedAt),
        outcome,
        main
      }
      await orca.storage.set(STATUS_KEY, status)

      // A turn of a loop or schedule is its sign of life.
      if (state === 'working') {
        const monitors = await loadMonitors()
        if (monitors[terminalId]) {
          monitors[terminalId] = onRun(monitors[terminalId], receivedAt)
          await orca.storage.set(MONITORS_KEY, monitors)
        }
      }

      // Unseen mark: set when an agent stops working while you are not looking at it,
      // cleared as soon as it works again.
      // A loop finishing one of its runs is not news.
      const needsYou = prev?.state === 'working' && state !== 'working' && !(await liveMonitor(terminalId))
      if (state !== 'working' && !needsYou) {
        // Worth a line: a checked chat that stops without this being "news" opens no reply box.
        const k = keyOfHandle(terminalId)
        if (k && (await loadBoard()).cards[k]?.watch) orca.log(`checked chat ${k.slice(0, 8)}: ${prev?.state ?? 'no record'} -> ${state}, not news`)
        return
      }
      let board = await refresh()
      const key = keyOfHandle(terminalId)
      if (!key) return
      if (board.cards[key]?.watch) {
        orca.log(`checked chat ${key.slice(0, 8)}: ${prev?.state ?? 'no record'} -> ${state}${visible.has(key) ? ', on screen' : ''}`)
      }
      let next =
        state === 'working'
          ? markUnseen(board, [key], null)
          : visible.has(key) && !board.cards[key]?.watch
            ? board
            : markUnseen(board, [key], receivedAt)
      // The chat went on while a drafted reply was on offer: unless the board hears within a moment
      // that the reply just sent was that draft, it was not used.
      if (state === 'working' && prev?.state !== 'working' && board.cards[key]?.judge?.draft && !board.cards[key]?.judge?.used) {
        setTimeout(() => void mutate((s) => dropUnusedDraft(s, key)).catch(() => undefined), DROP_AFTER_MS)
      }
      // You started talking to a Backlog chat (not a loop waking up by itself): it is in progress now.
      if (state === 'working' && prev?.state !== 'working' && !(await liveMonitor(terminalId)) && (await autoMoveOn())) {
        next = startInProgress(next, key)
      }
      if (next !== board) {
        board = next
        await orca.storage.set(BOARD_KEY, board)
      }
      orca.panels.post('board.changed', await view(board))
    })
  )
}
