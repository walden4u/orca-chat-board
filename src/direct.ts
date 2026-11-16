// The short way to the server's Chat Board. A request through the orca CLI is a new process and
// a new connection each time (2.5 s and more from an office machine). Asked once that way
// (`remote.open`), the server's worker answers the same requests over HTTP on its Tailscale
// address, which costs a few milliseconds. Whenever that door does not answer, the CLI is used.
import { requestRemote } from './cli.ts'

type Door = { url: string; token: string }

let door: Door | null = null
let opening: Promise<void> | null = null
/** Not asked for again before this time: a server that has no door is not asked on every request. */
let retryAt = 0
const RETRY_MS = 60_000
/** A panel request may take 30 seconds on the server; then the answer still has to come back. */
const TIMEOUT_MS = 40_000

/** Asked again with no harm done: when the door fails mid-request, these go the long way at once. */
const REPEATABLE = new Set(['board.get', 'chat.preview', 'seen.check', 'attach.put', 'attach.drop', 'card.seen', 'judge.tally'])
/** The door was never reached: nothing was asked, so anything may go the long way. */
const NOT_REACHED = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EADDRNOTAVAIL'])

export function isDirect(): boolean {
  return door !== null
}

/** Forgets the door: the server shown has changed. */
export function forgetDoor(): void {
  door = null
  opening = null
  retryAt = 0
}

async function post(to: Door, name: string, input: unknown): Promise<unknown> {
  const res = await fetch(`${to.url}/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${to.token}` },
    body: JSON.stringify({ name, input: input ?? null }),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (res.status !== 200) throw Object.assign(new Error(`the server's door answered ${res.status}`), { door: true })
  const answer = (await res.json()) as { ok?: boolean; result?: unknown; error?: string }
  if (answer.ok !== true) throw new Error(answer.error ?? 'the request failed')
  return answer.result
}

/** Asks the server for its door and tries it; `log` hears how it went. */
function open(target: string, log: (line: string) => void): Promise<void> {
  return (opening ??= (async () => {
    try {
      const said = (await requestRemote(target, 'remote.open', null)) as { address?: string; port?: number; token?: string; error?: string } | null
      if (!said?.address || !said.port || !said.token) throw new Error(said?.error ?? 'the server has no door (an older Chat Board?)')
      const found: Door = { url: `http://${said.address}:${said.port}`, token: said.token }
      const began = Date.now()
      await post(found, 'trace', { message: 'a board on another machine reached the door' })
      door = found
      log(`talking to the server directly at ${said.address}:${said.port} (${Date.now() - began} ms a request)`)
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } }
      retryAt = Date.now() + RETRY_MS
      log(`no direct way to the server, the orca CLI is used: ${e.cause?.code ?? ''} ${e.message.split('\n').pop()}`.replace('  ', ' '))
    } finally {
      opening = null
    }
  })())
}

/** A request to the server's Chat Board: over the door when there is one, else through the CLI. */
export async function askServer(target: string, name: string, input: unknown, log: (line: string) => void): Promise<unknown> {
  const through = door
  if (through) {
    try {
      return await post(through, name, input)
    } catch (err) {
      const e = err as Error & { door?: boolean; cause?: { code?: string }; name: string }
      const broken = e.door === true || e.name === 'TypeError' || e.name === 'TimeoutError' || e.name === 'AbortError'
      // An answer of the handler's own (an error it threw) is the answer.
      if (!broken) throw err
      if (door === through) door = null
      log(`the direct way to the server failed (${e.cause?.code ?? e.message}), back to the orca CLI`)
      const reached = !(e.cause?.code && NOT_REACHED.has(e.cause.code))
      // Sent and maybe done there: a message must not be typed into a chat twice.
      if (reached && !REPEATABLE.has(name)) throw new Error('서버와의 직접 연결이 요청 도중에 끊겼습니다. 처리됐는지 확인한 뒤 다시 시도하세요.')
    }
  }
  if (!door && !opening && Date.now() >= retryAt) void open(target, log)
  return requestRemote(target, name, input)
}
