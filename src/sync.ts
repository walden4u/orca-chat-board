// Pure logic for keeping the board in step with Orca's Workspace Board: columns are workspace
// statuses, and every chat of a workspace sits in the column of that workspace's status.
import type { BoardState, Column, StoredCard } from './protocol.ts'
import { moveCard } from './board.ts'

/** Orca's built-in statuses, in board order. Custom ones (`status-5`…) only have an id here. */
export const DEFAULT_STATUSES: readonly Column[] = [
  { id: 'todo', title: 'Todo' },
  { id: 'in-progress', title: 'In progress' },
  { id: 'in-review', title: 'In review' },
  { id: 'completed', title: 'Done' }
]

/**
 * The columns of a synced board: the ones it already has (their order, title and collapse are
 * yours), then any built-in status and any status in use that is missing. Orca does not tell
 * plugins the names of custom statuses, so those start titled by their id.
 */
export function syncColumns(prev: Column[], inUse: Iterable<string>): Column[] {
  const out = prev.map((c) => ({ ...c }))
  const have = new Set(out.map((c) => c.id))
  const add = (col: Column) => {
    if (have.has(col.id)) return
    have.add(col.id)
    out.push({ ...col })
  }
  DEFAULT_STATUSES.forEach(add)
  for (const id of inUse) if (id) add({ id, title: id })
  return out
}

/** The columns the panel may save while synced: reorder, rename and collapse, never add; a status still needed comes back. */
export function editSyncedColumns(current: Column[], requested: Column[], inUse: Iterable<string>): Column[] {
  const known = new Set(current.map((c) => c.id))
  return syncColumns(
    requested.filter((c, i, all) => known.has(c.id) && all.findIndex((x) => x.id === c.id) === i),
    inUse
  )
}

/**
 * Brings the board in line with the workspaces' statuses (`statusOf`: worktree id -> status id).
 * Open chats move to the end of their workspace's column; cards whose column is gone go to the
 * first one. Answers `prev` itself when nothing changes.
 */
export function applyWorkspaceStatuses(prev: BoardState, statusOf: ReadonlyMap<string, string>): BoardState {
  const columns = syncColumns(prev.synced ? prev.columns : [], statusOf.values())
  const ids = new Set(columns.map((c) => c.id))
  const first = columns[0]!.id
  const next = new Map<string, number>()
  for (const c of Object.values(prev.cards)) next.set(c.column, Math.max(next.get(c.column) ?? 0, c.order + 1))
  const place = (card: StoredCard, column: string): StoredCard => {
    const order = next.get(column) ?? 0
    next.set(column, order + 1)
    return { ...card, column, order }
  }

  let cards: Record<string, StoredCard> | null = null
  for (const card of Object.values(prev.cards)) {
    const status = card.closed ? undefined : statusOf.get(card.worktreeId)
    const target = status && ids.has(status) ? status : ids.has(card.column) ? card.column : first
    if (target === card.column) continue
    cards ??= { ...prev.cards }
    cards[card.key] = place(card, target)
  }

  const sameColumns =
    prev.synced === true &&
    columns.length === prev.columns.length &&
    columns.every((c, i) => c.id === prev.columns[i]!.id && c.title === prev.columns[i]!.title)
  if (!cards && sameColumns) return prev
  return { ...prev, synced: true, columns, cards: cards ?? prev.cards }
}

/** Moves a chat to `column`, and the other open chats of its workspace after it: a workspace has one status. */
export function moveWorkspaceCards(prev: BoardState, key: string, column: string, index: number): BoardState {
  const card = prev.cards[key]
  let state = moveCard(prev, key, column, index)
  if (!card || state === prev) return state
  const others = Object.values(prev.cards)
    .filter((c) => c.key !== key && !c.closed && c.worktreeId === card.worktreeId && c.column !== column)
    .sort((a, b) => a.order - b.order)
  for (const c of others) {
    const count = Object.values(state.cards).filter((x) => x.column === column && !x.closed).length
    state = moveCard(state, c.key, column, count)
  }
  return state
}
