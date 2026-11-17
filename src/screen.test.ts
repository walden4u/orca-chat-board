// What an agent's screen says: the lists it asks you to pick from.
import { assert, test } from 'orca/testing'
import { keysFor, menuOf } from './screen.ts'

// Screens as `orca terminal read --screen` gave them (Claude Code 2.1.327, 2026-11-18).
const RESUME = [
  '❯ /resume',
  '─────────────────────────────────────────────────────',
  'Resume this conversation?',
  '',
  'This conversation has been inactive for 14h 12m',
  'and is 419.9k tokens long. Resuming it will use',
  'about 6% of your 5-hour usage limit.',
  '',
  '❯ 1. Resume',
  '  2. Start a new conversation  Claude can look',
  '                               this one up if you',
  '                               refer to it later',
  '',
  'Enter to confirm · Esc to resume'
]

const TRUST = [
  '$ claude --model sonnet',
  '─────────────────────────────────────────────────────',
  ' Accessing workspace:',
  ' C:\\Users\\me\\menutest',
  ' Quick safety check: Is this a project you created',
  ' or one you trust?',
  " Claude Code'll be able to read, edit, and execute",
  ' files here.',
  ' Security guide',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  ' Enter to confirm · Esc to cancel'
]

const ASKED = [
  '❯ AskUserQuestion 도구로 좋아하는 색을 빨강과 파랑',
  '  중에 고르라고 물어봐. 다른 일은 하지 마.',
  '─────────────────────────────────────────────────────',
  ' ☐ 좋아하는 색',
  '좋아하는 색은 빨강과 파랑 중 무엇인가요?',
  '❯ 1. 빨강',
  '     빨간색을 선택합니다.',
  '  2. 파랑',
  '     파란색을 선택합니다.',
  '  3. Type something.',
  '─────────────────────────────────────────────────────',
  '  4. Chat about this',
  'Enter to select · ↑/↓ to navigate · Esc to cancel'
]

test('the question whether to resume a long conversation is a numbered list', () => {
  const menu = menuOf(RESUME)
  assert.deepEqual(menu?.options, ['Resume', 'Start a new conversation'])
  assert.equal(menu?.at, 0)
  assert.equal(menu?.numbered, true)
  assert.match(menu!.question, /^Resume this conversation\?\n\nThis conversation has been inactive/)
  assert.deepEqual(keysFor(menu!, 1), ['2'])
})

test('a list without numbers is picked with the arrows and Enter', () => {
  const menu = menuOf(TRUST)
  assert.deepEqual(menu?.options, ['No, exit', 'Yes, I trust this folder'])
  assert.equal(menu?.at, 0)
  assert.equal(menu?.numbered, false)
  assert.match(menu!.question, /^Accessing workspace:/)
  assert.deepEqual(keysFor(menu!, 1), ['\x1b[B', '\r'])
  assert.deepEqual(keysFor(menu!, 0), ['\r'])
  const moved = menuOf(TRUST.map((r) => (r.includes('No, exit') ? '   No, exit' : r.includes('Yes, I') ? ' ❯ Yes, I trust this folder' : r)))
  assert.equal(moved?.at, 1)
  assert.deepEqual(keysFor(moved!, 0), ['\x1b[A', '\r'])
})

test("a question of the agent's: the rows under an option describe it, and the list goes on past a rule", () => {
  const menu = menuOf(ASKED)
  assert.deepEqual(menu?.options, ['빨강', '파랑', 'Type something.', 'Chat about this'])
  assert.equal(menu?.question, '☐ 좋아하는 색\n좋아하는 색은 빨강과 파랑 중 무엇인가요?')
})

test('the pointer further down the list', () => {
  const rows = ASKED.map((r) => (r.startsWith('❯ 1.') ? '  1. 빨강' : r.startsWith('  2.') ? '❯ 2. 파랑' : r))
  const menu = menuOf(rows)
  assert.equal(menu?.at, 1)
  assert.equal(menu?.options.length, 4)
})

test('a prompt, a finished turn or a running one is no list', () => {
  assert.equal(menuOf(['● Done.', '─────────', '❯ Try "refactor <filepath>"', '─────────', '  Sonnet 5.5', '  ⏵⏵ auto mode on (shift+tab to cycle)']), null)
  assert.equal(menuOf(['❯ 1. first do this', '  2. then that', '✽ Wrangling… (12s · ↓ 1k tokens)', '  esc to interrupt']), null)
  // The line about Enter far up the screen belongs to something that is over.
  assert.equal(menuOf([...RESUME, '● Resumed.', '', '', '', '❯ ']), null)
  // One option is not a choice.
  assert.equal(menuOf(['Sure?', '❯ 1. Yes', 'Enter to confirm · Esc to cancel']), null)
  assert.equal(menuOf([]), null)
})
