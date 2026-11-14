// The judge's pure parts: what it is asked, how its answer is read, the reply drafted from it.
import { assert, test } from 'orca/testing'
import { changedFiles, changesNote, clipDiff, draftReply, isKorean, judgeArgs, judgePrompt, JUDGE_SCHEMA, readJudgeOutput } from './judge.ts'
import type { JudgeVerdict } from './protocol.ts'

const verdict: JudgeVerdict = {
  verdict: 'must-fix',
  summary: 'one criterion is not met',
  criteria: [
    { criterion: '1. keeps the order', pass: true, evidence: 'src/x.ts:4 maps in order' },
    { criterion: '2. drops duplicates', pass: false, evidence: 'src/x.ts:9 pushes every item' }
  ],
  mustFix: [{ title: 'duplicates are kept', evidence: 'src/x.ts:9 pushes every item', file: 'src/x.ts', line: 9 }]
}

/** What `claude -p --output-format json` prints around a structured answer. */
const printed = (structured: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ subtype: 'success', is_error: false, total_cost_usd: 0.04, result: JSON.stringify(structured), structured_output: structured, ...extra })

test('the judge is asked with the goal, the request, the claim and what changed', () => {
  const asked = judgePrompt({
    goal: '1. first\n2. second',
    prompt: 'do it',
    claim: 'all done',
    files: ['src/a.ts'],
    diff: '@@ -1 +1 @@\n-a\n+b',
    diffNote: changesNote(['diff-cut', 'shared-folder'])
  })
  for (const part of ['1. first', 'do it', 'all done', '- src/a.ts', '+b', 'cut short', 'Other chats work in this folder']) assert.ok(asked.includes(part), part)
  assert.ok(asked.includes('claims, not evidence'))
  // The goal decides, also when the last request was about something else.
  assert.ok(asked.includes('The goal decides'))
  assert.ok(asked.includes('leaves an item of the goal undone does not pass'))

  const bare = judgePrompt({ goal: null, prompt: 'do it', claim: null, files: [], diff: null, diffNote: null })
  assert.ok(bare.includes('This folder has no GOAL.md'))
  assert.ok(bare.includes('The agent left no message'))
  assert.ok(bare.includes('Nothing is known about what changed'))
})

test('the judge can only read: the arguments it is started with', () => {
  const args = judgeArgs({ model: 'sonnet', effort: 'medium', budgetUsd: 0.5 })
  const after = (flag: string) => args[args.indexOf(flag) + 1]
  for (const flag of ['-p', '--restricted', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands']) assert.ok(args.includes(flag), flag)
  assert.equal(after('--tools'), 'Read,Grep,Glob')
  assert.equal(after('--permission-prompts'), 'none')
  assert.equal(after('--output-format'), 'json')
  assert.equal(after('--model'), 'sonnet')
  assert.equal(after('--effort'), 'medium')
  assert.equal(after('--max-budget-usd'), '0.5')
  assert.deepEqual(JSON.parse(after('--json-schema')!), JUDGE_SCHEMA)
})

test('a verdict is read from what Claude Code printed', () => {
  const run = readJudgeOutput(printed(verdict))
  assert.deepEqual(run, { verdict, costUsd: 0.04, error: null })
  // Without the structured field, the same answer is in `result` as text.
  const fromText = readJudgeOutput(JSON.stringify({ subtype: 'success', result: JSON.stringify(verdict) }))
  assert.deepEqual(fromText, { verdict, costUsd: null, error: null })
})

test('a run that failed says why and never throws', () => {
  assert.equal(readJudgeOutput('').error, 'the judge printed nothing')
  assert.equal(readJudgeOutput('Error: not logged in').error, 'the judge did not answer in JSON')
  assert.equal(readJudgeOutput('null').error, 'the judge did not answer in JSON')
  // Stopped by the spending cap: no verdict, and what it cost is still known.
  assert.deepEqual(readJudgeOutput(JSON.stringify({ subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 0.5 })), {
    verdict: null,
    costUsd: 0.5,
    error: 'error_max_budget_usd'
  })
  assert.equal(readJudgeOutput(printed({ verdict: 'fine' })).error, 'the judge answered in an unexpected shape')
  assert.equal(readJudgeOutput(printed({ ...verdict, criteria: [{ criterion: 'x' }] })).error, 'the judge answered in an unexpected shape')
})

test('a verdict that contradicts itself is settled by its findings', () => {
  const read = (v: unknown) => readJudgeOutput(printed(v)).verdict!
  // "pass" with something to fix: there is something to fix.
  assert.equal(read({ ...verdict, verdict: 'pass' }).verdict, 'must-fix')
  // "pass" with a failed criterion and no finding: a person decides.
  assert.equal(read({ ...verdict, verdict: 'pass', mustFix: [] }).verdict, 'needs-human')
  // "must-fix" with no finding: the failed criteria are the findings.
  const made = read({ ...verdict, mustFix: [] })
  assert.equal(made.verdict, 'must-fix')
  assert.deepEqual(made.mustFix, [{ title: '2. drops duplicates', evidence: 'src/x.ts:9 pushes every item', file: null, line: null }])
  // A finding without evidence is no finding.
  const passed = verdict.criteria.map((c) => ({ ...c, pass: true }))
  const none = read({ ...verdict, criteria: passed, mustFix: [{ title: 'looks wrong', evidence: ' ' }] })
  assert.deepEqual([none.verdict, none.mustFix.length], ['needs-human', 0])
  // A line that is no line is left out.
  assert.equal(read({ ...verdict, mustFix: [{ title: 't', evidence: 'e', file: 'a.ts', line: 0 }] }).mustFix[0]!.line, null)
})

test('the drafted reply lists what must be fixed and leaves room to disagree', () => {
  const korean = draftReply(verdict, true)!
  assert.ok(korean.includes('1. duplicates are kept (src/x.ts:9)'))
  assert.ok(korean.includes('근거: src/x.ts:9 pushes every item'))
  assert.ok(korean.includes('틀린 지적이면 고치지 말고 이유를 답해 주세요'))
  const english = draftReply(verdict, false)!
  assert.ok(english.includes('Evidence: src/x.ts:9 pushes every item'))
  assert.ok(english.includes('for one that is wrong, change nothing and say why'))
  // Nothing to send when it passed, or when a person has to decide.
  assert.equal(draftReply({ ...verdict, verdict: 'pass', mustFix: [] }, true), null)
  assert.equal(draftReply({ ...verdict, verdict: 'needs-human' }, true), null)
  // A long list is cut, and says so.
  const many = { ...verdict, mustFix: Array.from({ length: 11 }, (_, i) => ({ title: `finding ${i + 1}`, evidence: 'e', file: null, line: null })) }
  const cut = draftReply(many, false)!
  assert.ok(cut.includes('8. finding 8') && !cut.includes('9. finding 9') && cut.includes('(and 3 more)'))
})

test('changed files, a clipped diff and the language of a request', () => {
  assert.deepEqual(changedFiles('src/a.ts\nsrc/b.ts\n', ' M src/a.ts\n?? new file.ts\n?? "quoted name.ts"\r\nD  gone.ts\n'), [
    'src/a.ts',
    'src/b.ts',
    'new file.ts',
    'quoted name.ts'
  ])
  assert.deepEqual(changedFiles('', ''), [])
  assert.deepEqual(clipDiff('one\ntwo\nthree', 9), { text: 'one\ntwo', cut: true })
  assert.deepEqual(clipDiff('one\ntwo'), { text: 'one\ntwo', cut: false })
  assert.equal(isKorean('목표를 지킨다', null), true)
  assert.equal(isKorean('keep the goal', null), false)
  assert.equal(changesNote([]), null)
  assert.ok(changesNote(['no-git', 'last-commit'])!.includes('not a git repository'))
})
