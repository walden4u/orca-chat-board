// GOAL.md: the checklist a chat's goal is kept in.
import { assert, test } from 'orca/testing'
import { parseGoalFile } from './goal.ts'

test('a goal file gives its title, its items and how many are ticked', () => {
  const goal = parseGoalFile(
    [
      '# 목표: phoenix로 간단한 투두앱',
      '',
      '- [x] 1. 할 일 목록 화면이 뜬다',
      '  확인: mix phx.server 뒤 / 에서 목록이 보인다',
      '- [ ] 2. 할 일을 추가할 수 있다',
      '  확인: mix test test/todo_test.exs',
      '* [X] 3. 완료 표시를 할 수 있다',
      '1. [ ] 삭제할 수 있다',
      'Some prose with [ ] brackets that is no item.'
    ].join('\r\n')
  )
  assert.equal(goal.title, '목표: phoenix로 간단한 투두앱')
  assert.deepEqual([goal.done, goal.total], [2, 4])
  assert.deepEqual(goal.items, [
    { text: '1. 할 일 목록 화면이 뜬다', done: true },
    { text: '2. 할 일을 추가할 수 있다', done: false },
    { text: '3. 완료 표시를 할 수 있다', done: true },
    { text: '삭제할 수 있다', done: false }
  ])
})

test('a file without a checklist has no items, and a list is no title', () => {
  assert.deepEqual(parseGoalFile(''), { title: null, done: 0, total: 0, items: [] })
  assert.deepEqual(parseGoalFile('Just a note.\n- a plain bullet'), { title: 'Just a note.', done: 0, total: 0, items: [] })
  assert.equal(parseGoalFile('- [ ] first\n- [x] second').title, null)
})

test('a long list is counted whole and shown in part', () => {
  const many = Array.from({ length: 60 }, (_, i) => `- [${i < 50 ? 'x' : ' '}] item ${i + 1} ${'x'.repeat(300)}`).join('\n')
  const goal = parseGoalFile(many)
  assert.deepEqual([goal.done, goal.total, goal.items.length], [50, 60, 40])
  assert.equal(goal.items[0]!.text.length, 160)
})

test('a verify line names the command that checks the whole work', () => {
  assert.equal(parseGoalFile('# Goal\n- [ ] 1. a\n  Check: mix test test/a.exs\n\nverify: `cd todo_app && mix test`\n').verify, 'cd todo_app && mix test')
  assert.equal(parseGoalFile('- [ ] a\nVerify: npm test \nverify: other').verify, 'npm test')
  assert.equal('verify' in parseGoalFile('- [ ] a\n  Check: verify: nothing here is at the start'), false)
})
