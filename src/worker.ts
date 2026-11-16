// Chat Board (remote): the panel of the Chat Board that runs on a paired Orca server. This worker
// keeps nothing: every panel request is passed to that plugin's worker through the orca CLI
// (`orca plugin dev request … --environment <server>`), so the board, its columns, statuses,
// reviews and settings are the server's own.
import type { OrcaWorkerApi } from 'orca/worker'
import { orcaEnvironment, setOrcaEnvironment, type RemoteTrouble } from './cli.ts'
import { askServer, forgetDoor, isDirect } from './direct.ts'
import { forgetWebTab, showChatInWebTab } from './webtab.ts'

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

  async function showHere(key: string): Promise<Shown | null> {
    const place = placeOf[key]
    if (!place || !place.worktreeId) return null
    let answer: string
    try {
      // A card's key is its tab's id on the server, which the web client's tabs carry too.
      answer = await showChatInWebTab(place.worktreeId, key)
    } catch (err) {
      answer = (err as Error).message.split('\n').pop() ?? ''
    }
    if (answer !== 'ok') {
      orca.log(`chat ${key.slice(0, 8)} not shown here: ${answer}`)
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
      const result = await ask(name, input)
      // The slow ones are worth knowing: each is at least one command to the server.
      if (name === 'attach.put' || name === 'chat.send') orca.log(`${name} took ${Date.now() - began} ms`)
      // Most requests answer the whole board: the panel shows it, so it is what the next poll compares with.
      if (isBoard(result)) {
        shown = JSON.stringify(result)
        boardAt = Date.now()
        noteBoard(result)
      }
      return result
    }) as never)
  }

  // Whether the server answers directly: the panel then sends pictures as they are.
  orca.panels.handle('link.direct' as never, (() => isDirect()) as never)

  orca.panels.handle('trace' as never,((input: { message?: unknown } | null) => {
    orca.log(`panel: ${String(input?.message).slice(0, 200)}`)
  }) as never)

  let polling = false
  setInterval(() => {
    const now = Date.now()
    // Asked directly a request costs next to nothing, so the board is kept fresher.
    if (polling || now - askedAt > PANEL_IDLE_MS || now - boardAt < (isDirect() ? DIRECT_POLL_MS : POLL_MS)) return
    polling = true
    void (async () => {
      try {
        await ready
        const board = await ask('board.get', {})
        boardAt = Date.now()
        const text = JSON.stringify(board)
        if (isBoard(board) && text !== shown) {
          shown = text
          noteBoard(board)
          orca.panels.post('board.changed' as never, board as never)
        }
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
