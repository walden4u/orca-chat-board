// What an agent's screen says: the lists it asks you to pick from.
import { assert, test } from 'orca/testing'
import { keysFor, looksBusy, menuOf } from './screen.ts'

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

const PERMISSION = [
  '❯ Bash 도구로 mkdir perm-check 를 실행해. 다른 일은 하지 마.',
  '● Perm-check 디렉터리 생성',
  '  ⎿  $ mkdir perm-check',
  '──────────────────────────────────────────────────────────────────────────────────',
  ' Bash command',
  ' perm-check 디렉터리 생성',
  '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  ' mkdir perm-check',
  '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to C:\\Users\\L1\\AppData\\Local\\Temp\\claude\\3d564',
  '      34acc9a7d9a\\6ddb50af\\scratchpad\\menutest from',
  '      this project',
  '   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
  '   4. No',
  ' Esc to cancel · Tab to amend'
]

test('a permission request, with no word about Enter under it and an option on three rows', () => {
  const menu = menuOf(PERMISSION)
  assert.deepEqual(menu?.options, [
    'Yes',
    'Yes, and always allow access to C:\\Users\\L1\\AppData\\Local\\Temp\\claude\\3d56434acc9a7d9a\\6ddb50af\\scratchpad\\menutest from',
    'Yes, and switch to auto mode · auto mode handles these prompts for you',
    'No'
  ])
  assert.equal(menu?.question, 'Bash command\nperm-check 디렉터리 생성\n\nmkdir perm-check\n\nDo you want to proceed?')
  assert.deepEqual(keysFor(menu!, 3), ['4'])
  // Its "Esc to cancel" is not a running turn's "esc to cancel" (seen 2026-11-18: the card went
  // from waiting to working and back every second).
  assert.equal(looksBusy(PERMISSION), false)
  assert.equal(looksBusy(['✽ Wrangling… (12s · ↓ 1k tokens)', '  esc to cancel']), true)
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
