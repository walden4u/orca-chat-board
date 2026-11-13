// Workspace Board sync: pure rules, then the worker against a faked orca CLI.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker.ts'
import { setOrcaRunner } from './cli.ts'
import { emptyBoard, mergeChats, type LiveTerminal } from './board.ts'
import { applyWorkspaceStatuses, editSyncedColumns, moveWorkspaceCards, syncColumns } from './sync.ts'
import type { BoardView } from './protocol.ts'

function term(n: number, worktree: string): LiveTerminal {
  return {
    handle: `term_${n}`,
    tabId: `tab${n}`,
    ptyId: `${worktree}@@p${n}`,
    worktreeId: worktree,
    worktreePath: `/Users/me/${worktree}`,
    title: `Chat ${n}`,
    agentIdentity: 'claude',
    lastOutputAt: 1000 + n
  }
}

const ids = (cols: { id: string }[]) => cols.map((c) => c.id)
const columnsOf = (v: BoardView) => Object.fromEntries(v.cards.map((c) => [c.key, c.column]))

afterEach(() => setOrcaRunner(null))

test('synced columns: built-in statuses, then custom ones in use; yours are kept', () => {
  assert.deepEqual(ids(syncColumns([], ['in-progress', 'status-5'])), ['todo', 'in-progress', 'in-review', 'completed', 'status-5'])
  const mine = [
    { id: 'status-5', title: 'Always', collapsed: true },
    { id: 'todo', title: 'Todo' }
  ]
  const next = syncColumns(mine, ['status-5', 'status-7'])
  assert.deepEqual(ids(next), ['status-5', 'todo', 'in-progress', 'in-review', 'completed', 'status-7'])
  assert.deepEqual(next[0], { id: 'status-5', title: 'Always', collapsed: true })
})

test('synced columns can be reordered and renamed, not added; a status in use comes back', () => {
  const current = syncColumns([], ['status-5'])
  const requested = [
    { id: 'status-5', title: 'Always' },
    { id: 'col-new', title: 'Mine' },
    { id: 'todo', title: 'Todo' }
  ]
  const next = editSyncedColumns(current, requested, ['status-5'])
  assert.deepEqual(ids(next), ['status-5', 'todo', 'in-progress', 'in-review', 'completed'])
  assert.equal(next[0]!.title, 'Always')
  // Dropping an unused custom status works; dropping one in use does not.
  assert.deepEqual(ids(editSyncedColumns(next, next.slice(1), [])), ['todo', 'in-progress', 'in-review', 'completed'])
  assert.deepEqual(ids(editSyncedColumns(next, next.slice(1), ['status-5'])), ['todo', 'in-progress', 'in-review', 'completed', 'status-5'])
})

test('chats take the column of their workspace status', () => {
  const board = mergeChats(emptyBoard(), [term(1, 'a'), term(2, 'a'), term(3, 'b')], 1).state
  const synced = applyWorkspaceStatuses(board, new Map([['a', 'in-review'], ['b', 'status-5']]))
  assert.equal(synced.synced, true)
  assert.deepEqual(ids(synced.columns), ['todo', 'in-progress', 'in-review', 'completed', 'status-5'])
  assert.deepEqual([synced.cards.tab1!.column, synced.cards.tab2!.column, synced.cards.tab3!.column], ['in-review', 'in-review', 'status-5'])
  assert.deepEqual([synced.cards.tab1!.order, synced.cards.tab2!.order], [0, 1])
  // Nothing changed: the very same state comes back.
  assert.equal(applyWorkspaceStatuses(synced, new Map([['a', 'in-review'], ['b', 'status-5']])), synced)
  // The workspace moved in Orca: both chats follow. A workspace without a status keeps its column.
  const moved = applyWorkspaceStatuses(synced, new Map([['a', 'completed']]))
  assert.deepEqual([moved.cards.tab1!.column, moved.cards.tab2!.column, moved.cards.tab3!.column], ['completed', 'completed', 'status-5'])
})

test('moving one chat takes the other chats of its workspace along', () => {
  let board = mergeChats(emptyBoard(), [term(1, 'a'), term(2, 'a'), term(3, 'b')], 1).state
  board = applyWorkspaceStatuses(board, new Map([['a', 'todo'], ['b', 'todo']]))
  const next = moveWorkspaceCards(board, 'tab2', 'in-progress', 0)
  assert.deepEqual([next.cards.tab1!.column, next.cards.tab2!.column, next.cards.tab3!.column], ['in-progress', 'in-progress', 'todo'])
  assert.deepEqual([next.cards.tab2!.order, next.cards.tab1!.order], [0, 1])
})

function fakeOrca(terminals: LiveTerminal[], statuses: Record<string, string>, calls: string[][], failSet = false) {
  setOrcaRunner(async (args) => {
    calls.push(args)
    if (args[0] === 'terminal' && args[1] === 'list') return JSON.stringify({ ok: true, result: { terminals, visualLayouts: [] } })
    if (args[0] === 'worktree' && args[1] === 'ps') return JSON.stringify({ ok: true, result: { worktrees: [] } })
    if (args[0] === 'worktree' && args[1] === 'list') {
      const worktrees = Object.entries(statuses).map(([id, workspaceStatus]) => ({ id, workspaceStatus }))
      return JSON.stringify({ ok: true, result: { worktrees } })
    }
    if (args[0] === 'worktree' && args[1] === 'set') {
      if (failSet) throw new Error('Command failed\nUnknown workspace status')
      statuses[args[3]!.replace(/^id:/, '')] = args[5]!
      return JSON.stringify({ ok: true, result: {} })
    }
    throw new Error(`unexpected ${args.join(' ')}`)
  })
}

const host = (sync: boolean) =>
  mockHost({
    settings: { syncWorkspaceBoard: sync },
    results: { 'agents.list': { agents: [] }, 'workspace.readContext': null }
  })

test('worker: both directions', async () => {
  const statuses: Record<string, string> = { a: 'todo', b: 'in-review' }
  const calls: string[][] = []
  fakeOrca([term(1, 'a'), term(2, 'a'), term(3, 'b')], statuses, calls)
  const worker = await mountWorker(main, { host: host(true) })

  // Orca -> board: cards sit where their workspace is.
  let v = (await worker.request('board.get', { refresh: true })) as BoardView
  assert.equal(v.synced, true)
  assert.deepEqual(columnsOf(v), { tab1: 'todo', tab2: 'todo', tab3: 'in-review' })

  // Board -> Orca: one drag sets the workspace status and brings the sibling chat.
  v = (await worker.request('board.move', { key: 'tab1', column: 'in-progress', index: 0 })) as BoardView
  assert.deepEqual(calls.at(-1), ['worktree', 'set', '--worktree', 'id:a', '--workspace-status', 'in-progress', '--json'])
  assert.deepEqual(columnsOf(v), { tab1: 'in-progress', tab2: 'in-progress', tab3: 'in-review' })

  // Reordering inside a column touches nothing in Orca.
  const before = calls.length
  await worker.request('board.move', { key: 'tab2', column: 'in-progress', index: 0 })
  assert.equal(calls.slice(before).some((c) => c[1] === 'set'), false)

  // Orca -> board again: the workspace was moved on Orca's own board.
  statuses.b = 'completed'
  v = (await worker.request('board.get', { refresh: true })) as BoardView
  assert.equal(columnsOf(v).tab3, 'completed')

  // Columns cannot be added while synced.
  v = (await worker.request('board.columns.set', { columns: [...v.columns, { id: 'col-x', title: 'X' }] })) as BoardView
  assert.equal(v.columns.some((c) => c.id === 'col-x'), false)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('worker: a status Orca refuses leaves the card where it was', async () => {
  const calls: string[][] = []
  fakeOrca([term(1, 'a')], { a: 'todo' }, calls, true)
  const worker = await mountWorker(main, { host: host(true) })
  await worker.request('board.get', { refresh: true })
  const v = (await worker.request('board.move', { key: 'tab1', column: 'in-review', index: 0 })) as BoardView
  assert.deepEqual(columnsOf(v), { tab1: 'todo' })
  await worker.deactivate()
})

test('worker: sync off never asks Orca for statuses', async () => {
  const calls: string[][] = []
  fakeOrca([term(1, 'a')], { a: 'todo' }, calls)
  const worker = await mountWorker(main, { host: host(false) })
  let v = (await worker.request('board.get', { refresh: true })) as BoardView
  assert.equal(v.synced, false)
  assert.deepEqual(columnsOf(v), { tab1: 'backlog' })
  v = (await worker.request('board.move', { key: 'tab1', column: 'doing', index: 0 })) as BoardView
  assert.deepEqual(columnsOf(v), { tab1: 'doing' })
  assert.equal(calls.some((c) => c[0] === 'worktree' && (c[1] === 'list' || c[1] === 'set')), false)
  await worker.deactivate()
})
