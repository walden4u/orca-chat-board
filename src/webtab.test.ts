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

test("Orca's complaint about a stale helper session names it", async () => {
  const { staleSessionOf } = await import('./stale.ts')
  assert.equal(
    staleSessionOf('Could not reset stale helper session orca-tab-d7d48f78-5d00-449d-ab09-f0ecb9603c5b; retry after agent-browser exits'),
    'orca-tab-d7d48f78-5d00-449d-ab09-f0ecb9603c5b'
  )
  assert.equal(staleSessionOf('not-ready'), null)
})
