import { assert, test } from 'orca/testing'
import { steerScript, webUrlOf } from './webtab.ts'

test('the web client is at the server’s address over http', () => {
  assert.equal(webUrlOf('ws://100.64.0.9:4926'), 'http://100.64.0.9:4926/')
  assert.equal(webUrlOf('wss://host.example:443/'), 'https://host.example:443/')
})

test('the script run in the web client is one expression that parses, whatever the ids hold', () => {
  for (const [worktree, tab] of [
    ['repo::C:\\Dropbox\\Work\\Kindle', 'e1e290de-d43f'],
    ['repo::/Users/me/it\'s "quoted"', 'tab"); alert(1); ("'],
    ['repo::C:/a</script>', 'x\n\ny']
  ] as const) {
    const script = steerScript(worktree, tab)
    assert.equal(script.includes('\n'), false, 'one line: it travels as a command-line argument')
    // Parsed, not run: there is no page here.
    assert.equal(typeof new Function(`return ${script}`), 'function')
    assert.equal(script.includes(JSON.stringify(worktree)), true, 'the ids go in as string literals')
    assert.equal(script.includes(JSON.stringify(tab)), true)
  }
})

test('the key hook posts Alt+K once, only Alt+K, and swallows it; run again it only moves where to post', async () => {
  const { keyHook } = await import('./webtab.ts')
  const listeners: ((e: unknown) => void)[] = []
  const marks: ((e: unknown) => void)[] = []
  const win = { addEventListener: (type: string, f: (e: unknown) => void) => (type === 'keydown' ? listeners : marks).push(f) } as Record<string, unknown>
  const posts: [string, { body: string; mode: string }][] = []
  const fetch = (url: string, init: { body: string; mode: string }): Promise<void> => (posts.push([url, init]), Promise.resolve())
  class Element {
    constructor(readonly inTerminal: boolean) {}
    closest(): unknown {
      return this.inTerminal ? this : null
    }
    querySelector(): null {
      return null
    }
  }
  const seen: (() => void)[] = []
  const doc = { hidden: false, activeElement: null, addEventListener: (_: string, f: () => void) => seen.push(f) }
  const run = (hook: string): void => new Function('window', 'fetch', 'Element', 'document', hook)(win, fetch, Element, doc)
  const body = JSON.stringify({ token: 't"k', from: 'me', what: 'key' })
  run(keyHook('http://a:4927/key', 't"k', 'me'))
  run(keyHook('http://b:4927/key', 't"k', 'me'))
  assert.equal(listeners.length, 1)
  assert.equal(marks.length, 1)
  const key = (o: Record<string, unknown>): { stopped: boolean } => {
    const seen = { stopped: false }
    listeners[0]({ altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, repeat: false, code: 'KeyK', preventDefault() {}, stopImmediatePropagation: () => (seen.stopped = true), ...o })
    return seen
  }
  assert.equal(key({}).stopped, false)
  assert.equal(key({ altKey: true, code: 'KeyJ' }).stopped, false)
  assert.equal(key({ altKey: true, shiftKey: true }).stopped, false)
  assert.equal(key({ altKey: true }).stopped, true)
  assert.equal(key({ altKey: true, repeat: true }).stopped, true)
  assert.equal(posts.length, 1)
  assert.equal(posts[0][0], 'http://b:4927/key')
  assert.equal(posts[0][1].body, body)
  assert.equal(posts[0][1].mode, 'no-cors')
  // Your click in a terminal there is marked, once in a while; elsewhere, or made by a script, not.
  marks[0]({ isTrusted: true, button: 0, target: new Element(false) })
  marks[0]({ isTrusted: false, button: 0, target: new Element(true) })
  assert.equal(posts.length, 1)
  marks[0]({ isTrusted: true, button: 0, target: new Element(true) })
  marks[0]({ isTrusted: true, button: 0, target: new Element(true) })
  assert.equal(posts.length, 2)
  assert.equal(JSON.parse(posts[1][1].body).what, 'mark')
  // Out of sight is told; back in sight is not (the board shows the chat itself then).
  assert.equal(seen.length, 1)
  seen[0]()
  assert.equal(posts.length, 2)
  doc.hidden = true
  seen[0]()
  assert.equal(JSON.parse(posts[2][1].body).what, 'page-hidden')
  const script = (await import('./webtab.ts')).steerScript('w', 't', keyHook('http://a/key', 't', 'me'))
  assert.equal(script.includes('\n'), false)
  assert.equal(typeof new Function(`return ${script}`), 'function')
})

test("Orca's complaint about a stale helper session names it", async () => {
  const { staleSessionOf } = await import('./stale.ts')
  assert.equal(
    staleSessionOf('Could not reset stale helper session orca-tab-d7d48f78-5d00-449d-ab09-f0ecb9603c5b; retry after agent-browser exits'),
    'orca-tab-d7d48f78-5d00-449d-ab09-f0ecb9603c5b'
  )
  assert.equal(staleSessionOf('not-ready'), null)
})
