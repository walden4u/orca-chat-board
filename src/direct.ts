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

/** Where the server's web client page posts Alt+K (see webtab.ts `keyHook`), while there is a door. */
export function keyDoor(): { url: string; token: string } | null {
  return door ? { url: `${door.url}/key`, token: door.token } : null
}

/** Forgets the door: the server shown has changed. */
export function forgetDoor(): void {
  door = null
  opening = null
  retryAt = 0
  stopListening()
}

// ---------- what the server tells of its own accord ----------

/** The server sends a line at least every 15 s; this long without one, the stream is dead. */
const QUIET_MS = 40_000
let hear: ((name: string, payload: unknown) => void) | null = null
let stream: { of: Door; stop: AbortController; at: number } | null = null

/** Whether the server's changes are arriving by themselves (then the board need not be asked for). */
export function isListening(): boolean {
  return stream !== null && stream.of === door && Date.now() - stream.at < QUIET_MS
}

/** Sets who hears what the server tells (`board.changed`); the stream follows the door by itself. */
export function onServerEvent(listener: (name: string, payload: unknown) => void): void {
  hear = listener
}

function stopListening(): void {
  stream?.stop.abort()
  stream = null
}

/** One event stream block (`data: …` lines) as the server's `{ name, payload }`, or null for a ping. */
export function parseEvent(block: string): { name: string; payload: unknown } | null {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return null
  try {
    const event = JSON.parse(data) as { name?: unknown; payload?: unknown }
    return typeof event.name === 'string' ? { name: event.name, payload: event.payload } : null
  } catch {
    return null
  }
}

/** Reads the server's event stream until it ends; called whenever a door is there with no stream. */
function listen(to: Door, log: (line: string) => void): void {
  if (stream?.of === to) return
  stopListening()
  const mine = { of: to, stop: new AbortController(), at: Date.now() }
  stream = mine
  void (async () => {
    try {
      const res = await fetch(`${to.url}/events`, { headers: { authorization: `Bearer ${to.token}` }, signal: mine.stop.signal })
      if (res.status !== 200 || !res.body) throw new Error(`the server's door answered ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let text = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        mine.at = Date.now()
        text += decoder.decode(value, { stream: true })
        let end: number
        while ((end = text.indexOf('\n\n')) >= 0) {
          const event = parseEvent(text.slice(0, end))
          text = text.slice(end + 2)
          if (event) hear?.(event.name, event.payload)
        }
      }
    } catch (err) {
      if (!mine.stop.signal.aborted) log(`the server's changes stopped arriving: ${(err as Error).message}`)
    } finally {
      // The next request finds no stream and starts one, or finds the door gone and asks for it.
      if (stream === mine) stream = null
    }
  })()
}

/** Called now and then: starts the stream when a door is there without one, ends one gone quiet. */
export function keepListening(log: (line: string) => void): void {
  if (stream && Date.now() - stream.at >= QUIET_MS) stopListening()
  if (door && !stream) listen(door, log)
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
