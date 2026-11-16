// Chat Board (remote): the panel of the Chat Board that runs on a paired Orca server. This worker
// keeps nothing: every panel request is passed to that plugin's worker through the orca CLI
// (`orca plugin dev request … --environment <server>`), so the board, its columns, statuses,
// reviews and settings are the server's own.
import type { OrcaWorkerApi } from 'orca/worker'
import { requestRemote, setOrcaEnvironment } from './cli.ts'
import { showChatInWebTab } from './webtab.ts'

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
    ready = applyServer()
  })

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
  async function focusHere(key: string): Promise<{ ok: boolean; error: string | null } | null> {
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
    void requestRemote(TARGET, 'card.seen', { key }).catch(() => undefined)
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
      const result = await requestRemote(TARGET, name, input)
      // Most requests answer the whole board: the panel shows it, so it is what the next poll compares with.
      if (isBoard(result)) {
        shown = JSON.stringify(result)
        boardAt = Date.now()
        noteBoard(result)
      }
      return result
    }) as never)
  }

  orca.panels.handle('trace' as never, ((input: { message?: unknown } | null) => {
    orca.log(`panel: ${String(input?.message).slice(0, 200)}`)
  }) as never)

  let polling = false
  setInterval(() => {
    const now = Date.now()
    if (polling || now - askedAt > PANEL_IDLE_MS || now - boardAt < POLL_MS) return
    polling = true
    void (async () => {
      try {
        await ready
        const board = await requestRemote(TARGET, 'board.get', {})
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
  }, POLL_MS)

  // The manifest names these; this machine's own agents are not on this board.
  orca.events.on('agent.status.changed', () => undefined)
  orca.hooks.on('agent.tool.after', () => undefined)
}
