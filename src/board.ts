// Pure board logic: merging live terminals into the stored board, moving and editing cards.
import type { BoardState, Column, DraftTally, JudgeState, StoredCard } from './protocol.ts'

/** One row of `orca terminal list --json` (only the fields the board uses). */
export type LiveTerminal = {
  handle: string
  tabId: string
  ptyId: string
  worktreeId: string
  worktreePath: string
  title: string
  agentIdentity?: string | null
  lastOutputAt?: number | null
  /** The tab's title as Orca shows it (custom name when renamed), from the visual layouts. */
  tabTitle?: string | null
  /** An Orca chat tab (no terminal): its chat session id. */
  sessionId?: string | null
}

const COLUMN_TITLES = {
  en: { backlog: 'Backlog', doing: 'In progress', waiting: 'In review', done: 'Done' },
  es: { backlog: 'Backlog', doing: 'En curso', waiting: 'En revisión', done: 'Hecho' },
  ko: { backlog: '백로그', doing: '진행 중', waiting: '검토 중', done: '완료' }
}

/** Default columns, named in the UI language (Spanish for `es-*`, Korean for `ko-*`, English otherwise). */
export function defaultColumns(locale = 'en'): Column[] {
  const lang = locale.toLowerCase()
  const titles = lang.startsWith('es') ? COLUMN_TITLES.es : lang.startsWith('ko') ? COLUMN_TITLES.ko : COLUMN_TITLES.en
  return (['backlog', 'doing', 'waiting', 'done'] as const).map((id) => ({ id, title: titles[id] }))
}

export function emptyBoard(locale = 'en'): BoardState {
  return { version: 1, columns: defaultColumns(locale), cards: {} }
}

export function normalizeBoard(value: unknown, locale = 'en'): BoardState {
  const v = value as Partial<BoardState> | null
  if (!v || v.version !== 1 || !Array.isArray(v.columns) || v.columns.length === 0) return emptyBoard(locale)
  return { version: 1, columns: v.columns, cards: v.cards ?? {}, ...(v.synced === true ? { synced: true } : {}) }
}

/** Claude and Cursor prefix the tab title with a spinner glyph while working. */
export function cleanTitle(title: string): string {
  return title.replace(/^[\s✳✻✽✶✢·⠀-⣿]+/u, '').trim() || title
}

/** Last path segment; worktree paths use `\` on Windows and `/` elsewhere. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** One terminal per tab: the agent's pane when a tab is split. */
export function chatsOf(terminals: LiveTerminal[], includeShells = false): LiveTerminal[] {
  const byTab = new Map<string, LiveTerminal>()
  for (const t of terminals) {
    if (!includeShells && !t.agentIdentity) continue
    const prev = byTab.get(t.tabId)
    if (!prev || (!prev.agentIdentity && t.agentIdentity)) byTab.set(t.tabId, t)
  }
  return [...byTab.values()]
}

function nextOrder(state: BoardState, column: string): number {
  let max = -1
  for (const c of Object.values(state.cards)) if (c.column === column && c.order > max) max = c.order
  return max + 1
}

/**
 * Merges live chats into the board. New chats land at the end of the first column, chats that
 * are gone are archived (never dropped), and a chat whose tab id changed (Orca restart) is
 * matched back to its card by pty id, or by title within the same workspace.
 * Answers the new state and the live handle of each card key.
 */
export function mergeChats(
  prev: BoardState,
  chats: LiveTerminal[],
  now: number
): { state: BoardState; handles: Record<string, string>; lastOutput: Record<string, number> } {
  const state: BoardState = { ...prev, cards: { ...prev.cards } }
  const liveKeys = new Set(chats.map((t) => t.tabId))
  const handles: Record<string, string> = {}
  const lastOutput: Record<string, number> = {}
  const firstColumn = state.columns[0].id
  const columnIds = new Set(state.columns.map((c) => c.id))

  for (const t of chats) {
    const key = t.tabId
    let card = state.cards[key]
    if (!card) {
      const orphans = Object.values(state.cards).filter((c) => !liveKeys.has(c.key))
      const title = cleanTitle(t.tabTitle || t.title)
      const match =
        orphans.find((c) => c.ptyId === t.ptyId) ??
        orphans.find((c) => c.worktreeId === t.worktreeId && c.title === title && c.agent === (t.agentIdentity ?? null))
      if (match) {
        delete state.cards[match.key]
        card = { ...match, key }
      }
    }
    if (!card) {
      card = {
        key,
        column: firstColumn,
        order: nextOrder(state, firstColumn),
        label: '',
        note: '',
        title: '',
        agent: null,
        worktreeId: '',
        worktreeName: '',
        ptyId: '',
        closed: false,
        closedAt: null,
        unseenAt: null,
        addedAt: now
      }
    }
    state.cards[key] = {
      ...card,
      column: columnIds.has(card.column) ? card.column : firstColumn,
      title: cleanTitle(t.tabTitle || t.title),
      agent: t.agentIdentity ?? null,
      worktreeId: t.worktreeId,
      worktreeName: basename(t.worktreePath),
      ptyId: t.ptyId,
      sessionId: t.sessionId ?? null,
      closed: false,
      closedAt: null
    }
    handles[key] = t.handle
    if (typeof t.lastOutputAt === 'number') lastOutput[key] = t.lastOutputAt
  }

  for (const card of Object.values(state.cards)) {
    if (!liveKeys.has(card.key) && !card.closed) {
      state.cards[card.key] = { ...card, closed: true, closedAt: now }
    }
  }
  return { state, handles, lastOutput }
}

/**
 * Hands an archived card to the tab that reopens its chat: under the new tab's key it keeps its
 * column, note and check. A card the new tab already got on its own gives way.
 */
export function adoptCard(prev: BoardState, archivedKey: string, tabKey: string): BoardState {
  const card = prev.cards[archivedKey]
  if (!card || !card.closed || archivedKey === tabKey) return prev
  const cards = { ...prev.cards }
  delete cards[archivedKey]
  cards[tabKey] = { ...card, key: tabKey, closed: false, closedAt: null, unseenAt: null }
  return { ...prev, cards }
}

/** Puts `key` at `index` among the open cards of `column` and renumbers that column. */
export function moveCard(prev: BoardState, key: string, column: string, index: number): BoardState {
  const card = prev.cards[key]
  if (!card || !prev.columns.some((c) => c.id === column)) return prev
  const cards = { ...prev.cards }
  const siblings = Object.values(cards)
    .filter((c) => c.column === column && !c.closed && c.key !== key)
    .sort((a, b) => a.order - b.order)
  const at = Math.max(0, Math.min(index, siblings.length))
  siblings.splice(at, 0, { ...card, column })
  siblings.forEach((c, i) => (cards[c.key] = { ...c, order: i }))
  return { ...prev, cards }
}

export function setColumns(prev: BoardState, columns: Column[]): BoardState {
  const clean = columns
    .map((c) => {
      const col: Column = { id: String(c.id).trim(), title: String(c.title).trim() || String(c.id).trim() }
      if (c.collapsed === true) col.collapsed = true
      return col
    })
    .filter((c, i, all) => c.id && all.findIndex((x) => x.id === c.id) === i)
  if (clean.length === 0) return prev
  const ids = new Set(clean.map((c) => c.id))
  const first = clean[0].id
  const cards: Record<string, StoredCard> = {}
  let order = nextOrder({ ...prev, columns: clean }, first)
  for (const c of Object.values(prev.cards)) {
    cards[c.key] = ids.has(c.column) ? c : { ...c, column: first, order: order++ }
  }
  return { ...prev, columns: clean, cards }
}

export function updateCard(prev: BoardState, key: string, patch: { label?: string; note?: string; watch?: boolean; verify?: string }): BoardState {
  const card = prev.cards[key]
  if (!card) return prev
  const next = { ...card }
  if (typeof patch.label === 'string') next.label = patch.label.trim().slice(0, 200)
  if (typeof patch.note === 'string') next.note = patch.note.slice(0, 2000)
  if (patch.watch === true) next.watch = true
  else if (patch.watch === false) delete next.watch
  if (typeof patch.verify === 'string') {
    const verify = patch.verify.replace(/[\r\n]+/g, ' ').trim().slice(0, 500)
    if (verify) next.verify = verify
    else delete next.verify
  }
  return { ...prev, cards: { ...prev.cards, [key]: next } }
}

function tallied(drafts: DraftTally | undefined, how: keyof DraftTally): DraftTally {
  const next = { asIs: 0, edited: 0, dropped: 0, ...drafts }
  next[how] += 1
  return next
}

/**
 * Puts a review's state on its card. Another review over a draft nobody used just takes its place:
 * asking twice is not turning a draft down (see `dropUnusedDraft`).
 */
export function setJudge(prev: BoardState, key: string, judge: JudgeState): BoardState {
  const card = prev.cards[key]
  if (!card) return prev
  return { ...prev, cards: { ...prev.cards, [key]: { ...card, judge } } }
}

/**
 * The chat went on to another turn while a drafted reply was still on offer: the draft was not
 * used. Counted once; answers `prev` when there is no such draft.
 */
export function dropUnusedDraft(prev: BoardState, key: string): BoardState {
  const card = prev.cards[key]
  if (!card?.judge?.draft || card.judge.used) return prev
  return { ...prev, cards: { ...prev.cards, [key]: { ...card, judge: { ...card.judge, used: true }, drafts: tallied(card.drafts, 'dropped') } } }
}

/** You answered after a review: counts how its draft was used, once per review. */
export function tallyDraft(prev: BoardState, key: string, how: keyof DraftTally): BoardState {
  const card = prev.cards[key]
  if (!card?.judge?.draft || card.judge.used) return prev
  return { ...prev, cards: { ...prev.cards, [key]: { ...card, judge: { ...card.judge, used: true }, drafts: tallied(card.drafts, how) } } }
}

/** A review cannot outlive the worker that started it: what still says "running" was cut off. */
export function endRunningJudges(prev: BoardState): BoardState {
  let cards: Record<string, StoredCard> | null = null
  for (const card of Object.values(prev.cards)) {
    if (card.judge?.state !== 'running') continue
    cards ??= { ...prev.cards }
    cards[card.key] = { ...card, judge: { state: 'failed', at: card.judge.at, error: 'interrupted' } }
  }
  return cards ? { ...prev, cards } : prev
}

/** Sets or clears the unseen mark of the given cards; answers `prev` when nothing changes. */
export function markUnseen(prev: BoardState, keys: Iterable<string>, at: number | null): BoardState {
  let cards: Record<string, StoredCard> | null = null
  for (const key of keys) {
    const card = prev.cards[key]
    if (!card || (card.unseenAt ?? null) === at || (at !== null && card.unseenAt)) continue
    cards ??= { ...prev.cards }
    cards[key] = { ...card, unseenAt: at }
  }
  return cards ? { ...prev, cards } : prev
}

/** Tab ids shown in each workspace's split groups (`orca terminal list --include-visual-layouts`). */
export function activeTabsByWorktree(layouts: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  if (!Array.isArray(layouts)) return out
  for (const layout of layouts as { worktreeId?: string; root?: unknown }[]) {
    if (!layout?.worktreeId) continue
    const tabs = new Set<string>()
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(walk)
      const n = node as Record<string, unknown>
      if (typeof n.activeTabId === 'string') tabs.add(n.activeTabId)
      for (const [k, v] of Object.entries(n)) if (k !== 'tabs' && typeof v === 'object') walk(v)
    }
    walk(layout.root)
    out.set(layout.worktreeId, tabs)
  }
  return out
}

/** Tab titles by tab id, from `orca terminal list --include-visual-layouts`. */
export function tabTitlesOf(layouts: unknown): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    const n = node as Record<string, unknown>
    if (Array.isArray(n.tabs)) {
      for (const tab of n.tabs as Record<string, unknown>[]) {
        if (typeof tab?.tabId === 'string' && typeof tab.title === 'string' && tab.title.trim()) out.set(tab.tabId, tab.title)
      }
    }
    for (const [k, v] of Object.entries(n)) if (k !== 'tabs' && typeof v === 'object') walk(v)
  }
  walk(layouts)
  return out
}

/** Default column ids the auto-move rule relies on (titles can be renamed). */
export const BACKLOG_COLUMN = 'backlog'
export const IN_PROGRESS_COLUMN = 'doing'

/** Rule: a chat you start talking to leaves the Backlog for the end of In progress. No-op otherwise. */
export function startInProgress(prev: BoardState, key: string): BoardState {
  const card = prev.cards[key]
  if (!card || card.closed || card.column !== BACKLOG_COLUMN) return prev
  if (!prev.columns.some((c) => c.id === IN_PROGRESS_COLUMN)) return prev
  const count = Object.values(prev.cards).filter((c) => c.column === IN_PROGRESS_COLUMN && !c.closed).length
  return moveCard(prev, key, IN_PROGRESS_COLUMN, count)
}

/** Forgets every closed chat at once. */
export function clearArchived(prev: BoardState): BoardState {
  const cards: Record<string, StoredCard> = {}
  for (const c of Object.values(prev.cards)) if (!c.closed) cards[c.key] = c
  return { ...prev, cards }
}

export function deleteCard(prev: BoardState, key: string): BoardState {
  const card = prev.cards[key]
  if (!card || !card.closed) return prev
  const cards = { ...prev.cards }
  delete cards[key]
  return { ...prev, cards }
}

/** The chat tabs among Orca's agents (`orca worktree ps`): main agents whose tab is no terminal. */
export function chatTabsOf(
  worktrees: {
    worktreeId: string
    path: string
    agents?: {
      paneKey: string
      parentPaneKey?: string | null
      agentType?: string | null
      displayName?: string | null
      conversationName?: string | null
      prompt?: string | null
      hasLivePty?: boolean | null
      updatedAt?: number
      activity?: { title?: string | null } | null
    }[]
  }[],
  terminalTabs: Set<string>,
  chatPrefix: string
): LiveTerminal[] {
  const out = new Map<string, LiveTerminal>()
  for (const w of worktrees) {
    for (const a of w.agents ?? []) {
      const tabId = a.paneKey.split(':')[0]
      if (a.parentPaneKey || !tabId.startsWith(chatPrefix) || terminalTabs.has(tabId) || out.has(tabId)) continue
      const title = a.displayName || a.conversationName || a.activity?.title || a.prompt || 'Chat'
      out.set(tabId, {
        handle: tabId,
        tabId,
        ptyId: tabId,
        worktreeId: w.worktreeId,
        worktreePath: w.path,
        title,
        tabTitle: title,
        agentIdentity: a.agentType ?? null,
        lastOutputAt: a.updatedAt ?? null,
        sessionId: tabId.slice(chatPrefix.length)
      })
    }
  }
  return [...out.values()]
}
