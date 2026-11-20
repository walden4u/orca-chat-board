// What an agent's screen says: the lists it asks you to pick from.
import { assert, test } from 'orca/testing'
import { keysFor, keysForKey, looksBusy, menuOf } from './screen.ts'

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

// Two questions at once, the first where several may be ticked (2026-11-18).
const TICKS = [
  '❯ Test only, do nothing else: call the AskUserQuestion tool once with two',
  '  questions.',
  '──────────────────────────────────────────────────────────────────────────────────',
  '←  ☒ Fruits  ☐ Color  ✔ Submit  →',
  'Which fruits?',
  '❯ 1. [✔] Apple',
  '         Apple',
  '  2. [ ] Banana',
  '         Banana',
  '  3. [ ] Cherry',
  '         Cherry',
  '  4. [ ] Type something',
  '     Next',
  '──────────────────────────────────────────────────────────────────────────────────',
  '  5. Chat about this',
  'Enter to select · Tab/Arrow keys to navigate · Esc to cancel'
]

const REVIEW = [
  '  line.',
  '──────────────────────────────────────────────────────────',
  '←  ☒ Fruits  ☒ Color  ✔ Submit  →',
  'Review your answers',
  ' ● Which fruits?',
  '   → Apple',
  ' ● Which color?',
  '   → Green',
  '❯ 1. Submit answers',
  '  2. Cancel'
]

test('a question where several may be ticked: a number ticks one, and its Next row goes on', () => {
  const menu = menuOf(TICKS)
  assert.deepEqual(menu?.options, ['[✔] Apple', '[ ] Banana', '[ ] Cherry', '[ ] Type something', 'Chat about this', 'Next'])
  assert.equal(menu?.next, 5)
  assert.equal(menu?.at, 0)
  assert.deepEqual(keysFor(menu!, 1), ['2'])
  assert.deepEqual(keysFor(menu!, 5), ['\x1b[C'])
  // The pointer on the Next row itself.
  const onNext = TICKS.map((r) => (r === '❯ 1. [✔] Apple' ? '  1. [✔] Apple' : r === '     Next' ? '   ❯ Next' : r))
  const there = menuOf(onNext)
  assert.equal(there?.options.length, 6)
  assert.equal(there?.at, 5)
  assert.equal(menuOf(ASKED)?.next, undefined)
})

test('the review of the answers ends with its list and no word about Enter', () => {
  const menu = menuOf(REVIEW)
  assert.deepEqual(menu?.options, ['Submit answers', 'Cancel'])
  assert.match(menu!.question, /Review your answers\n● Which fruits\?\n→ Apple\n● Which color\?\n→ Green$/)
  assert.deepEqual(keysFor(menu!, 0), ['1'])
  // Without the review's heading, a list with nothing under it is no list.
  assert.equal(menuOf(REVIEW.filter((r) => r !== 'Review your answers')), null)
})

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

// The list of models, as `/model` draws it (Claude Code 2.1.329, 2026-11-20).
const MODELS = [
  '  Select model',
  '  Your pick is the default for new sessions. For other models, use --model.',
  '    1.  Default (recommended)  Opus 5.5 · Best for everyday, complex tasks',
  '    2.  Opus 5.5               For complex work and everyday tasks',
  '  ❯ 3.  Fable 5.2 ✔            For your toughest challenges',
  '    4.  Sonnet 5.5             Most efficient for simpler tasks',
  '    5.  Haiku 5.5              Fastest for quick answers',
  '    ▸   More models',
  '  ● High effort ←/→ to adjust',
  '  s to use this session only · Enter to save · Esc to cancel'
]

test('the keys a list names under its options: a setting to adjust, and the line about Enter and Esc', () => {
  const menu = menuOf(MODELS)!
  assert.deepEqual([menu.options.length, menu.at, menu.numbered], [5, 2, true])
  assert.deepEqual(menu.under, ['● High effort ←/→ to adjust', 's to use this session only · Enter to save · Esc to cancel'])
  assert.deepEqual(menu.keys, [
    { press: 'left', says: '←', row: 0 },
    { press: 'right', says: '→', row: 0 },
    { press: 's', says: 's to use this session only', row: 1 },
    { press: 'enter', says: 'Enter to save', row: 1 },
    { press: 'esc', says: 'Esc to cancel', row: 1 }
  ])
  // Each is one write to the terminal; a letter or Enter after the pointer was moved to another option.
  assert.deepEqual(keysForKey(menu, 'right'), ['\x1b[C'])
  assert.deepEqual(keysForKey(menu, 'left'), ['\x1b[D'])
  assert.deepEqual(keysForKey(menu, 'esc'), ['\x1b'])
  assert.deepEqual(keysForKey(menu, 's'), ['s'])
  assert.deepEqual(keysForKey(menu, 's', 3), ['\x1b[B', 's'])
  assert.deepEqual(keysForKey(menu, 'enter', 0), ['\x1b[A\x1b[A', '\r'])
  assert.deepEqual(keysForKey(menu, 'enter', 2), ['\r'])
  // A key the screen does not name, or an option that is not there: nothing to press.
  assert.equal(keysForKey(menu, 'x'), null)
  assert.equal(keysForKey(menu, 's', 9), null)
  // A permission request names Tab too, which is left to the terminal.
  const asked = menuOf(['Do you want to proceed?', '❯ 1. Yes', '  2. No', '', 'Esc to cancel · Tab to amend'])!
  assert.deepEqual(asked.keys, [{ press: 'esc', says: 'Esc to cancel', row: 0 }])
  assert.equal(keysForKey(asked, 'enter'), null)
})
