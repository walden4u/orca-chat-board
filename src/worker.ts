// Chat Board (remote): the panel of the Chat Board that runs on a paired Orca server. This worker
// keeps nothing: every panel request is passed to that plugin's worker through the orca CLI
// (`orca plugin dev request … --environment <server>`), so the board, its columns, statuses,
// reviews and settings are the server's own.
import type { OrcaWorkerApi } from 'orca/worker'
import { orcaEnvironment, setOrcaEnvironment, type RemoteTrouble } from './cli.ts'
import { askServer, forgetDoor, isDirect, isListening, keepListening, onServerEvent } from './direct.ts'
import { unseenHere, type SeenCard } from './unseen.ts'
import { forgetWebTab, lastSteps, showChatInWebTab } from './webtab.ts'
import { clearStaleSession, staleSessionOf } from './stale.ts'
import { keys, keysWhy, markedSpot, setMarkedSpot, type KeysOp } from './keys.ts'

/** The Chat Board on the server: a development plugin, which is what `plugin dev request` can call. */
const TARGET = 'local.chat-board'

/** Every request the panel makes, except `trace` (kept in this machine's log). */
const REQUESTS = [
  'board.get',
  'board.move',
  'board.columns.set',
  'sync.set',
  'card.update',
  'card.seen',
  'card.delete',
  'archive.clear',
  'seen.check',
  'chat.preview',
  'attach.put',
  'attach.drop',
  'chat.send',
  'menu.pick',
  'judge.run',
  'judge.tally',
  'chat.archive',
  'chat.reopen',
  'chat.focus'
] as const

/** The server's worker tells its own panels of changes, not this one: the board is asked this often instead. */
const POLL_MS = 5000
/** The same while the server answers directly (see direct.ts). */
const DIRECT_POLL_MS = 1500
/** The same while the server tells of its changes itself. */
const LISTENING_POLL_MS = 10_000
/** No panel request for this long: no panel is open, so nothing is asked. */
const PANEL_IDLE_MS = 60_000

export default function activate(orca: OrcaWorkerApi): void {
  const applyServer = async (): Promise<void> => {
    try {
      const name = await orca.settings.get('remoteServer')
      setOrcaEnvironment(typeof name === 'string' ? name : 'L1-PC')
    } catch {
      setOrcaEnvironment('L1-PC')
    }
  }
  let ready = applyServer()
  orca.settings.onDidChange(() => {
    const before = orcaEnvironment()
    ready = applyServer().then(() => {
      if (orcaEnvironment() !== before) {
        forgetWebTab()
        forgetDoor()
      }
    })
  })

  /** What to tell the reader when the server did not answer at all. */
  const TROUBLE: Record<Exclude<RemoteTrouble, null>, (server: string) => string> = {
    unreachable: (s) => `서버 ${s}에 닿지 않습니다. 그 컴퓨터의 Orca가 켜져 있는지, Tailscale이 연결돼 있는지 확인하세요.`,
    'no-server': (s) => `'${s}'(이)라는 이름으로 저장된 Orca 서버가 없습니다. 설정의 '원격 Orca 서버 이름'을 확인하세요.`,
    'no-plugin': (s) => `서버 ${s}에 Chat Board가 개발 플러그인으로 로드돼 있지 않습니다.`
  }

  /** A request to the server's Chat Board; a server that does not answer is said in plain words. */
  const ask = async (name: string, input: unknown): Promise<unknown> => {
    try {
      return await askServer(TARGET, name, input, (line) => orca.log(line))
    } catch (err) {
      const trouble = (err as { trouble?: RemoteTrouble }).trouble
      if (!trouble) throw err
      throw new Error(TROUBLE[trouble](orcaEnvironment()))
    }
  }

  /** The board as the panel last got it, to tell a change from no change. */
  let shown = ''
  let boardAt = 0
  let askedAt = 0

  const isBoard = (v: unknown): boolean => !!v && typeof v === 'object' && Array.isArray((v as { columns?: unknown }).columns) && Array.isArray((v as { cards?: unknown }).cards)

  /** Where each card's chat is on the server (its terminal, or for a chat tab its workspace), from the last board. */
  type Place = { handle: string | null; chatTab: boolean; worktreeId: string }
  let placeOf: Record<string, Place> = {}
  const noteBoard = (board: unknown): void => {
    const cards = (board as { cards: { key: string; handle?: string | null; sessionId?: string | null; worktreeId?: string }[] }).cards
    placeOf = Object.fromEntries(cards.map((c) => [c.key, { handle: c.handle ?? null, chatTab: !!c.sessionId, worktreeId: c.worktreeId ?? '' }]))
  }

  /** This machine's own unseen marks (see unseen.ts): the server's panel clears the server's first. */
  const marks = unseenHere()
  const adorn = (board: unknown): void => marks.adorn((board as { cards: SeenCard[] }).cards, Date.now())
  const sawHere = (key: string): void => marks.saw(key)

  /** Why a chat's tab is not showing, for the panel's message. */
  const WHY: Record<string, string> = {
    'not-paired': '브라우저 탭의 Orca 웹 화면이 아직 서버와 연결되지 않았습니다. 그 탭에 페어링 링크를 한 번 붙여 넣어 주세요.',
    'not-ready': 'Orca 웹 화면이 아직 열리지 않았습니다. 잠시 뒤 다시 눌러 주세요.',
    'no-workspace': '웹 화면의 목록에 이 대화의 워크스페이스가 없습니다.',
    'workspace-not-opened': '웹 화면에서 이 대화의 워크스페이스가 열리지 않았습니다.',
    'no-tab': '웹 화면에 이 대화의 탭이 없습니다.',
    'tab-not-active': '웹 화면에서 이 대화의 탭으로 바뀌지 않았습니다.'
  }

  /**
   * Shows a chat's tab in this machine's Orca. Nothing a plugin can call moves this window to a
   * server's tab (tried: `orca terminal switch --environment`, which moves the server's own
   * window, and `workspace.open` with the server's workspace id), so the server's web client in
   * a browser tab here is steered to it. Answers null when the chat's place is not known here.
   */
  type Shown = { ok: boolean; error: string | null }
  /** The chat being shown, or just shown: the panel asks twice for one click (the card, then its reply box). */
  let showing: { key: string; at: number; result: Promise<Shown | null> } | null = null
  const SAME_CLICK_MS = 1500

  function focusHere(key: string): Promise<Shown | null> {
    if (showing && showing.key === key && Date.now() - showing.at < SAME_CLICK_MS) return showing.result
    const mine = { key, at: Date.now(), result: showHere(key) }
    showing = mine
    // The time counts from when it was shown, and a failure is not kept.
    void mine.result.then((r) => {
      if (r?.ok) mine.at = Date.now()
      else if (showing === mine) showing = null
    })
    return mine.result
  }

  /** Chats are shown one at a time (each takes two seconds or more here), and of those that wait only the last. */
  let lastAsked = 0
  let showTurn: Promise<void> = Promise.resolve()

  /** Longest a chat being shown keeps the next one waiting: a command that hangs must not hold up all after it. */
  const SHOW_TURN_MS = 12_000
  /** A chat that waited this long is not shown any more: its box has stopped waiting (30 s). */
  const SHOW_STALE_MS = 20_000

  async function showHere(key: string): Promise<Shown | null> {
    const place = placeOf[key]
    if (!place || !place.worktreeId) return null
    const mine = ++lastAsked
    const asked = Date.now()
    const before = showTurn
    let done = (): void => undefined
    showTurn = new Promise<void>((free) => (done = free))
    await before
    const release = setTimeout(done, SHOW_TURN_MS)
    try {
      // Another chat was asked for while this one waited: this one is passed over.
      if (mine !== lastAsked) return { ok: false, error: null }
      if (Date.now() - asked > SHOW_STALE_MS) {
        tellServer(`chat ${key.slice(0, 8)} not shown here: waited ${Date.now() - asked} ms for the one before`)
        return { ok: false, error: null }
      }
      return await showNow(key, place)
    } finally {
      clearTimeout(release)
      done()
    }
  }

  async function showNow(key: string, place: Place): Promise<Shown | null> {
    const began = Date.now()
    const attempt = async (): Promise<string> => {
      try {
        // A card's key is its tab's id on the server, which the web client's tabs carry too.
        return await showChatInWebTab(place.worktreeId, key)
      } catch (err) {
        return (err as Error).message.split('\n').pop() ?? ''
      }
    }
    let answer = await attempt()
    // Orca's browser helper kept a session from before Orca started again, and cannot close it
    // (see stale.ts): it is cleared here and the chat shown again, once.
    const stale = staleSessionOf(answer)
    if (stale) {
      const line = `stale browser helper session ${stale}: ${await clearStaleSession(stale)}, after ${Date.now() - began} ms`
      orca.log(line)
      tellServer(line)
      answer = await attempt()
    }
    const line = `chat ${key.slice(0, 8)} ${answer === 'ok' ? 'shown here' : `not shown here: ${answer.slice(0, 80)}`} in ${Date.now() - began} ms (${lastSteps()})`
    orca.log(line)
    tellServer(line)
    if (answer !== 'ok') {
      return { ok: false, error: WHY[answer] ?? answer }
    }
    // What the server's worker does after showing a chat: it counts as seen.
    void ask('card.seen', { key }).catch(() => undefined)
    return { ok: true, error: null }
  }

  for (const name of REQUESTS) {
    orca.panels.handle(name as never, (async (input: unknown) => {
      await ready
      askedAt = Date.now()
      if (name === 'chat.focus') {
        const here = await focusHere(String((input as { key?: unknown } | null)?.key ?? ''))
        if (here) return here
      }
      const began = Date.now()
      // Its box opened here, or it was answered from here: seen on this machine.
      if (name === 'card.seen' || name === 'chat.send') sawHere(String((input as { key?: unknown } | null)?.key ?? ''))
      const result = await ask(name, input)
      // The slow ones are worth knowing: each is at least one command to the server.
      if (name === 'attach.put' || name === 'chat.send') orca.log(`${name} took ${Date.now() - began} ms`)
      // Most requests answer the whole board: the panel shows it, so it is what the next poll compares with.
      if (isBoard(result)) {
        adorn(result)
        shown = JSON.stringify(result)
        boardAt = Date.now()
        noteBoard(result)
      }
      return result
    }) as never)
  }

  // What the reply boxes here did with the keyboard is also written in the server's log (as
  // 'panel: remote: …'): whoever looks into a trouble sits at the server, not at this machine.
  const tellServer = (line: string): void => void ask('trace', { message: `remote: ${line}`.slice(0, 200) }).catch(() => undefined)

  // The mouse of this machine, for this machine's reply boxes (see keys.ts). Answered here and
  // never passed on: the server's mouse belongs to whoever sits there.
  const KEYS_SPOT_KEY = 'keysSpot'
  let ranOutLoggedAt = 0
  void orca.storage.get(KEYS_SPOT_KEY as never).then(setMarkedSpot).catch(() => undefined)
  orca.panels.handle('keys.click' as never, (async (input: { op?: KeysOp } | null) => {
    const op = input?.op
    if (!op) return { ok: false }
    const ok = await keys(op)
    if (op === 'mark' && ok) void orca.storage.set(KEYS_SPOT_KEY as never, markedSpot() as never).catch(() => undefined)
    // Not each wait that ran out (a box goes on asking for as long as you are away): one a minute.
    const ranOut = op === 'move' && !ok && /^(given up|cancelled)/.test(keysWhy())
    if (ranOut && keysWhy() === 'cancelled') return { ok }
    if (ranOut && Date.now() - ranOutLoggedAt < 60_000) return { ok }
    if (ranOut) ranOutLoggedAt = Date.now()
    if (op !== 'warm' && op !== 'cancel' && (op !== 'mark' || !ok)) {
      const line = `mouse for the reply box, ${op}: ${ok ? 'done' : `not done (${keysWhy()})`}`
      orca.log(line)
      tellServer(line)
    }
    return { ok }
  }) as never)

  // Whether the server answers directly: the panel then sends pictures as they are.
  orca.panels.handle('link.direct' as never, (() => isDirect()) as never)

  orca.panels.handle('trace' as never, ((input: { message?: unknown } | null) => {
    orca.log(`panel: ${String(input?.message).slice(0, 200)}`)
    tellServer(String(input?.message))
  }) as never)

  /** A board that came from the server by any way: the panel gets it when it differs from what it has. */
  const take = (board: unknown): void => {
    if (!isBoard(board)) return
    adorn(board)
    const text = JSON.stringify(board)
    if (text === shown) return
    shown = text
    noteBoard(board)
    orca.panels.post('board.changed' as never, board as never)
  }
  // The server tells of its changes itself while it answers directly.
  onServerEvent((name, payload) => {
    if (name !== 'board.changed') return
    boardAt = Date.now()
    take(payload)
  })

  let polling = false
  setInterval(() => {
    const now = Date.now()
    keepListening((line) => orca.log(line))
    // Asked directly a request costs next to nothing, so the board is kept fresher; told of
    // changes, it is only asked now and then, in case a change was not told.
    const pace = isListening() ? LISTENING_POLL_MS : isDirect() ? DIRECT_POLL_MS : POLL_MS
    if (polling || now - askedAt > PANEL_IDLE_MS || now - boardAt < pace) return
    polling = true
    void (async () => {
      try {
        await ready
        const board = await ask('board.get', {})
        boardAt = Date.now()
        take(board)
      } catch (err) {
        orca.log(`board not read from the server: ${(err as Error).message.split('\n')[0]}`)
      } finally {
        polling = false
      }
    })()
  }, 500)

  // Measured from an office machine over Tailscale (2026-11-16): one command to the server takes
  // 2.5 to 3.5 s there (0.8 s on the server's own machine), two or three at once take 3.6 s in
  // all, six at once 6.4 s. So about a second a command however many run, on top of 2.5 s.

  // The manifest names these; this machine's own agents are not on this board.
  orca.events.on('agent.status.changed', () => undefined)
  orca.hooks.on('agent.tool.after', () => undefined)
}
