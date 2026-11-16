// The short way to the server: the orca CLI is faked through setOrcaRunner, the door through fetch.
import { afterEach, assert, test } from 'orca/testing'
import { setOrcaEnvironment, setOrcaRunner } from './cli.ts'
import { askServer, forgetDoor, isDirect, parseEvent } from './direct.ts'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  setOrcaRunner(null)
  forgetDoor()
})

type Call = { url: string; name?: string }

/** The server through the CLI: `remote.open` answers a door, anything else `{ via: 'cli', name }`. */
function fakeCli(door: unknown = { address: '100.64.0.9', port: 4927, token: 'secret' }): string[] {
  const asked: string[] = []
  setOrcaEnvironment('SERVER')
  setOrcaRunner(async (args) => {
    const name = args[4]!
    asked.push(name)
    return JSON.stringify({ ok: true, result: { result: name === 'remote.open' ? door : { via: 'cli', name } } })
  })
  return asked
}

/** The door: answers what `answer` says for each request. */
function fakeDoor(answer: (name: string) => Response | Promise<Response>): Call[] {
  const calls: Call[] = []
  globalThis.fetch = (async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    const name = init?.body ? (JSON.parse(init.body) as { name: string }).name : undefined
    calls.push({ url: String(url), name })
    assert.equal(init?.headers?.authorization, 'Bearer secret', 'every request carries the token')
    return answer(name ?? '')
  }) as unknown as typeof fetch
  return calls
}

const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 })
const settle = () => new Promise((done) => setTimeout(done, 20))
const quiet = () => undefined

test('the first request goes through the CLI and opens the door; the next ones use it', async () => {
  const asked = fakeCli()
  const calls = fakeDoor((name) => ok({ via: 'door', name }))
  assert.deepEqual(await askServer('local.chat-board', 'board.get', {}, quiet), { via: 'cli', name: 'board.get' })
  await settle()
  assert.equal(isDirect(), true)
  assert.deepEqual(asked, ['remote.open', 'board.get'])
  assert.deepEqual(calls[0], { url: 'http://100.64.0.9:4927/request', name: 'trace' }, 'the door is tried before it is used')
  assert.deepEqual(await askServer('local.chat-board', 'board.move', { key: 'a' }, quiet), { via: 'door', name: 'board.move' })
  assert.deepEqual(asked, ['remote.open', 'board.get'], 'nothing more through the CLI')
})

test('a server with no door is not asked for one on every request', async () => {
  const asked = fakeCli({ error: 'This machine has no Tailscale address' })
  const lines: string[] = []
  await askServer('local.chat-board', 'board.get', {}, (l) => lines.push(l))
  await settle()
  await askServer('local.chat-board', 'board.get', {}, quiet)
  await settle()
  assert.equal(isDirect(), false)
  assert.deepEqual(asked, ['remote.open', 'board.get', 'board.get'])
  assert.match(lines[0]!, /no direct way.*no Tailscale address/)
})

test('an error the handler threw is the answer, and the door stays', async () => {
  fakeCli()
  fakeDoor((name) => (name === 'trace' ? ok(null) : new Response(JSON.stringify({ ok: false, error: 'closed' }), { status: 200 })))
  await askServer('local.chat-board', 'board.get', {}, quiet)
  await settle()
  await assert.rejects(askServer('local.chat-board', 'chat.send', { key: 'a', text: 'hi' }, quiet), /closed/)
  assert.equal(isDirect(), true)
})

test('a door that is gone: a request never sent goes through the CLI', async () => {
  const asked = fakeCli()
  let up = true
  fakeDoor((name) => {
    if (up) return ok({ via: 'door', name })
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
  })
  await askServer('local.chat-board', 'board.get', {}, quiet)
  await settle()
  up = false
  // Refused before anything was sent: even a message may go the long way.
  assert.deepEqual(await askServer('local.chat-board', 'chat.send', { key: 'a', text: 'hi' }, quiet), { via: 'cli', name: 'chat.send' })
  assert.equal(isDirect(), false)
  assert.equal(asked.includes('chat.send'), true)
})

test('a door that fails mid-request: a message is not typed twice, a read is asked again', async () => {
  const asked = fakeCli()
  let up = true
  fakeDoor((name) => {
    if (up) return ok({ via: 'door', name })
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })
  })
  await askServer('local.chat-board', 'board.get', {}, quiet)
  await settle()
  up = false
  await assert.rejects(askServer('local.chat-board', 'chat.send', { key: 'a', text: 'hi' }, quiet), /직접 연결/)
  assert.equal(asked.includes('chat.send'), false, 'the message did not go through the CLI as well')
  // The door is asked for again, and is still down; a read goes the long way meanwhile.
  await settle()
  assert.deepEqual(await askServer('local.chat-board', 'board.get', {}, quiet), { via: 'cli', name: 'board.get' })
})

test('a token the server no longer takes sends the request the long way and asks for the door again', async () => {
  const asked = fakeCli()
  let taken = true
  fakeDoor((name) => (taken ? ok({ via: 'door', name }) : new Response('{}', { status: 401 })))
  await askServer('local.chat-board', 'board.get', {}, quiet)
  await settle()
  taken = false
  // Refused at the door, so not done there: it may go through the CLI.
  assert.deepEqual(await askServer('local.chat-board', 'board.get', {}, quiet), { via: 'cli', name: 'board.get' })
  assert.equal(isDirect(), false)
  assert.equal(asked.filter((n) => n === 'remote.open').length, 2)
})

test('an event of the stream is the server’s name and payload; a ping is nothing', () => {
  assert.deepEqual(parseEvent('data: {"name":"board.changed","payload":{"cards":[]}}'), { name: 'board.changed', payload: { cards: [] } })
  assert.equal(parseEvent(': ping'), null)
  assert.equal(parseEvent('data: not json'), null)
})
