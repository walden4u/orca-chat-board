// A door for the board shown from another machine. That board's worker reaches this one through
// `orca plugin dev request --environment <server>`, a new process and a new connection for every
// request (2.5 s and more from an office machine). Once asked (`remote.open`), this worker also
// answers the same requests over HTTP on the machine's Tailscale address, where one costs a few
// milliseconds. Only that address is listened on, and only requests carrying the token are answered.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'

export type RemoteDoor = { address: string; port: number; token: string }
export type RemoteHandler = (input: never) => unknown

/** Tried first, so the door stays where it was when the worker is loaded again. */
const PORT = 4927
/** One request: the largest is a piece of a picture, far below this. */
const MAX_BODY_BYTES = 2 * 1024 * 1024

/** This machine's address on its tailnet (Tailscale gives out 100.64.0.0/10), or null without one. */
export function tailnetAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      const m = /^100\.(\d+)\./.exec(a.address)
      if (a.family === 'IPv4' && !a.internal && m && Number(m[1]) >= 64 && Number(m[1]) <= 127) return a.address
    }
  }
  return null
}

export function newToken(): string {
  return randomBytes(32).toString('hex')
}

function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given, 'utf8')
  const b = Buffer.from(token, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** An open door: where it is, a way to tell the boards listening what changed, and a way to shut it. */
export type OpenDoor = { door: RemoteDoor; tell(name: string, payload: unknown): void; close(): void }

/** A line this often on a quiet stream, so a listener can tell a dead one from a quiet one. */
const PING_MS = 15_000

/**
 * Starts answering `handlers` over HTTP: `POST /request` with `{ name, input }` and the token as
 * a bearer answers `{ ok: true, result }` or `{ ok: false, error }`. `GET /events` is a stream
 * (server-sent events) of what `tell` is given, as `{ name, payload }`: the board changing, which
 * a board on another machine would otherwise have to keep asking for. Rejects when the machine
 * has no tailnet address or no port can be listened on.
 */
export function openDoor(handlers: Map<string, RemoteHandler>, token: string): Promise<OpenDoor> {
  const address = tailnetAddress()
  if (!address) return Promise.reject(new Error('This machine has no Tailscale address'))
  const listeners = new Set<{ write(text: string): void; end(): void }>()
  const server = createServer((req, res) => {
    const answer = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    // Alt+K pressed in the server's web client, shown in a browser tab on the other machine: that
    // page takes the key before Orca sees it, so it posts it here (a plain no-cors fetch, which can
    // carry no header: the token is in the body) and the boards listening hear `keys.bring`.
    if (req.method === 'POST' && req.url === '/key') {
      const chunks: Uint8Array[] = []
      let size = 0
      req.on('data', (chunk: Uint8Array) => {
        size += chunk.length
        if (size > 4096) req.destroy()
        else chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          // `what`: 'key' (Alt+K), or 'mark' (you clicked in a terminal there: where, for later).
          const { token: given, from, what } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { token?: unknown; from?: unknown; what?: unknown }
          const payload = { from: String(from ?? ''), what: what === 'mark' ? 'mark' : 'key' }
          if (typeof given === 'string' && sameToken(given, token)) send(`data: ${JSON.stringify({ name: 'keys.bring', payload })}\n\n`)
        } catch {
          // Not a key from the page: nothing to tell.
        }
        res.writeHead(204, { 'access-control-allow-origin': '*' })
        res.end()
      })
      return
    }
    const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
    if (!sameToken(given, token)) return answer(401, { ok: false, error: 'unauthorized' })
    if (req.method === 'GET' && req.url === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      res.write(': open\n\n')
      listeners.add(res)
      req.on('close', () => listeners.delete(res))
      return
    }
    if (req.method !== 'POST' || req.url !== '/request') return answer(404, { ok: false, error: 'not found' })
    const chunks: Uint8Array[] = []
    let size = 0
    req.on('data', (chunk: Uint8Array) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) req.destroy()
      else chunks.push(chunk)
    })
    req.on('end', () => {
      void (async () => {
        try {
          const { name, input } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { name?: unknown; input?: unknown }
          const handler = typeof name === 'string' ? handlers.get(name) : undefined
          if (!handler) return answer(200, { ok: false, error: `no panel handler named ${String(name)}` })
          answer(200, { ok: true, result: (await handler(input as never)) ?? null })
        } catch (err) {
          answer(200, { ok: false, error: (err as Error).message })
        }
      })()
    })
  })
  // The door does not keep the worker alive on its own.
  server.unref()
  const send = (text: string): void => {
    for (const listener of listeners) {
      try {
        listener.write(text)
      } catch {
        listeners.delete(listener)
      }
    }
  }
  const ping = setInterval(() => send(': ping\n\n'), PING_MS)
  ;(ping as { unref?: () => void }).unref?.()
  const open = (door: RemoteDoor): OpenDoor => ({
    door,
    tell: (name, payload) => {
      if (listeners.size) send(`data: ${JSON.stringify({ name, payload })}\n\n`)
    },
    close: () => {
      clearInterval(ping)
      for (const listener of listeners) listener.end()
      listeners.clear()
      server.close()
      server.closeAllConnections()
    }
  })
  return new Promise((resolve, reject) => {
    let fallback = false
    server.on('error', (err: Error & { code?: string }) => {
      // The usual port is taken (an older worker still going): any free one will do.
      if (!fallback && err.code === 'EADDRINUSE') {
        fallback = true
        server.listen(0, address)
      } else reject(err)
    })
    server.on('listening', () => resolve(open({ address, port: server.address().port, token })))
    server.listen(PORT, address)
  })
}
