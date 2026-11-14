// Worker tests: the orca CLI is faked through setOrcaRunner, the host through mockHost.
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker.ts'
import { setOrcaRunner } from './cli.ts'
import { setToolRunner } from './tools.ts'
import { activeTabsByWorktree, cleanTitle, defaultColumns, emptyBoard, mergeChats, moveCard, setColumns, type LiveTerminal } from './board.ts'
import type { BoardView, CardView } from './protocol.ts'
import { looksBusy, suggestionOf } from './screen.ts'
import { readFileSync, unlinkSync } from 'node:fs'

const WT = 'repo::/Users/me/toolbox::workspace:1'

function term(n: number, extra: Partial<LiveTerminal> = {}): LiveTerminal {
  return {
    handle: `term_${n}`,
    tabId: `tab${n}`,
    ptyId: `${WT}@@p${n}`,
    worktreeId: WT,
    worktreePath: '/Users/me/toolbox',
    title: `Chat ${n}`,
    agentIdentity: 'claude',
    lastOutputAt: 1000 + n,
    ...extra
  }
}

function fakeCli(terminals: () => LiveTerminal[], calls: string[][] = [], layouts: () => unknown = () => []) {
  setOrcaRunner(async (args) => {
    calls.push(args)
    if (args[0] === 'terminal' && args[1] === 'list') {
      return JSON.stringify({ ok: true, result: { terminals: terminals(), visualLayouts: layouts() } })
    }
    if (args[0] === 'terminal' && (args[1] === 'switch' || args[1] === 'rename')) return JSON.stringify({ ok: true, result: {} })
    if (args[0] === 'worktree' && args[1] === 'ps') return JSON.stringify({ ok: true, result: { worktrees: [] } })
    throw new Error(`unexpected ${args.join(' ')}`)
  })
}

const host = (storage: Record<string, unknown> = {}, focusedHandles: () => string[] = () => []) =>
  mockHost({
    storage: storage as never,
    results: {
      'agents.list': { agents: [] },
      'workspace.readContext': () => ({
        branch: '',
        displayName: 'toolbox',
        terminals: focusedHandles().map((id) => ({ id }))
      })
    }
  })

afterEach(() => {
  setOrcaRunner(null)
  setToolRunner(null)
})

test('new agent chats land in the first column; plain shells are skipped', async () => {
  fakeCli(() => [term(1), term(2), term(3, { agentIdentity: null, title: 'zsh' })])
  const worker = await mountWorker(main, { host: host() })
  const v = (await worker.request('board.get', { refresh: true })) as BoardView
  assert.deepEqual(
    v.cards.map((c) => [c.key, c.column, c.order, c.handle]),
    [
      ['tab1', 'backlog', 0, 'term_1'],
      ['tab2', 'backlog', 1, 'term_2']
    ]
  )
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('archiving from the card closes the chat tab in Orca and keeps the card', async () => {
  let live = [term(1), term(2)]
  const calls: string[][] = []
  setOrcaRunner(async (args) => {
    calls.push(args)
    if (args[0] === 'terminal' && args[1] === 'list') return JSON.stringify({ ok: true, result: { terminals: live, visualLayouts: [] } })
    if (args[0] === 'terminal' && args[1] === 'close') {
      live = live.filter((t) => t.handle !== args[3])
      return JSON.stringify({ ok: true, result: {} })
    }
    if (args[0] === 'worktree' && args[1] === 'ps') return JSON.stringify({ ok: true, result: { worktrees: [] } })
    throw new Error(`unexpected ${args.join(' ')}`)
  })
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  await worker.request('card.update', { key: 'tab2', note: 'later' })
  assert.deepEqual(await worker.request('chat.archive', { key: 'tab2' }), { ok: true, error: null })
  assert.deepEqual(
    calls.find((c) => c[1] === 'close'),
    ['terminal', 'close', '--terminal', 'term_2', '--tab', '--json']
  )
  const v = (await worker.request('board.get', {})) as BoardView
  const card = v.cards.find((c) => c.key === 'tab2')
  assert.equal(card?.closed, true)
  assert.equal(card?.note, 'later')
  // Already archived: nothing left to close.
  assert.deepEqual(await worker.request('chat.archive', { key: 'tab2' }), { ok: false, error: 'closed' })
  assert.equal(calls.filter((c) => c[1] === 'close').length, 1)
  await worker.deactivate()
})

test('a chat that disappears is archived with its column and note', async () => {
  let live = [term(1), term(2)]
  fakeCli(() => live)
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  await worker.request('board.move', { key: 'tab2', column: 'doing', index: 0 })
  await worker.request('card.update', { key: 'tab2', note: 'esperando a Juan' })
  live = [term(1)]
  const v = (await worker.request('board.get', { refresh: true })) as BoardView
  const c2 = v.cards.find((c) => c.key === 'tab2')!
  assert.equal(c2.closed, true)
  assert.equal(c2.column, 'doing')
  assert.equal(c2.note, 'esperando a Juan')
  assert.equal(c2.handle, null)
  // Only closed cards can be deleted.
  const after = (await worker.request('card.delete', { key: 'tab2' })) as BoardView
  assert.equal(after.cards.some((c) => c.key === 'tab2'), false)
  const kept = (await worker.request('card.delete', { key: 'tab1' })) as BoardView
  assert.equal(kept.cards.some((c) => c.key === 'tab1'), true)
  await worker.deactivate()
})

test('a restored chat with a new tab id keeps its card (pty id, then title)', () => {
  let s = mergeChats(emptyBoard(), [term(1), term(2)], 1).state
  s = moveCard(s, 'tab1', 'waiting', 0)
  s = moveCard(s, 'tab2', 'done', 0)
  s = mergeChats(s, [], 2).state
  const restored = mergeChats(
    s,
    [term(1, { tabId: 'new1' }), term(2, { tabId: 'new2', ptyId: 'other' })],
    3
  ).state
  assert.deepEqual(Object.keys(restored.cards).sort(), ['new1', 'new2'])
  assert.equal(restored.cards.new1.column, 'waiting')
  assert.equal(restored.cards.new2.column, 'done')
  assert.equal(restored.cards.new1.closed, false)
})

test('moving reorders within and across columns', () => {
  let s = mergeChats(emptyBoard(), [term(1), term(2), term(3)], 1).state
  s = moveCard(s, 'tab3', 'backlog', 0)
  const order = (col: string) =>
    Object.values(s.cards)
      .filter((c) => c.column === col)
      .sort((a, b) => a.order - b.order)
      .map((c) => c.key)
  assert.deepEqual(order('backlog'), ['tab3', 'tab1', 'tab2'])
  s = moveCard(s, 'tab1', 'doing', 99)
  assert.deepEqual(order('backlog'), ['tab3', 'tab2'])
  assert.deepEqual(order('doing'), ['tab1'])
})

test('removing a column sends its cards to the first column', () => {
  let s = mergeChats(emptyBoard(), [term(1)], 1).state
  s = moveCard(s, 'tab1', 'waiting', 0)
  s = setColumns(s, [
    { id: 'backlog', title: 'Backlog' },
    { id: 'done', title: 'Hecho' }
  ])
  assert.equal(s.cards.tab1.column, 'backlog')
  assert.equal(setColumns(s, []).columns.length, 2, 'cannot remove every column')
})

test('focus switches to the live handle', async () => {
  const calls: string[][] = []
  fakeCli(() => [term(1)], calls)
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  assert.deepEqual(await worker.request('chat.focus', { key: 'tab1' }), { ok: true, error: null })
  assert.deepEqual(calls.at(-1), ['terminal', 'switch', '--terminal', 'term_1', '--json'])
  await worker.deactivate()
})

test('agent status events show on the card', async () => {
  fakeCli(() => [term(1)])
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  await worker.emit('agent.status.changed', {
    workspaceId: null,
    paneKey: 'p',
    terminalId: 'term_1',
    state: 'waiting',
    receivedAt: 5000
  })
  const v = (await worker.request('board.get', {})) as BoardView
  assert.equal(v.cards[0].state, 'waiting')
  assert.equal(v.cards[0].stateAt, 5000)
  await worker.emit('agent.status.changed', {
    workspaceId: null,
    paneKey: 'p',
    terminalId: 'term_1',
    state: 'done',
    receivedAt: 6000,
    mainAgent: { state: 'done', outcome: 'interruption', stateStartedAt: 5900 }
  })
  const v2 = (await worker.request('board.get', {})) as BoardView
  assert.equal(v2.cards[0].state, 'done')
  assert.equal(v2.cards[0].outcome, 'interruption')
  assert.equal(v2.cards[0].stateAt, 5900)
  await worker.deactivate()
})

test('a failing CLI keeps the stored board and reports the error', async () => {
  setOrcaRunner(async () => {
    throw new Error('boom')
  })
  const stored = mergeChats(emptyBoard(), [term(1)], 1).state
  const worker = await mountWorker(main, { host: host({ board: stored }) })
  const v = (await worker.request('board.get', { refresh: true })) as BoardView
  assert.equal(v.cards.length, 1)
  assert.match(v.error ?? '', /boom/)
  await worker.deactivate()
})

test('spinner prefixes are stripped from titles', () => {
  assert.equal(cleanTitle('✳ Ticket PROJ-123'), 'Ticket PROJ-123')
  assert.equal(cleanTitle('⠂ Revisión'), 'Revisión')
  assert.equal(cleanTitle('Plain'), 'Plain')
})

test('default columns follow the UI language', async () => {
  assert.equal(defaultColumns('es-AR')[1].title, 'En curso')
  assert.equal(defaultColumns('en-US')[1].title, 'In progress')
  assert.equal(defaultColumns('ko-KR')[1].title, '진행 중')
  assert.equal(defaultColumns('fr')[1].title, 'In progress')
  fakeCli(() => [])
  const worker = await mountWorker(main, { host: host() })
  const v = (await worker.request('board.get', { refresh: true, locale: 'es-419' })) as BoardView
  assert.equal(v.columns[3].title, 'Hecho')
  await worker.deactivate()
})

test('a collapsed column stays collapsed and keeps its cards', () => {
  let s = mergeChats(emptyBoard(), [term(1)], 1).state
  s = moveCard(s, 'tab1', 'done', 0)
  s = setColumns(
    s,
    s.columns.map((c) => (c.id === 'done' ? { ...c, collapsed: true } : c))
  )
  assert.equal(s.columns.find((c) => c.id === 'done')?.collapsed, true)
  assert.equal(s.columns.find((c) => c.id === 'backlog')?.collapsed, undefined)
  assert.equal(s.cards.tab1.column, 'done')
})

test('clearing the archive forgets only closed chats', async () => {
  let live = [term(1), term(2), term(3)]
  fakeCli(() => live)
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  live = [term(1)]
  await worker.request('board.get', { refresh: true })
  const v = (await worker.request('archive.clear', {})) as BoardView
  assert.deepEqual(v.cards.map((c) => c.key), ['tab1'])
  await worker.deactivate()
})

test('a chat that finishes while you look elsewhere is marked unseen until you see it', async () => {
  let activeTab = 'tab2'
  fakeCli(
    () => [term(1), term(2)],
    [],
    () => [{ worktreeId: WT, worktreePath: '/Users/me/toolbox', root: { type: 'group', activeTabId: activeTab, tabs: [] } }]
  )
  const worker = await mountWorker(main, { host: host({}, () => ['term_1', 'term_2']) })
  await worker.request('board.get', { refresh: true })
  const status = (terminalId: string, state: 'working' | 'done', receivedAt: number) =>
    worker.emit('agent.status.changed', { workspaceId: null, paneKey: terminalId, terminalId, state, receivedAt })
  const unseen = async () =>
    ((await worker.request('board.get', {})) as BoardView).cards.filter((c) => c.unseenAt).map((c) => c.key)

  await status('term_1', 'working', 10)
  await status('term_1', 'done', 20) // tab1 is not on screen
  await status('term_2', 'working', 10)
  await status('term_2', 'done', 20) // tab2 is on screen
  assert.deepEqual(await unseen(), ['tab1'])

  activeTab = 'tab1' // you switch to it in Orca
  await worker.request('seen.check', {})
  assert.deepEqual(await unseen(), [])

  activeTab = 'tab2'
  await status('term_1', 'working', 30)
  await status('term_1', 'done', 40)
  assert.deepEqual(await unseen(), ['tab1'])
  await worker.request('chat.focus', { key: 'tab1' }) // opened from the board
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(await unseen(), [])

  await status('term_1', 'working', 50)
  await status('term_1', 'done', 60)
  await status('term_1', 'working', 70) // you answered it: working again clears the mark
  assert.deepEqual(await unseen(), [])
  await worker.deactivate()
})

test('a checked chat keeps its check, and reading it in the reply box clears its unseen mark', async () => {
  fakeCli(() => [term(1), term(2)])
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  const card = async (key: string) => ((await worker.request('board.get', { refresh: true })) as BoardView).cards.find((c) => c.key === key)!

  await worker.request('card.update', { key: 'tab1', watch: true })
  assert.equal((await card('tab1')).watch, true)
  assert.equal((await card('tab2')).watch, undefined)
  // A note edit leaves the check alone.
  await worker.request('card.update', { key: 'tab1', note: 'n' })
  assert.equal((await card('tab1')).watch, true)

  const status = (state: 'working' | 'done', receivedAt: number) =>
    worker.emit('agent.status.changed', { workspaceId: null, paneKey: 'term_1', terminalId: 'term_1', state, receivedAt })
  await status('working', 10)
  await status('done', 20)
  assert.equal((await card('tab1')).unseenAt, 20)
  const seen = (await worker.request('card.seen', { key: 'tab1' })) as BoardView
  assert.equal(seen.cards.find((c) => c.key === 'tab1')!.unseenAt, null)

  await worker.request('card.update', { key: 'tab1', watch: false })
  assert.equal((await card('tab1')).watch, undefined)
  await worker.deactivate()
})

test('a checked chat that finishes on screen still waits for you; an unchecked one does not', async () => {
  fakeCli(
    () => [term(1), term(2)],
    [],
    () => [
      { worktreeId: WT, worktreePath: '/Users/me/toolbox', root: { type: 'split', children: [{ type: 'group', activeTabId: 'tab1', tabs: [] }, { type: 'group', activeTabId: 'tab2', tabs: [] }] } }
    ]
  )
  const worker = await mountWorker(main, { host: host({}, () => ['term_1', 'term_2']) })
  await worker.request('board.get', { refresh: true })
  await worker.request('card.update', { key: 'tab1', watch: true })
  const status = (terminalId: string, state: 'working' | 'done', receivedAt: number) =>
    worker.emit('agent.status.changed', { workspaceId: null, paneKey: terminalId, terminalId, state, receivedAt })
  const unseen = async (input: object) =>
    ((await worker.request('board.get', input)) as BoardView).cards.filter((c) => c.unseenAt).map((c) => c.key)

  // Both tabs are on screen when their agents finish.
  for (const id of ['term_1', 'term_2']) {
    await status(id, 'working', 10)
    await status(id, 'done', 20)
  }
  assert.deepEqual(await unseen({}), ['tab1'])
  // Later listings do not take the mark away either; reading it in the reply box does.
  await worker.request('seen.check', {})
  assert.deepEqual(await unseen({ refresh: true }), ['tab1'])
  await worker.request('card.seen', { key: 'tab1' })
  assert.deepEqual(await unseen({ refresh: true }), [])
  await worker.deactivate()
})

test('active tabs are read from every split group of a workspace', () => {
  const tabs = activeTabsByWorktree([
    {
      worktreeId: 'w1',
      root: { type: 'split', children: [{ type: 'group', activeTabId: 'a', tabs: [] }, { type: 'group', activeTabId: 'b', tabs: [] }] }
    }
  ])
  assert.deepEqual([...(tabs.get('w1') ?? [])].sort(), ['a', 'b'])
})

test('a loop shows on its card and its runs do not mark the chat unseen', async () => {
  fakeCli(() => [term(1)])
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  const status = (state: 'working' | 'done', receivedAt: number) =>
    worker.emit('agent.status.changed', { workspaceId: null, paneKey: 'p', terminalId: 'term_1', state, receivedAt })

  await status('working', Date.now())
  await worker.hooks.fire('agent.tool.after', {
    agent: 'claude',
    workspaceId: null,
    terminalId: 'term_1',
    tool: 'ScheduleWakeup',
    input: { delaySeconds: 180, reason: 'watch CI' }
  })
  await new Promise((r) => setTimeout(r, 10))
  await status('done', Date.now())
  let card = ((await worker.request('board.get', {})) as BoardView).cards[0]
  assert.equal(card.monitor?.kind, 'loop')
  assert.equal(card.monitor?.everySec, 180)
  assert.equal(card.monitor?.stale, false)
  assert.equal(card.unseenAt ?? null, null)

  await worker.hooks.fire('agent.tool.after', {
    agent: 'claude',
    workspaceId: null,
    terminalId: 'term_1',
    tool: 'ScheduleWakeup',
    input: { stop: true }
  })
  await new Promise((r) => setTimeout(r, 10))
  card = ((await worker.request('board.get', {})) as BoardView).cards[0]
  assert.equal(card.monitor, null)
  await worker.deactivate()
})

test('the card shows the tab title, and renaming a card renames the Orca tab', async () => {
  let tabTitle = 'Mi ticket'
  const calls: string[][] = []
  fakeCli(
    () => [term(1, { title: '✳ Claude Code' })],
    calls,
    () => [{ worktreeId: WT, root: { type: 'group', activeTabId: 'x', tabs: [{ tabId: 'tab1', title: tabTitle }] } }]
  )
  const worker = await mountWorker(main, { host: host() })
  let v = (await worker.request('board.get', { refresh: true })) as BoardView
  assert.equal(v.cards[0].title, 'Mi ticket')

  setOrcaRunner(async (args) => {
    calls.push(args)
    if (args[1] === 'rename') tabTitle = args[5]
    const layouts = [{ worktreeId: WT, root: { type: 'group', activeTabId: 'x', tabs: [{ tabId: 'tab1', title: tabTitle }] } }]
    return JSON.stringify({ ok: true, result: { terminals: [term(1, { title: '✳ Claude Code' })], visualLayouts: layouts } })
  })
  v = (await worker.request('card.update', { key: 'tab1', label: 'PROJ-456 Login', note: 'n' })) as BoardView
  assert.deepEqual(calls.find((c) => c[1] === 'rename'), ['terminal', 'rename', '--terminal', 'term_1', '--title', 'PROJ-456 Login', '--json'])
  assert.equal(v.cards[0].title, 'PROJ-456 Login')
  assert.equal(v.cards[0].label, '')
  assert.equal(v.cards[0].note, 'n')
  await worker.deactivate()
})

test('talking to a Backlog chat moves it to In progress, unless the setting is off or the column is gone', async () => {
  fakeCli(() => [term(1), term(2), term(3)])
  const status = (w: Awaited<ReturnType<typeof mountWorker>>, id: string, state: 'working' | 'done', at: number) =>
    w.emit('agent.status.changed', { workspaceId: null, paneKey: id, terminalId: id, state, receivedAt: at })
  const columnOf = async (w: Awaited<ReturnType<typeof mountWorker>>, key: string) =>
    ((await w.request('board.get', {})) as BoardView).cards.find((c) => c.key === key)?.column

  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  await worker.request('board.move', { key: 'tab2', column: 'waiting', index: 0 })
  await status(worker, 'term_1', 'working', 10)
  await status(worker, 'term_2', 'working', 10)
  assert.equal(await columnOf(worker, 'tab1'), 'doing')
  assert.equal(await columnOf(worker, 'tab2'), 'waiting') // only Backlog cards move

  await worker.request('board.columns.set', {
    columns: [
      { id: 'backlog', title: 'Backlog' },
      { id: 'done', title: 'Done' }
    ]
  })
  await status(worker, 'term_3', 'working', 10)
  assert.equal(await columnOf(worker, 'tab3'), 'backlog') // no In progress column: nothing happens
  await worker.deactivate()

  const off = mockHost({
    settings: { autoMoveToInProgress: false },
    results: { 'agents.list': { agents: [] }, 'workspace.readContext': null }
  })
  const w2 = await mountWorker(main, { host: off })
  await w2.request('board.get', { refresh: true })
  await status(w2, 'term_1', 'working', 10)
  assert.equal(await columnOf(w2, 'tab1'), 'backlog')
  await w2.deactivate()
})

test('the chat on screen is marked active', async () => {
  let activeTab = 'tab2'
  fakeCli(
    () => [term(1), term(2)],
    [],
    () => [{ worktreeId: WT, root: { type: 'group', activeTabId: activeTab, tabs: [] } }]
  )
  const worker = await mountWorker(main, { host: host({}, () => ['term_1', 'term_2']) })
  const active = async () =>
    ((await worker.request('seen.check', {})) as BoardView).cards.filter((c) => c.active).map((c) => c.key)
  await worker.request('board.get', { refresh: true })
  assert.deepEqual(await active(), ['tab2'])
  activeTab = 'tab1'
  assert.deepEqual(await active(), ['tab1'])
  assert.equal(worker.posts.some((p) => p.event === 'board.changed'), true) // the switch was pushed to panels
  await worker.deactivate()
})

test('Orca chat tabs (no terminal) get cards from `orca worktree ps`', async () => {
  const chatTab = 'structured-agent-session-claude_abc'
  let unread = true
  const calls: string[][] = []
  const ps = () => [
    {
      worktreeId: WT,
      path: '/Users/me/toolbox',
      agents: [
        // a terminal chat with no status event yet: ps fills it
        { paneKey: 'tab1:leaf', parentPaneKey: null, state: 'waiting', agentType: 'claude', hasLivePty: true, stateStartedAt: 50 },
        // a chat tab
        {
          paneKey: `${chatTab}:leaf`,
          parentPaneKey: null,
          state: 'done',
          agentType: 'claude',
          conversationName: 'Plan the release',
          hasLivePty: null,
          stateStartedAt: 70,
          updatedAt: 80,
          activity: { unread }
        },
        // its subagent: ignored
        { paneKey: `${chatTab}:sub`, parentPaneKey: `${chatTab}:leaf`, state: 'working', agentType: 'claude' }
      ]
    }
  ]
  setOrcaRunner(async (args) => {
    calls.push(args)
    if (args[1] === 'list') return JSON.stringify({ ok: true, result: { terminals: [term(1)], visualLayouts: [] } })
    if (args[0] === 'worktree' && args[1] === 'ps') return JSON.stringify({ ok: true, result: { worktrees: ps() } })
    return JSON.stringify({ ok: true, result: {} })
  })
  const worker = await mountWorker(main, { host: host() })
  let v = (await worker.request('board.get', { refresh: true })) as BoardView
  const chat = v.cards.find((c) => c.key === chatTab)!
  assert.equal(chat.title, 'Plan the release')
  assert.equal(chat.sessionId, 'claude_abc')
  assert.equal(chat.state, 'done')
  assert.ok(chat.unseenAt, "Orca's unread flag marks it unseen")
  assert.equal(v.cards.find((c) => c.key === 'tab1')?.state, 'waiting')
  assert.equal(v.cards.length, 2)

  // light refresh (every 3 s) keeps the chat card
  v = (await worker.request('seen.check', {})) as BoardView
  assert.equal(v.cards.find((c) => c.key === chatTab)?.closed, false)

  // opening it shows its workspace; renaming uses `orca chat rename`
  assert.deepEqual(await worker.request('chat.focus', { key: chatTab }), { ok: true, error: 'chat-workspace' })
  assert.deepEqual(calls.find((c) => c[1] === 'activate'), ['worktree', 'activate', '--worktree', `id:${WT}`, '--json'])
  await worker.request('card.update', { key: chatTab, label: 'Release plan' })
  assert.deepEqual(calls.find((c) => c[0] === 'chat'), ['chat', 'rename', '--session', 'claude_abc', '--name', 'Release plan', '--json'])

  // read in Orca: the mark clears on the next full listing
  unread = false
  v = (await worker.request('board.get', { refresh: true })) as BoardView
  assert.equal(v.cards.find((c) => c.key === chatTab)?.unseenAt ?? null, null)
  await worker.deactivate()
})

test('hover preview answers the last prompt and reply from Orca, on demand', async () => {
  let lastOutputAt = 1001
  const reads: string[][] = []
  let draft: string | undefined
  setOrcaRunner(async (args) => {
    if (args[1] === 'list') return JSON.stringify({ ok: true, result: { terminals: [term(1, { lastOutputAt })], visualLayouts: [] } })
    if (args[1] === 'read') {
      reads.push(args)
      return JSON.stringify({ ok: true, result: { terminal: { tail: ['> new question  ', 'New answer.', '', ''], draft } } })
    }
    if (args[1] === 'ps')
      return JSON.stringify({
        ok: true,
        result: {
          worktrees: [
            {
              worktreeId: WT,
              path: '/Users/me/toolbox',
              agents: [
                { paneKey: 'tab1:sub', parentPaneKey: 'tab1:leaf', state: 'working', prompt: 'subagent', lastAssistantMessage: 'no' },
                { paneKey: 'tab1:leaf', parentPaneKey: null, state: 'done', prompt: 'fix the bug', lastAssistantMessage: 'Fixed it.', updatedAt: 9 }
              ]
            }
          ]
        }
      })
    return JSON.stringify({ ok: true, result: {} })
  })
  const worker = await mountWorker(main, { host: host() })
  const record = { prompt: 'fix the bug', message: 'Fixed it.', at: 9, screen: null, suggestion: null }
  assert.deepEqual(await worker.request('chat.preview', { key: 'tab1' }), record)
  assert.deepEqual(await worker.request('chat.preview', { key: 'nope' }), { ...record, prompt: null, message: null, at: null })
  assert.deepEqual(worker.host.data().storage, {}, 'nothing is stored')
  assert.equal(reads.length, 0, 'the hover preview never reads the terminal')

  // The reply box reads the chat's terminal too: for what waits in the agent's input, and for the
  // screen itself when the terminal is well ahead of Orca's record.
  await worker.request('board.get', { refresh: true })
  draft = 'Run the tests'
  assert.deepEqual(await worker.request('chat.preview', { key: 'tab1', screen: true }), { ...record, suggestion: 'Run the tests' })
  draft = undefined
  lastOutputAt = 9 + 10 * 60_000
  assert.deepEqual(await worker.request('chat.preview', { key: 'tab1' }), record)
  assert.deepEqual(await worker.request('chat.preview', { key: 'tab1', screen: true }), { ...record, screen: '> new question\nNew answer.' })
  assert.deepEqual(reads.at(-1), ['terminal', 'read', '--terminal', 'term_1', '--screen', '--json'])
  assert.equal(reads.length, 2)

  assert.equal(suggestionOf(['● Done.', '❯ Try "how do I log an error?"', '  auto mode on'], null), 'how do I log an error?')
  assert.equal(suggestionOf(['❯ commit this'], '  from the draft  '), 'from the draft')
  assert.equal(suggestionOf(['❯ a prompt already sent', '❯'], null), null)
  await worker.deactivate()
})

test('pictures attached in the reply box are pasted as file paths before the text', async () => {
  const calls: string[][] = []
  setOrcaRunner(async (args) => {
    calls.push(args)
    if (args[1] === 'list') return JSON.stringify({ ok: true, result: { terminals: [term(1)], visualLayouts: [] } })
    if (args[1] === 'send') return JSON.stringify({ ok: true, result: { send: { accepted: true } } })
    if (args[1] === 'ps') return JSON.stringify({ ok: true, result: { worktrees: [] } })
    throw new Error(`unexpected ${args.join(' ')}`)
  })
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  const sends = () => calls.filter((c) => c[1] === 'send').map((c) => c.slice(4, -1))

  // A 1x1 PNG, handed over in two pieces.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  assert.deepEqual(await worker.request('attach.put', { id: 'pic-1', type: 'image/png', data: png.slice(0, 40) }), { result: 'ok' })
  assert.deepEqual(await worker.request('attach.put', { id: 'pic-1', type: 'image/png', data: png.slice(40) }), { result: 'ok' })
  assert.deepEqual(await worker.request('attach.put', { id: 'x', type: 'text/html', data: 'aGk=' }), { result: 'type' })
  assert.deepEqual(await worker.request('attach.put', { id: 'x', type: 'image/png', data: '<script>' }), { result: 'type' })

  assert.deepEqual(await worker.request('chat.send', { key: 'tab1', text: 'look', images: ['pic-1'] }), { ok: true, error: null })
  const [paste, text] = sends()
  assert.match(paste![0]!, /^--text=\x1b\[200~.*orca-chat-board.paste-\d+-pic-1\.png\x1b\[201~$/)
  assert.equal(paste!.length, 1, 'the picture is pasted without Enter')
  assert.deepEqual(text, ['--text=look', '--enter'])
  const file = paste![0]!.slice('--text=\x1b[200~'.length, -'\x1b[201~'.length)
  assert.equal(readFileSync(file).length, 70, 'the file holds the picture')
  unlinkSync(file)

  // Only a picture: Enter alone submits it. A picture sent once is gone.
  await worker.request('attach.put', { id: 'pic-2', type: 'image/png', data: png })
  assert.deepEqual(await worker.request('chat.send', { key: 'tab1', text: '', images: ['pic-2'] }), { ok: true, error: null })
  assert.deepEqual(sends().at(-1), ['--enter'])
  unlinkSync(sends().at(-2)![0]!.slice('--text=\x1b[200~'.length, -'\x1b[201~'.length))
  assert.deepEqual(await worker.request('chat.send', { key: 'tab1', text: 'again', images: ['pic-2'] }), { ok: false, error: 'image-lost' })
  await worker.deactivate()
})

test('an archived Claude chat opens again in a tab Orca starts, and its card moves there', async () => {
  const calls: string[][] = []
  let live = [term(1)]
  setOrcaRunner(async (args) => {
    calls.push(args)
    if (args[0] === 'terminal' && args[1] === 'list') return JSON.stringify({ ok: true, result: { terminals: live, visualLayouts: [] } })
    if (args[0] === 'agent' && args[1] === 'launch') {
      live = [term(9, { title: 'Claude Code' })]
      return JSON.stringify({ ok: true, result: { outcome: { kind: 'terminal', handle: 'term_9' } } })
    }
    if (args[1] === 'read') return JSON.stringify({ ok: true, result: { terminal: { tail: ['Claude Code', '❯ Try "fix it"'] } } })
    if (args[1] === 'send') return JSON.stringify({ ok: true, result: { send: { accepted: true } } })
    if (args[1] === 'ps') return JSON.stringify({ ok: true, result: { worktrees: [] } })
    throw new Error(`unexpected ${args.join(' ')}`)
  })
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  await worker.request('card.update', { key: 'tab1', note: 'keep me', watch: true })
  // Open chats are not reopened.
  assert.deepEqual(await worker.request('chat.reopen', { key: 'tab1' }), { ok: false, error: 'open' })

  live = []
  await worker.request('board.get', { refresh: true }) // the chat is gone: its card is archived
  assert.deepEqual(await worker.request('chat.reopen', { key: 'tab1' }), { ok: true, error: null })
  assert.deepEqual(
    calls.find((c) => c[0] === 'agent'),
    ['agent', 'launch', '--agent', 'claude', '--worktree', `id:${WT}`, '--surface', 'terminal', '--focus', '--json']
  )
  // Claude needs a moment to start: the command for its list follows once its prompt shows.
  assert.equal(calls.some((c) => c[1] === 'send'), false)
  await new Promise((done) => setTimeout(done, 2000))
  assert.deepEqual(calls.find((c) => c[1] === 'send'), ['terminal', 'send', '--terminal', 'term_9', '--text=/resume', '--enter', '--json'])
  const cards = ((await worker.request('board.get', {})) as BoardView).cards
  assert.deepEqual(cards.map((c) => [c.key, c.closed, c.note, c.watch, c.handle]), [['tab9', false, 'keep me', true, 'term_9']])
  await worker.deactivate()
})

test('a turn whose end shows up in a listing before its event is still news', async () => {
  // Two chats finish close together: the first one's event lists the agents, and that listing
  // already says the second one is done. Its own event then brings nothing new.
  let psState: 'working' | 'done' = 'working'
  setOrcaRunner(async (args) => {
    if (args[1] === 'list') return JSON.stringify({ ok: true, result: { terminals: [term(1), term(2)], visualLayouts: [] } })
    if (args[1] === 'ps') {
      const agents = [{ paneKey: 'tab2:leaf', parentPaneKey: null, state: psState, agentType: 'claude', hasLivePty: true, stateStartedAt: psState === 'done' ? 30 : 10 }]
      return JSON.stringify({ ok: true, result: { worktrees: [{ worktreeId: WT, path: '/Users/me/toolbox', agents }] } })
    }
    throw new Error(`unexpected ${args.join(' ')}`)
  })
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  const status = (terminalId: string, state: 'working' | 'done', receivedAt: number) =>
    worker.emit('agent.status.changed', { workspaceId: null, paneKey: terminalId, terminalId, state, receivedAt })
  const unseen = async () => ((await worker.request('board.get', {})) as BoardView).cards.filter((c) => c.unseenAt).map((c) => c.key).sort()

  await status('term_1', 'working', 10)
  await status('term_2', 'working', 10)
  psState = 'done'
  await status('term_1', 'done', 20) // its refresh lists tab2 as done already
  assert.deepEqual(await unseen(), ['tab1', 'tab2'])
  await status('term_2', 'done', 30) // nothing new, and nothing lost
  assert.deepEqual(await unseen(), ['tab1', 'tab2'])
  await worker.deactivate()
})

test('a chat Orca lost track of gets its status from its terminal', async () => {
  const BUSY = ['● Reading files', '✽ Wrangling… (2m 22s · ↓ 9.4k tokens)', '❯', '  auto mode on']
  const IDLE = ['● Done.', '✻ Cooked for 10s · done 9:12 PM', '❯', '  auto mode on']
  assert.equal(looksBusy(BUSY), true)
  assert.equal(looksBusy(['· Sock-hopping… (running Stop hooks… 4/5 · 14s · ↓ 706 tokens)']), true)
  assert.equal(looksBusy(['  press esc to interrupt']), true)
  assert.equal(looksBusy(IDLE), false)
  assert.equal(looksBusy(['❯ wait… (I am typing this for 20s)']), false)

  let lastOutputAt = Date.now()
  let screen = BUSY
  let reads = 0
  setOrcaRunner(async (args) => {
    if (args[1] === 'list') return JSON.stringify({ ok: true, result: { terminals: [term(1, { lastOutputAt })], visualLayouts: [] } })
    if (args[1] === 'read') {
      reads++
      return JSON.stringify({ ok: true, result: { terminal: { tail: screen } } })
    }
    if (args[1] === 'ps') return JSON.stringify({ ok: true, result: { worktrees: [] } })
    throw new Error(`unexpected ${args.join(' ')}`)
  })
  const worker = await mountWorker(main, { host: host() })
  const card = async () => ((await worker.request('board.get', { refresh: true })) as BoardView).cards[0]!

  // Fresh output and a busy screen, with nothing from Orca: a turn is running.
  assert.equal((await card()).state, 'working')
  // The terminal went quiet and the screen is idle: the turn is over, and that is news.
  lastOutputAt = Date.now() - 60_000
  screen = IDLE
  let c = await card()
  assert.deepEqual([c.state, c.stateAt, c.unseenAt], ['done', lastOutputAt, lastOutputAt])
  assert.equal(reads, 2)

  // You typing at the prompt: output, but no busy screen. Nothing changes, and the screen is not read each time.
  lastOutputAt = Date.now()
  c = await card()
  assert.equal(c.state, 'done')
  await card()
  assert.equal(reads, 3)

  // A real event from Orca takes over.
  await worker.emit('agent.status.changed', { workspaceId: null, paneKey: 'term_1', terminalId: 'term_1', state: 'working', receivedAt: Date.now() })
  lastOutputAt = Date.now() - 60_000
  assert.equal((await card()).state, 'working')
  await worker.deactivate()
})

test('the reply box sends your text to the chat as one argument, and to nothing else', async () => {
  const calls: string[][] = []
  let live = [term(1), term(2)]
  setOrcaRunner(async (args) => {
    calls.push(args)
    if (args[0] === 'terminal' && args[1] === 'list') return JSON.stringify({ ok: true, result: { terminals: live, visualLayouts: [] } })
    if (args[0] === 'terminal' && args[1] === 'send') return JSON.stringify({ ok: true, result: { send: { accepted: true } } })
    if (args[0] === 'worktree' && args[1] === 'ps') {
      const agents = [
        { paneKey: 'structured-agent-session-s1:leaf', parentPaneKey: null, state: 'done', agentType: 'claude', conversationName: 'A chat tab', hasLivePty: null }
      ]
      return JSON.stringify({ ok: true, result: { worktrees: [{ worktreeId: WT, path: '/Users/me/toolbox', agents }] } })
    }
    throw new Error(`unexpected ${args.join(' ')}`)
  })
  const worker = await mountWorker(main, { host: host() })
  const view = (await worker.request('board.get', { refresh: true })) as BoardView
  const sends = () => calls.filter((c) => c[1] === 'send')

  // A text that starts like an option stays text; surrounding blank space goes.
  assert.deepEqual(await worker.request('chat.send', { key: 'tab2', text: '  --help\nplease  ' }), { ok: true, error: null })
  assert.deepEqual(sends(), [['terminal', 'send', '--terminal', 'term_2', '--text=--help\nplease', '--enter', '--json']])

  assert.deepEqual(await worker.request('chat.send', { key: 'tab1', text: ' \n ' }), { ok: false, error: 'empty' })
  // Orca's chat tabs cannot be sent to.
  const chatTab = view.cards.find((c) => c.sessionId)!
  assert.deepEqual(await worker.request('chat.send', { key: chatTab.key, text: 'hi' }), { ok: false, error: 'chat-tab' })
  // A chat that closed since the board was drawn gets nothing.
  live = [term(2)]
  assert.deepEqual(await worker.request('chat.send', { key: 'tab1', text: 'hi' }), { ok: false, error: 'closed' })
  assert.equal(sends().length, 1)
  await worker.deactivate()
})

test("Orca's monitoring mode (working overall, main turn done) reaches the card", async () => {
  fakeCli(() => [term(1)])
  const worker = await mountWorker(main, { host: host() })
  await worker.request('board.get', { refresh: true })
  await worker.emit('agent.status.changed', {
    workspaceId: null, paneKey: 'p', terminalId: 'term_1', state: 'working', receivedAt: 10,
    mainAgent: { state: 'working', stateStartedAt: 10 }
  })
  await worker.emit('agent.status.changed', {
    workspaceId: null, paneKey: 'p', terminalId: 'term_1', state: 'working', receivedAt: 20,
    mainAgent: { state: 'done', outcome: 'success', stateStartedAt: 20 }
  })
  const card = ((await worker.request('board.get', {})) as BoardView).cards[0]
  assert.equal(card.state, 'working')
  assert.equal(card.mainState, 'done')
  assert.equal(card.unseenAt ?? null, null, 'still working: not news yet')
  await worker.deactivate()
})

// ---------- goal mode: the goal file, and the judge ----------

const VERDICT = {
  verdict: 'must-fix',
  summary: 'one thing is missing',
  criteria: [{ criterion: '1. it works', pass: false, evidence: 'src/a.ts:3 returns early' }],
  mustFix: [{ title: 'returns early', evidence: 'src/a.ts:3 returns early', file: 'src/a.ts', line: 3 }]
}
const answered = (verdict: unknown = VERDICT) => JSON.stringify({ subtype: 'success', is_error: false, total_cost_usd: 0.04, structured_output: verdict })
const GOAL = ['# 목표: 동작하게 만들기', '', '- [x] 1. 파일이 있다', '  확인: ls src/a.ts', '- [ ] 2. 동작해야 한다', '  확인: node src/a.ts'].join('\n')

type Mounted = Awaited<ReturnType<typeof mountWorker>>

/** A host with goal mode turned on (it is off by default). */
const goalMode = (storage: Record<string, unknown> = {}) =>
  mockHost({
    settings: { goalMode: true },
    storage: storage as never,
    results: { 'agents.list': { agents: [] }, 'workspace.readContext': null }
  })

/**
 * Orca's CLI with two chats in one folder (tab1's agent says it is done), and fakes for what a
 * review touches: the folder's GOAL.md (`files.goal`, null: none), git, and Claude Code as the
 * judge (`answer` is what it prints).
 */
function fakeJudge(answer: () => string | Promise<string>, folderIsHere = true) {
  const orcaCalls: string[][] = []
  const toolCalls: { tool: string; args: string[]; cwd: string; input?: string }[] = []
  const files: { goal: string | null } = { goal: null }
  setOrcaRunner(async (args) => {
    orcaCalls.push(args)
    if (args[0] === 'terminal' && args[1] === 'list') return JSON.stringify({ ok: true, result: { terminals: [term(1), term(2)], visualLayouts: [] } })
    if (args[0] === 'worktree' && args[1] === 'ps') {
      const agents = [{ paneKey: 'tab1:0', state: 'done', prompt: 'make it work', lastAssistantMessage: 'All done.' }]
      return JSON.stringify({ ok: true, result: { worktrees: [{ worktreeId: WT, path: '/Users/me/toolbox', agents }] } })
    }
    throw new Error(`unexpected ${args.join(' ')}`)
  })
  setToolRunner(
    async (tool, args, run) => {
      toolCalls.push({ tool, args, cwd: run.cwd, input: run.input })
      const ok = (stdout: string) => ({ stdout, stderr: '', code: 0 })
      if (tool === 'claude') return ok(await answer())
      // Every git call leaves the folder's index alone.
      assert.equal(args[0], '--no-optional-locks')
      const git = args.slice(1).join(' ')
      if (git === 'rev-parse --is-inside-work-tree') return ok('true\n')
      if (git.startsWith('log --diff-filter=A ')) return ok('abc1234def\n')
      if (git.startsWith('status ')) return ok(' M src/a.ts\n?? src/new.ts\n')
      if (git.startsWith('cat-file ')) return ok('')
      if (git.startsWith('diff --name-only ')) return ok('src/a.ts\n')
      if (git.startsWith('diff --no-color ')) return ok('@@ -1 +1 @@\n-old\n+new\n')
      return { stdout: '', stderr: `unexpected git ${git}`, code: 1 }
    },
    () => folderIsHere,
    (path) => (/[\\/]GOAL\.md$/.test(path) && path.includes('toolbox') ? files.goal : null)
  )
  return { orcaCalls, toolCalls, files }
}

/** The card once `ready` holds for it (a review's result arrives a moment after it is asked for). */
async function cardWhen(worker: Mounted, key: string, ready: (card: CardView) => boolean): Promise<CardView> {
  for (let i = 0; i < 400; i++) {
    const card = ((await worker.request('board.get', {})) as BoardView).cards.find((c) => c.key === key)
    if (card && ready(card)) return card
    await new Promise((done) => setTimeout(done, 5))
  }
  throw new Error(`card ${key} never got there`)
}
const reviewed = (worker: Mounted, key = 'tab1') => cardWhen(worker, key, (c) => !!c.judge && c.judge.state !== 'running')
const cardOf = (v: unknown, key = 'tab1') => (v as BoardView).cards.find((c) => c.key === key)!

test('with goal mode on, a card shows the checklist of its folder as the file stands', async () => {
  const { files } = fakeJudge(() => answered())
  const worker = await mountWorker(main, { host: goalMode() })
  // No GOAL.md in the folder: nothing to show.
  assert.equal(cardOf(await worker.request('board.get', { refresh: true })).goalFile, null)
  files.goal = GOAL
  const first = cardOf(await worker.request('board.get', { refresh: true })).goalFile!
  assert.deepEqual([first.title, first.done, first.total], ['목표: 동작하게 만들기', 1, 2])
  assert.deepEqual(first.items, [
    { text: '1. 파일이 있다', done: true },
    { text: '2. 동작해야 한다', done: false }
  ])
  // Both chats work in that folder, so both cards show it. The agent ticks an item: the next listing has it.
  files.goal = GOAL.replace('- [ ] 2.', '- [x] 2.')
  const next = (await worker.request('board.get', { refresh: true })) as BoardView
  assert.deepEqual([cardOf(next).goalFile!.done, cardOf(next, 'tab2').goalFile!.done], [2, 2])
  await worker.deactivate()
})

test('a review holds the work against GOAL.md, keeps its verdict on the card and sends nothing to the chat', async () => {
  const { orcaCalls, toolCalls, files } = fakeJudge(() => answered())
  files.goal = GOAL
  const worker = await mountWorker(main, { host: goalMode() })
  await worker.request('board.get', { refresh: true })

  assert.deepEqual(await worker.request('judge.run', { key: 'tab1' }), { ok: true, error: null })
  const judge = (await reviewed(worker)).judge!
  assert.equal(judge.state, 'done')
  assert.deepEqual(judge.verdict, VERDICT)
  assert.equal(judge.costUsd, 0.04)
  // tab2 works in the same folder: the verdict says so.
  assert.deepEqual(judge.notes, ['shared-folder'])
  // The goal is in Korean, so the drafted reply is too.
  assert.ok(judge.draft!.includes('1. returns early (src/a.ts:3)'))
  assert.ok(judge.draft!.includes('근거: src/a.ts:3 returns early'))

  const judged = toolCalls.find((c) => c.tool === 'claude')!
  assert.equal(judged.cwd, '/Users/me/toolbox')
  assert.ok(judged.args.includes('--restricted') && judged.args.includes('--no-session-persistence'))
  // The whole goal file, the last request, the agent's claim and what changed.
  for (const part of ['- [ ] 2. 동작해야 한다', '확인: node src/a.ts', 'make it work', 'All done.', '- src/a.ts', '- src/new.ts', '+new', 'Other chats work in this folder']) {
    assert.ok(judged.input!.includes(part), part)
  }
  // What changed is counted from the commit that added GOAL.md.
  assert.ok(toolCalls.some((c) => c.tool === 'git' && c.args.join(' ') === '--no-optional-locks diff --no-color abc1234def'))
  // Nothing was typed into any terminal: only you send.
  assert.deepEqual(orcaCalls.filter((c) => c[0] === 'terminal' && c[1] !== 'list'), [])
  await worker.deactivate()
})

test('one review at a time; a closed chat and a folder that is not here are refused', async () => {
  let finish: (printed: string) => void = () => undefined
  const { toolCalls } = fakeJudge(() => new Promise<string>((done) => (finish = done)))
  const worker = await mountWorker(main, { host: goalMode() })
  await worker.request('board.get', { refresh: true })
  assert.deepEqual(await worker.request('judge.run', { key: 'nope' }), { ok: false, error: 'closed' })
  assert.deepEqual(await worker.request('judge.run', { key: 'tab1' }), { ok: true, error: null })
  assert.equal((await cardWhen(worker, 'tab1', (c) => !!c.judge)).judge!.state, 'running')
  assert.deepEqual(await worker.request('judge.run', { key: 'tab2' }), { ok: false, error: 'busy' })
  for (let i = 0; i < 400 && !toolCalls.some((c) => c.tool === 'claude'); i++) await new Promise((done) => setTimeout(done, 5))
  finish(answered({ ...VERDICT, verdict: 'pass', criteria: [{ criterion: '1. it works', pass: true, evidence: 'src/a.ts:3' }], mustFix: [] }))
  const judge = (await reviewed(worker)).judge!
  // No GOAL.md in the folder: judged against the last request, and it says so. Nothing to fix, nothing drafted.
  assert.deepEqual([judge.verdict!.verdict, judge.draft, judge.notes], ['pass', null, ['no-goal', 'shared-folder']])
  // Without a goal file there is no commit to count from: what is not committed yet is what changed.
  assert.ok(toolCalls.some((c) => c.tool === 'git' && c.args.join(' ') === '--no-optional-locks diff --no-color HEAD'))
  await worker.deactivate()

  fakeJudge(() => answered(), false)
  const away = await mountWorker(main, { host: goalMode() })
  await away.request('board.get', { refresh: true })
  assert.deepEqual(await away.request('judge.run', { key: 'tab1' }), { ok: false, error: 'no-folder' })
  await away.deactivate()
})

test('a review that fails says why, and one cut off by a reload is not left running', async () => {
  fakeJudge(() => 'Error: not logged in')
  const worker = await mountWorker(main, { host: goalMode() })
  await worker.request('board.get', { refresh: true })
  await worker.request('judge.run', { key: 'tab1' })
  const failed = (await reviewed(worker)).judge!
  assert.deepEqual([failed.state, failed.error], ['failed', 'the judge did not answer in JSON'])
  // tab2's folder has no GOAL.md and Orca knows no request of its agent: nothing to judge against.
  await worker.request('judge.run', { key: 'tab2' })
  const nothing = (await reviewed(worker, 'tab2')).judge!
  assert.deepEqual([nothing.state, nothing.error], ['failed', 'nothing'])
  await worker.deactivate()

  const stored = mergeChats(emptyBoard(), [term(1)], 1).state
  stored.cards.tab1 = { ...stored.cards.tab1!, judge: { state: 'running', at: 5 } }
  fakeJudge(() => answered())
  const reloaded = await mountWorker(main, { host: goalMode({ board: stored }) })
  const view = (await reloaded.request('board.get', { refresh: true })) as BoardView
  assert.deepEqual(cardOf(view).judge, { state: 'failed', at: 5, error: 'interrupted' })
  await reloaded.deactivate()
})

test('with goal mode off, no goal file is read and no judge runs', async () => {
  const { toolCalls, files } = fakeJudge(() => answered())
  files.goal = GOAL
  // Off is the default.
  const worker = await mountWorker(main, { host: host() })
  const card = cardOf(await worker.request('board.get', { refresh: true }))
  assert.equal(card.goalFile, null)
  assert.deepEqual(await worker.request('judge.run', { key: 'tab1' }), { ok: false, error: 'off' })
  await worker.emit('agent.status.changed', { workspaceId: null, paneKey: 'term_1', terminalId: 'term_1', state: 'working', receivedAt: 10 })
  await worker.emit('agent.status.changed', { workspaceId: null, paneKey: 'term_1', terminalId: 'term_1', state: 'done', receivedAt: 15 })
  await new Promise((done) => setTimeout(done, 40))
  assert.deepEqual(toolCalls, [])
  assert.equal(cardOf(await worker.request('board.get', {})).judge, undefined)
  await worker.deactivate()
})

test('how a drafted reply was used is counted once, and a draft never used counts as dropped', async () => {
  fakeJudge(() => answered())
  const worker = await mountWorker(main, { host: goalMode() })
  await worker.request('board.get', { refresh: true })
  // No review yet: nothing to count.
  await worker.request('judge.tally', { key: 'tab1', how: 'asIs' })
  await worker.request('judge.run', { key: 'tab1' })
  await reviewed(worker)
  await worker.request('judge.tally', { key: 'tab1', how: 'asIs' })
  await worker.request('judge.tally', { key: 'tab1', how: 'edited' })
  const used = await cardWhen(worker, 'tab1', (c) => !!c.drafts)
  assert.deepEqual([used.drafts, used.judge!.used], [{ asIs: 1, edited: 0, dropped: 0 }, true])
  // A second review, whose draft is never sent, gives way to a third.
  await worker.request('judge.run', { key: 'tab1' })
  await cardWhen(worker, 'tab1', (c) => c.judge?.state === 'done' && !c.judge.used)
  await worker.request('judge.run', { key: 'tab1' })
  assert.deepEqual((await reviewed(worker)).drafts, { asIs: 1, edited: 0, dropped: 1 })
  await worker.deactivate()
})
