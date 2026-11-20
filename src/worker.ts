// Chat Board worker: keeps the board in storage, lists chats through the orca CLI, tracks agent
// status from events, and answers the panel.
import type { OrcaWorkerApi } from 'orca/worker'
import type { AgentState, BoardState, BoardView, CardView, Column, GoalFile, JudgeCheck, JudgeNote, JudgeState } from './protocol.ts'
import {
  activeTabsByWorktree,
  adoptCard,
  setSessions,
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
  pressKeys,
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
import { newToken, openDoor, type OpenDoor, type RemoteDoor, type RemoteHandler } from './remote.ts'

/** Storage key of the token a board on another machine must send; there once that board asked. */
const REMOTE_TOKEN_KEY = 'remoteToken'
import { readWorkspaceStatusNames } from './profile.ts'
import { keysFor, looksBusy, menuOf, suggestionOf, type ScreenMenu } from './screen.ts'
import { applyWorkspaceStatuses, editSyncedColumns, moveWorkspaceCards } from './sync.ts'
import { changedFiles, changesNote, clipDiff, draftReply, isKorean, judgeArgs, judgePrompt, readJudgeOutput, tailOf } from './judge.ts'
import { folderIsHere, readTextFile, runTool } from './tools.ts'
import { GOAL_FILE, parseGoalFile } from './goal.ts'
import { joinPath, orcaRuntimeId } from './cli.ts'
import { readClaudeSessions, sessionSaved } from './sessions.ts'
import { keys, keysWhy, markedSpot, setMarkedSpot } from './keys.ts'
import { folderKey, normalizeSlash, readFolderCommands, readUserCommands, unique, type StoredSlash } from './slash.ts'

const BOARD_KEY = 'board'
/** Which run of Orca the board last listed chats from. */
const RUNTIME_KEY = 'orcaRun'
/** How often the Claude sessions of the open chats are read from Orca's hook database. */
const SESSIONS_EVERY_MS = 20_000
/** No more chats than this are opened again after Orca starts. */
const MAX_RESTORED = 12
const STATUS_KEY = 'status'
/** Where you last clicked in the panel (see keys.ts). */
const KEYS_SPOT_KEY = 'keysSpot'
const MONITORS_KEY = 'monitors'
/** Your commands and skills as last read from Claude's folders (see slash.ts). */
const SLASH_KEY = 'slashCommands'
/** While synced, light refreshes re-read the workspace statuses at most this often. */
const STATUS_POLL_MS = 10_000
/** A prompt sent from the reply box travels as one command-line argument. */
const MAX_PROMPT_CHARS = 8000
const MAX_IMAGES = 5
const ATTACH_SETTLE_MS = 600
/** How long a reopened Claude gets to show its prompt before /resume is typed anyway. */
const REOPEN_WAIT_MS = 12_000
const REOPEN_POLL_MS = 1500
/** Seen once: Orca refused that /resume with "terminal_not_writable". It is asked for a few times more. */
const REOPEN_SEND_RETRIES = 5
/** Terminal output this much newer than Orca's record of the chat: the record is behind. */
const STALE_RECORD_MS = 120_000
const MAX_SCREEN_CHARS = 20_000

/** A terminal with output this recent is doing something (the agent working, or you typing). */
const ACTIVE_MS = 6000
/** Output this long after Orca's record of a finished turn: worth a look at the screen. */
const STARTED_AFTER_MS = 10_000
/** A look at the screen that changed nothing is not repeated sooner than this. */
const PROBE_EVERY_MS = 5000
/** A terminal this long without output, while Orca says its agent works: worth a look at the screen. */
const STUCK_AFTER_MS = 8000
/** How often such a terminal is looked at again. (A working agent's spinner is output: its terminal is seldom this quiet.) */
const PROBE_STUCK_MS = 5000

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

/**
 * Where the chat's turn is, for its unseen mark. Orca says "working" while background shells or
 * subagents run on after the main agent's turn is over (its monitoring mode), but that turn's
 * answer is out and may be waiting for you: the main agent's state counts then (2026-11-20, a
 * checked chat asked a question at 9:50 with 2 agents still running, and no box opened).
 */
export function turnOf(state: AgentState, main: AgentState | null | undefined): AgentState {
  return state === 'working' && main && main !== 'working' ? main : state
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

  /** Every panel handler by name: the door for a board on another machine answers with the same ones. */
  const handlers = new Map<string, RemoteHandler>()
  const handle = ((name: string, fn: RemoteHandler) => {
    handlers.set(name, fn)
    return (orca.panels.handle as unknown as (name: string, fn: RemoteHandler) => unknown)(name, fn)
  }) as unknown as typeof orca.panels.handle
  /** The door, once it was asked for (now, or before this worker was loaded again). */
  let door: Promise<OpenDoor> | null = null
  /** The setting `remoteDoor`: off shuts the door and refuses to open it. */
  const doorAllowed = async (): Promise<boolean> => {
    try {
      return (await orca.settings.get('remoteDoor')) !== false
    } catch {
      return true
    }
  }
  const openRemote = (): Promise<OpenDoor> =>
    (door ??= (async () => {
      if (!(await doorAllowed())) throw new Error('The door for other machines is turned off in this Chat Board’s settings')
      let token = await orca.storage.get(REMOTE_TOKEN_KEY)
      if (typeof token !== 'string' || !token) await orca.storage.set(REMOTE_TOKEN_KEY, (token = newToken()))
      const opened = await openDoor(handlers, token as string)
      orca.log(`answering a board on another machine at ${opened.door.address}:${opened.door.port}`)
      return opened
    })().catch((err) => {
      door = null
      throw err
    }))
  const closeRemote = async (): Promise<void> => {
    const was = door
    door = null
    if (!was) return
    try {
      ;(await was).close()
      orca.log('the door for other machines is shut')
    } catch {
      // It never opened.
    }
  }
  const answerDoor = async (): Promise<RemoteDoor | { error: string }> => {
    try {
      return (await openRemote()).door
    } catch (err) {
      return { error: (err as Error).message }
    }
  }
  handle('remote.open', answerDoor)
  // A new token: whoever held the old one is shut out. A board on a paired machine asks again
  // through the orca CLI and goes on; anything else that had the token cannot.
  handle('remote.renew', async () => {
    await closeRemote()
    await orca.storage.set(REMOTE_TOKEN_KEY, newToken())
    return answerDoor()
  })
  // Asked for before: the door opens again with the worker, so that board goes on without asking.
  void orca.storage.get(REMOTE_TOKEN_KEY).then((token) => (token ? openRemote() : null)).catch(() => undefined)
  orca.settings.onDidChange(() => void doorAllowed().then((allowed) => (allowed ? null : closeRemote())))
  /** Tells every panel of a change: this Orca's, and the boards listening at the door. */
  const post = (name: 'board.changed', payload: BoardView): void => {
    orca.panels.post(name, payload)
    void door?.then((d) => d.tell(name, payload)).catch(() => undefined)
  }

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

  /**
   * A turn's end found in a listing before its event (events wait their turn behind a refresh):
   * the event then finds nothing new, so the end is noted here, by the same rule as for the
   * event: news unless it is a loop's run or you are looking at it.
   */
  async function noteStopped(state: BoardState, stopped: { key: string; handle: string; at: number }[]): Promise<BoardState> {
    let next = state
    for (const s of stopped) {
      const card = next.cards[s.key]
      if (!card || card.sessionId || (await liveMonitor(s.handle)) || (!card.watch && visible.has(s.key))) continue
      if (card.watch) orca.log(`checked chat ${s.key.slice(0, 8)}: working -> stopped, seen in a listing before its event`)
      next = markUnseen(next, [s.key], s.at || Date.now())
    }
    return next
  }

  /** Status from Orca's list of agents, which every refresh reads (the light ones too). */
  async function seedStatus(state: BoardState): Promise<BoardState> {
    try {
      const { agents } = await orca.host.call('agents.list')
      const status = await loadStatus()
      const stopped: { key: string; handle: string; at: number }[] = []
      for (const a of agents) {
        if (!a.terminalId) continue
        const prev = status[a.terminalId]
        if (prev && prev.at >= a.stateStartedAt) continue
        // This list does not tell the main agent's state: the one known is kept while the state holds.
        const main = prev && prev.state === a.state ? (prev.main ?? null) : null
        status[a.terminalId] = { state: a.state, at: a.stateStartedAt, outcome: null, main }
        const key = keyOfHandle(a.terminalId)
        // This list can be ahead of the event too (seen 2026-11-17: "done -> done, not news").
        if (key && prev && turnOf(prev.state, prev.main) === 'working' && turnOf(a.state, main) !== 'working') stopped.push({ key, handle: a.terminalId, at: a.stateStartedAt })
      }
      await orca.storage.set(STATUS_KEY, status)
      return await noteStopped(state, stopped)
    } catch (err) {
      orca.log(`agents.list failed: ${(err as Error).message}`)
      return state
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

  /** "Open last chats again" (a setting, off by default). */
  const restoreOn = async (): Promise<boolean> => {
    try {
      return (await orca.settings.get('restoreChats')) === true
    } catch {
      return false
    }
  }
  let sessionsAt = 0
  let sessionsError = ''
  /**
   * Remembers which Claude session each open terminal chat is, now and then. Whatever the setting:
   * a chat taken out of the archive by hand opens as itself too, and a chat closed before the
   * setting was turned on can still be brought back.
   */
  async function noteSessions(state: BoardState): Promise<BoardState> {
    if (Date.now() - sessionsAt < SESSIONS_EVERY_MS) return state
    sessionsAt = Date.now()
    try {
      const sessions = await readClaudeSessions()
      // A session with nothing said in it yet is not on disk and cannot be resumed: the card keeps
      // the conversation it had (a chat taken out of the archive, before one is picked) until then.
      for (const [tab, id] of Object.entries(sessions)) {
        const card = state.cards[tab]
        if (!card || card.closed || card.resume === id) continue
        if ((await sessionSaved(id)) === false) delete sessions[tab]
      }
      return setSessions(state, sessions)
    } catch (err) {
      const reason = (err as Error).message.split('\n')[0] ?? ''
      if (reason !== sessionsError) orca.log(`claude sessions not read: ${reason}`)
      sessionsError = reason
      return state
    }
  }
  /** The first listing of chats since this worker started is still to come. */
  let firstListing = true

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
          // Worth a line: a state taken from a listing is one its event will no longer report as a change.
          if (state.cards[tabId]?.watch && prev?.state !== a.state) orca.log(`checked chat ${tabId.slice(0, 8)}: ${prev?.state ?? 'no record'} -> ${a.state}, from a listing`)
          // This listing can be ahead of the event for the same change (events wait their turn
          // behind a refresh). The event then finds nothing new, so the turn's end is noted here.
          if (prev && turnOf(prev.state, prev.main) === 'working' && turnOf(a.state, main) !== 'working') stopped.push({ key: tabId, handle, at })
        }
        if (state.cards[tabId]?.sessionId) (a.activity?.unread ? unread : read).push(tabId)
      }
    }
    if (changed) await orca.storage.set(STATUS_KEY, status)
    // Chat tabs: Orca's own unread flag is the unseen mark (their focus cannot be read).
    return noteStopped(markUnseen(markUnseen(state, read, null), unread, Date.now()), stopped)
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
      // Orca's own "working" that its terminal no longer bears out: a session can stop reporting
      // in the middle of a turn too (seen 2026-11-17: Orca's record of a chat stayed at one tool
      // call for the rest of the day). Not Orca's monitoring mode, where a quiet terminal is the
      // rule: there the main agent's turn is over and Orca says so.
      const stuck = !!rec && rec.inferred !== true && rec.state === 'working' && (rec.main ?? 'working') === 'working' && now - out > STUCK_AFTER_MS
      const ending = (rec?.inferred === true && rec.state === 'working' && !active) || stuck
      const starting = (!rec || rec.state === 'done') && active && out - (rec?.at ?? 0) > STARTED_AFTER_MS
      if ((!ending && !starting) || now - (probedAt[handle] ?? 0) < (stuck ? PROBE_STUCK_MS : PROBE_EVERY_MS)) continue
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
        if (stuck) orca.log(`chat ${key.slice(0, 8)}: Orca still says working, its terminal has been quiet and idle: taken as done`)
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
      const wasOpen = Object.values(state.cards).filter((c) => !c.closed).map((c) => c.key)
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
      state = await noteSessions(state)
      lastError = null
      refreshedAt = Date.now()
      await orca.storage.set(BOARD_KEY, state)
      if (firstListing) {
        firstListing = false
        // The chats this listing found gone were open when the worker last looked: if Orca was
        // started again since, they are the ones it closed by quitting.
        const gone = wasOpen.filter((k) => state.cards[k]?.closed)
        setTimeout(() => void restoreAfterRestart(gone).catch((err) => orca.log(`restore failed: ${(err as Error).message.split('\n')[0]}`)), 0)
      }
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
    const seeded = await seedStatus(state)
    if (seeded !== state) await orca.storage.set(BOARD_KEY, seeded)
    return seeded
  }

  async function mutate(fn: (s: BoardState) => BoardState): Promise<BoardView> {
    return serial(async () => {
      if (refreshedAt === 0) await refresh()
      const next = fn(await loadBoard())
      await orca.storage.set(BOARD_KEY, next)
      const v = await view(next)
      post('board.changed', v)
      return v
    })
  }

  handle('board.get', (input) =>
    serial(async () => {
      if (input?.locale) locale = input.locale
      const state = input?.refresh || refreshedAt === 0 ? await refresh() : await loadBoard()
      return view(state)
    })
  )

  handle('board.move', async ({ key, column, index }) => {
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
  handle('board.columns.set', async ({ columns }) => {
    const synced = (await loadBoard()).synced === true && (await syncOn())
    return mutate((s) => setColumns(s, synced ? editSyncedColumns(s.columns, columns, workspaceStatus.values(), statusNames) : columns))
  })
  /** Re-lists and tells the panels; the sync setting changed, so the columns may be other ones now. */
  const resync = () =>
    serial(async () => {
      const v = await view(await refresh())
      post('board.changed', v)
      return v
    })
  handle('sync.set', async ({ on }) => {
    await orca.settings.set('syncWorkspaceBoard', on === true)
    return resync()
  })
  orca.settings.onDidChange(() => void resync())
  // Orca's CLI cannot change a plugin's settings: this turns one of its switches on or off
  // (`orca plugin dev request local.chat-board setting.set --data='{"key":"followChat","on":false}'`).
  handle('setting.set', async ({ key, on }) => {
    const switches = ['followChat', 'followNext', 'pinkWaiting', 'autoCheck', 'restoreChats', 'goalMode', 'autoMoveToInProgress', 'arrowsOpenReply', 'arrowsShowChat']
    if (typeof key !== 'string' || !switches.includes(key) || typeof on !== 'boolean') return { ok: false }
    await orca.settings.set(key, on)
    return { ok: true }
  })

  // The name of an open chat is its Orca tab's title: rename the tab, then re-list.
  handle('card.update', async (patch) => {
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

  handle('card.seen', ({ key }) => mutate((s) => markUnseen(s, [key], null)))
  // The panel has no log of its own: its notes about the reply boxes land in the plugin's log.
  handle('trace', ({ message }) => {
    orca.log(`panel: ${String(message).slice(0, 200)}`)
    return null
  })
  handle('card.delete', ({ key }) => mutate((s) => deleteCard(s, key)))
  handle('archive.clear', () => mutate(clearArchived))

  handle('seen.check', () =>
    serial(async () => {
      const before = await loadBoard()
      const wasVisible = visible
      const state = await refresh(false) // every 3 s: terminals only, chat tabs from the last full listing
      const v = await view(state)
      const cleared = Object.values(before.cards).some((c) => c.unseenAt && !state.cards[c.key]?.unseenAt)
      const moved = wasVisible.size !== visible.size || [...visible].some((k) => !wasVisible.has(k))
      if (cleared || moved) post('board.changed', v)
      return v
    })
  )

  // Hover preview: asked on demand, answered from Orca's agent record, kept nowhere.
  handle('chat.preview', async ({ key, screen }) => {
    const found = {
      prompt: null as string | null,
      message: null as string | null,
      at: null as number | null,
      screen: null as string | null,
      suggestion: null as string | null,
      menu: null as ScreenMenu | null
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
      // A list the screen asks you to pick from (resume or start anew, a permission, a question):
      // the box offers its options. What looks like a prompt on such a screen is the list's pointer.
      if (shown) found.menu = menuOf(shown.rows)
      if (shown && !found.menu) found.suggestion = suggestionOf(shown.rows, shown.draft)
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
  handle('attach.put', ({ id, type, data, at }) => ({
    result: putAttachment(String(id), String(type), String(data ?? ''), Date.now(), at === undefined || at === null ? undefined : Number(at))
  }))
  handle('attach.drop', ({ id }) => {
    dropAttachment(String(id))
    return null
  })

  handle('chat.send', async ({ key, text, images }) => {
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

  // Reply box: one option of the list on the chat's screen, picked by the keys you would press
  // there. The screen is read again first: the keys go out only while that option is still there.
  handle('menu.pick', async ({ key, index, label }) => {
    if (refreshedAt === 0) await serial(refresh)
    const handle = handles[key]
    const card = (await loadBoard()).cards[key]
    if (!handle || !card || card.closed) return { ok: false, error: 'closed' }
    if (card.sessionId) return { ok: false, error: 'chat-tab' }
    try {
      const { terminals } = await listTerminals()
      if (!terminals.some((t) => t.handle === handle && t.ptyId === card.ptyId)) return { ok: false, error: 'closed' }
      const menu = menuOf((await readTerminal(handle)).rows)
      const at = Number(index)
      if (!menu || !Number.isInteger(at) || menu.options[at] === undefined || menu.options[at] !== label) return { ok: false, error: 'changed' }
      for (const keys of keysFor(menu, at)) await pressKeys(handle, keys)
      orca.log(`menu of "${card.label || card.title || key}": picked ${at + 1} of ${menu.options.length} ("${String(label).slice(0, 60)}")`)
      return { ok: true, error: null }
    } catch (err) {
      const reason = (err as Error).message.split('\n').pop() ?? ''
      orca.log(`menu pick failed: ${reason}`)
      return { ok: false, error: reason }
    }
  })

  // Reply box: the commands the chat's Claude Code offers after "/", besides its built-in ones (which
  // the panel knows). Claude's folders are read the first time a list is asked for and when you
  // refresh it (then for every open chat's folder at once), never in between: what was read is kept.
  let slashTurn: Promise<unknown> = Promise.resolve()
  handle('commands.list', ({ key, refresh: again }) => {
    const answer = slashTurn.then(async () => {
      if (refreshedAt === 0) await serial(refresh)
      const host = { platform: process.platform, env: process.env }
      const here = (folder: string | undefined): folder is string => !!folder && folderIsHere(folder)
      const folder = here(folders[key]) ? folders[key]! : ''
      let kept = normalizeSlash(await orca.storage.get(SLASH_KEY))
      const listOf = (all: StoredSlash | null) => (all ? unique([...(all.folders[folderKey(host, folder)] ?? []), ...all.user]) : [])
      try {
        if (again === true || !kept) {
          const began = Date.now()
          const next: StoredSlash = { at: began, user: await readUserCommands(host), folders: {} }
          // A refresh reads for every open chat; the first reading only for the chat that asked.
          const wanted = again === true ? [...new Set([folder, ...Object.values(folders)].filter(here))] : folder ? [folder] : []
          for (const dir of wanted) next.folders[folderKey(host, dir)] ??= await readFolderCommands(host, dir)
          await orca.storage.set(SLASH_KEY, (kept = next))
          const own = Object.values(next.folders).reduce((n, list) => n + list.length, 0)
          orca.log(`commands for "/" read${again === true ? ' again' : ''}: ${next.user.length} of yours, ${own} in ${wanted.length} chat folder(s), ${Date.now() - began} ms`)
        } else if (folder && !kept.folders[folderKey(host, folder)]) {
          // A chat in a folder not read yet: that folder only, once.
          kept = { ...kept, folders: { ...kept.folders, [folderKey(host, folder)]: await readFolderCommands(host, folder) } }
          await orca.storage.set(SLASH_KEY, kept)
        }
      } catch (err) {
        const reason = (err as Error).message.split('\n')[0] ?? ''
        orca.log(`commands for "/" not read: ${reason}`)
        return { commands: listOf(kept), at: kept?.at ?? null, error: reason }
      }
      return { commands: listOf(kept), at: kept.at, error: null }
    })
    slashTurn = answer.catch(() => undefined)
    return answer
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
  handle('judge.run', ({ key }) => startJudge(String(key)))
  handle('judge.tally', async ({ key, how }) => {
    if (how === 'asIs' || how === 'edited' || how === 'dropped') await mutate((s) => tallyDraft(s, String(key), how))
    return null
  })

  // A chat archived from its card: its tab is closed in Orca (there is no card without a tab to
  // keep it on the board), and the next listing archives the card with its column and note.
  handle('chat.archive', async ({ key }) => {
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

  /**
   * Opens an archived Claude chat again in a new tab. With its session known, as that conversation;
   * otherwise with Claude's list of conversations to pick from. Answers once the tab is there.
   */
  async function reopenChat(key: string, focus: boolean): Promise<void> {
    const card = (await loadBoard()).cards[key]
    if (!card) return
    const handle = await launchAgent(card.worktreeId, 'claude', focus)
    let { terminals } = await listTerminals()
    // Launched while Orca's window is still starting, it may have no tab yet: given one.
    if (terminals.find((t) => t.handle === handle)?.orphaned) {
      await switchTerminal(handle).catch(() => undefined)
      ;({ terminals } = await listTerminals())
    }
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
      // A noted session that Claude does not have (anymore): its list to pick from, as without one.
      const known = !!card.resume && (await sessionSaved(card.resume)) !== false
      await sendToTerminal(handle, known ? `/resume ${card.resume}` : '/resume', REOPEN_SEND_RETRIES)
      await resync()
    })().catch((err) => orca.log(`reopen failed: ${(err as Error).message.split('\n').pop()}`))
  }

  /**
   * Orca was started again: the Claude chats that were open when it quit are opened again, each as
   * its own conversation, in the background. Only with the setting on, only chats whose session
   * the board had noted, and never after a mere reload of this worker (same run of Orca).
   */
  /** Gives each terminal that no tab holds a tab of its own (`terminal switch` does), then lists again. */
  async function adoptOrphans(): Promise<void> {
    const { terminals } = await listTerminals()
    const orphans = terminals.filter((t) => t.orphaned)
    if (!orphans.length) return
    for (const t of orphans) await switchTerminal(t.handle).catch(() => undefined)
    orca.log(`gave a tab to ${orphans.length} terminal(s) that had none`)
    await resync()
  }

  async function restoreAfterRestart(gone: string[]): Promise<void> {
    const run = orcaRuntimeId()
    if (!run) return
    const last = await orca.storage.get(RUNTIME_KEY)
    if (last === run) return
    await orca.storage.set(RUNTIME_KEY, run)
    // Orca started again with terminals of its last run (its daemon keeps them), and on 2026-11-19
    // left five of them out of its window: no tab, so the server's web client had none either and
    // the other machine's board could not show them. Each is given its tab (its card follows, by
    // its pty), now and a little later, should the window still be on its way.
    for (const wait of [0, 15_000, 60_000]) {
      setTimeout(() => void adoptOrphans().catch((err) => orca.log(`terminals without a tab not taken in: ${(err as Error).message.split('\n').pop()}`)), wait)
    }
    if (typeof last !== 'string' || !gone.length || !(await restoreOn())) return
    let opened = 0
    for (const key of gone) {
      const card = (await loadBoard()).cards[key]
      if (!card?.closed || !card.resume || card.sessionId || card.agent !== 'claude') continue
      if (opened >= MAX_RESTORED) break
      // Nothing to come back to: a tab with Claude's list in it would only be in the way.
      if ((await sessionSaved(card.resume)) === false) continue
      try {
        await reopenChat(key, false)
        opened++
      } catch (err) {
        orca.log(`restore of ${key.slice(0, 8)} failed: ${(err as Error).message.split('\n').pop()}`)
      }
    }
    if (opened) orca.log(`opened ${opened} chat(s) again after Orca restarted`)
  }

  // An archived Claude chat, opened again from its card: a new Claude tab in its workspace (started
  // by Orca, so its status is tracked). The archived card moves to the new tab with its note and check.
  handle('chat.reopen', async ({ key }) => {
    const card = (await loadBoard()).cards[key]
    if (!card || !card.closed) return { ok: false, error: 'open' }
    if (card.sessionId || card.agent !== 'claude') return { ok: false, error: 'unsupported' }
    try {
      await reopenChat(key, true)
      return { ok: true, error: null }
    } catch (err) {
      const reason = (err as Error).message.split('\n').pop() ?? ''
      orca.log(`reopen failed: ${reason}`)
      return { ok: false, error: reason }
    }
  })

  // Not through `handle`: a click on this machine is not for a board on another one to ask for.
  let ranOutLoggedAt = 0
  void orca.storage.get(KEYS_SPOT_KEY).then(setMarkedSpot).catch(() => undefined)
  orca.panels.handle('keys.click', async ({ op }) => {
    const ok = await keys(op)
    if (op === 'mark' && ok) void orca.storage.set(KEYS_SPOT_KEY, markedSpot()).catch(() => undefined)
    // Not each wait that ran out (a box goes on asking for as long as you are away): one a minute.
    const ranOut = op === 'move' && !ok && /^(given up|cancelled)/.test(keysWhy())
    if (ranOut && keysWhy() === 'cancelled') return { ok }
    if (ranOut && Date.now() - ranOutLoggedAt < 60_000) return { ok }
    if (ranOut) ranOutLoggedAt = Date.now()
    if (op !== 'warm' && op !== 'cancel' && (op !== 'mark' || !ok)) orca.log(`mouse for the reply box, ${op}: ${ok ? 'done' : `not done (${keysWhy()})`}`)
    return { ok }
  })

  // The keyboard from a terminal back to the board, with a shortcut you give this command in Orca
  // (`~/.orca/keybindings.json`: "plugin:local.chat-board/board.keys"), or from the command palette.
  // The panel does it (see `bringKeys`); a panel that is not open hears nothing.
  orca.commands.register('board.keys', () => {
    orca.log('command board.keys ran')
    orca.panels.post('keys.bring', null)
  })

  handle('chat.focus', async ({ key }) => {
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
        post('board.changed', await view(state))
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
      post('board.changed', await view(await loadBoard()))
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
      // The turn, not Orca's overall state: background work after the answer does not hold it back.
      const turn = turnOf(state, main)
      const was = prev ? turnOf(prev.state, prev.main) : undefined
      const said = (s: AgentState | undefined, m: AgentState | null | undefined) =>
        s === undefined ? 'no record' : turnOf(s, m) !== s ? `${turnOf(s, m)} (background still working)` : s
      const needsYou = was === 'working' && turn !== 'working' && !(await liveMonitor(terminalId))
      if (turn !== 'working' && !needsYou) {
        // Worth a line: a checked chat that stops without this being "news" opens no reply box.
        const k = keyOfHandle(terminalId)
        if (k && (await loadBoard()).cards[k]?.watch) orca.log(`checked chat ${k.slice(0, 8)}: ${said(prev?.state, prev?.main)} -> ${said(state, main)}, not news`)
        return
      }
      let board = await refresh()
      const key = keyOfHandle(terminalId)
      if (!key) return
      if (board.cards[key]?.watch) {
        orca.log(`checked chat ${key.slice(0, 8)}: ${said(prev?.state, prev?.main)} -> ${said(state, main)}${visible.has(key) ? ', on screen' : ''}`)
      }
      // A turn of a second or two: the listing just made for this "working" already has the turn's
      // end and marked it. This event is then the stale one, and must not take that mark away
      // (the end's own event will find nothing new and say nothing).
      const latest = (await loadStatus())[terminalId]
      const over = turn === 'working' && !!latest && turnOf(latest.state, latest.main) !== 'working'
      if (over) {
        if (board.cards[key]?.watch) orca.log(`checked chat ${key.slice(0, 8)}: that turn is over already, its mark stays`)
        post('board.changed', await view(board))
        return
      }
      let next =
        turn === 'working'
          ? markUnseen(board, [key], null)
          : visible.has(key) && !board.cards[key]?.watch
            ? board
            : markUnseen(board, [key], receivedAt)
      // The chat went on while a drafted reply was on offer: unless the board hears within a moment
      // that the reply just sent was that draft, it was not used.
      if (turn === 'working' && was !== 'working' && board.cards[key]?.judge?.draft && !board.cards[key]?.judge?.used) {
        setTimeout(() => void mutate((s) => dropUnusedDraft(s, key)).catch(() => undefined), DROP_AFTER_MS)
      }
      // You started talking to a Backlog chat (not a loop waking up by itself): it is in progress now.
      if (turn === 'working' && was !== 'working' && !(await liveMonitor(terminalId)) && (await autoMoveOn())) {
        next = startInProgress(next, key)
      }
      if (next !== board) {
        board = next
        await orca.storage.set(BOARD_KEY, board)
      }
      post('board.changed', await view(board))
    })
  )
}
