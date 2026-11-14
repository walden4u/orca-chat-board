// Finding the programs the worker starts for a review, and the environment a judge runs in.
import { assert, test } from 'orca/testing'
import { claudeProgram, gitProgram, judgeEnv } from './tools.ts'

const win = (env: Record<string, string>) => ({ platform: 'win32', env })

test("npm's claude.cmd leads to the claude.exe beside it", () => {
  const host = win({ PATH: 'C:\\Windows;C:\\npm', PATHEXT: '.COM;.EXE;.BAT;.CMD' })
  const exe = 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
  const installed = new Set(['C:\\npm\\claude.cmd', exe])
  assert.equal(claudeProgram(host, (p) => installed.has(p)), exe)
  // A program on PATH is used as it is.
  assert.equal(claudeProgram(host, (p) => p === 'C:\\Windows\\claude.exe'), 'C:\\Windows\\claude.exe')
  // A wrapper without its program is not started: cmd.exe would mangle the prompt.
  assert.equal(claudeProgram(host, (p) => p === 'C:\\npm\\claude.cmd'), null)
  assert.equal(claudeProgram(host, () => false), null)
})

test('elsewhere claude and git come from PATH or the usual places', () => {
  const host = { platform: 'darwin', env: { PATH: '/usr/bin:/opt/bin', HOME: '/Users/me' } }
  assert.equal(claudeProgram(host, (p) => p === '/opt/bin/claude'), '/opt/bin/claude')
  assert.equal(claudeProgram(host, (p) => p === '/Users/me/.local/bin/claude'), '/Users/me/.local/bin/claude')
  assert.equal(claudeProgram(host, () => false), null)
  assert.equal(gitProgram(host, (p) => p === '/usr/bin/git'), '/usr/bin/git')
  assert.equal(gitProgram(win({ PATH: 'C:\\Git\\cmd' }), (p) => p === 'C:\\Git\\cmd\\git.exe'), 'C:\\Git\\cmd\\git.exe')
  assert.equal(gitProgram(win({ PATH: 'C:\\Git\\cmd' }), () => false), null)
})

test('a judge inherits nothing that marks a process as an agent of Orca or a child of Claude Code', () => {
  const env = judgeEnv(
    win({
      PATH: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\me',
      ORCA_PANE_KEY: 'tab1:0',
      ORCA_AGENT_HOOK_TOKEN: 'secret',
      CLAUDE_CODE_SESSION_ID: 'abc',
      CLAUDECODE: '1',
      CLAUDE_EFFORT: 'xhigh',
      // Where you told Claude Code to keep its files: the judge logs in from there too.
      CLAUDE_CONFIG_DIR: 'D:\\claude'
    })
  )
  assert.deepEqual(Object.keys(env).sort(), ['APPDATA', 'CLAUDE_CONFIG_DIR', 'PATH', 'USERPROFILE'])
  // The worker has no APPDATA of its own; a program started from it gets one.
  assert.equal(env.APPDATA, 'C:\\Users\\me\\AppData\\Roaming')
})
