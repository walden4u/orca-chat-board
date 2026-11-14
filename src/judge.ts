// The judge: a second Claude, read-only, that checks a chat's work against what was asked and
// drafts the reply you might send next. Pure: what to ask it and how to read its answer.
import type { JudgeCheck, JudgeCriterion, JudgeFinding, JudgeNote, JudgeVerdict } from './protocol.ts'

export type JudgeInput = {
  /** The goal the work is held against: the contents of GOAL.md in the chat's folder, if it has one. */
  goal: string | null
  /** Your last prompt in that chat: what this turn was asked to do. */
  prompt: string | null
  /** The agent's last message: claims to check, not facts. */
  claim: string | null
  /** Files that changed, as far as git can tell. */
  files: string[]
  /** The changes themselves, possibly cut short; null when there is nothing to compare with. */
  diff: string | null
  /** Caveats about the changes, in words for the judge. */
  diffNote: string | null
  /** The card's check command, as the board just ran it in this folder. */
  check?: JudgeCheck | null
}

export type JudgeRun = { verdict: JudgeVerdict | null; costUsd: number | null; error: string | null }

/** What the judge must answer with (`claude --json-schema`). */
export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'must-fix', 'needs-human'] },
    summary: { type: 'string' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: { criterion: { type: 'string' }, pass: { type: 'boolean' }, evidence: { type: 'string' } },
        required: ['criterion', 'pass', 'evidence']
      }
    },
    mustFix: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, evidence: { type: 'string' }, file: { type: 'string' }, line: { type: 'number' } },
        required: ['title', 'evidence']
      }
    }
  },
  required: ['verdict', 'summary', 'criteria', 'mustFix']
} as const

const MAX_FIELD = 6000
const MAX_DIFF = 60_000
const MAX_FINDINGS = 8

export type JudgeOptions = { model: string; effort: string; budgetUsd: number }

/**
 * Arguments for Claude Code without a screen, as a judge: it can read and search the folder it
 * runs in and nothing else. `--restricted` drops the tools that run commands, keeps the file
 * tools inside that folder and ignores your settings files (so your hooks and allow rules do not
 * apply); the session is not saved, so it never shows up in that folder's list of conversations.
 * The prompt goes in on standard input.
 */
export function judgeArgs(options: JudgeOptions): string[] {
  return [
    '-p',
    '--restricted',
    '--strict-mcp-config',
    '--tools',
    'Read,Grep,Glob',
    '--permission-prompts',
    'none',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(JUDGE_SCHEMA),
    '--model',
    options.model,
    '--effort',
    options.effort,
    '--max-budget-usd',
    String(options.budgetUsd)
  ]
}

const clip = (text: string, max = MAX_FIELD) => (text.length > max ? `${text.slice(0, max)}\n[cut: ${text.length - max} more characters]` : text)

/** A diff short enough to hand over: whole lines, and whether the end was left out. */
export function clipDiff(diff: string, max = MAX_DIFF): { text: string; cut: boolean } {
  if (diff.length <= max) return { text: diff, cut: false }
  const head = diff.slice(0, max)
  const end = head.lastIndexOf('\n')
  return { text: end > 0 ? head.slice(0, end) : head, cut: true }
}

/** The changed files: `git diff --name-only`, then the untracked ones of `git status --porcelain`. */
export function changedFiles(nameOnly: string, porcelain: string): string[] {
  const out: string[] = []
  const add = (path: string) => {
    const file = path.trim().replace(/^"(.*)"$/, '$1')
    if (file && !out.includes(file)) out.push(file)
  }
  nameOnly.split(/\r?\n/).forEach(add)
  for (const line of porcelain.split(/\r?\n/)) if (line.startsWith('?? ')) add(line.slice(3))
  return out
}

/** The caveats the judge is told about what it is shown, null when there are none. */
export function changesNote(notes: readonly JudgeNote[]): string | null {
  const said: string[] = []
  if (notes.includes('no-git')) said.push('This folder is not a git repository, so nothing is known about what changed. Find the relevant files from the goal and the request.')
  if (notes.includes('last-commit')) said.push("Nothing is uncommitted. The diff above is the folder's last commit, which may or may not be this turn's work.")
  if (notes.includes('diff-cut')) said.push('The diff is cut short. Read the changed files for the rest.')
  if (notes.includes('shared-folder')) said.push('Other chats work in this folder too: some of the changes may be theirs. Judge what was asked of this chat.')
  return said.length ? said.map((s) => `(${s})`).join('\n') : null
}

/** The end of what a command printed: where a test run says how it went. */
export function tailOf(output: string, max = 6000): string {
  const text = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trimEnd()
  return text.length > max ? `[the first ${text.length - max} characters are left out]\n${text.slice(-max)}` : text
}

function checkPart(check: JudgeCheck): string {
  const how = check.code === null ? 'It did not finish.' : `Exit code ${check.code}.`
  return [
    '## The check command',
    '',
    `The owner's command to tell whether the work holds, run in this folder just now (not by the agent): \`${check.command}\``,
    `${how} The end of what it printed:`,
    '',
    check.tail || '(nothing)',
    '',
    'This output is evidence, and the only thing here that was actually run. A check that failed or did not finish is a must-fix, with the lines that say why. A check that passed does not replace reading the files for what it does not cover.'
  ].join('\n')
}

/** The task as the judge reads it. */
export function judgePrompt(input: JudgeInput): string {
  const part = (title: string, body: string | null, none: string) => `## ${title}\n\n${body?.trim() ? clip(body.trim()) : none}`
  const files = input.files.length ? input.files.slice(0, 200).map((f) => `- ${f}`).join('\n') : null
  const changes = [files ? `Changed files:\n${files}` : null, input.diff?.trim() ? `Diff:\n\n${input.diff.trim()}` : null, input.diffNote]
    .filter(Boolean)
    .join('\n\n')
  return [
    'You are reviewing work that another agent just finished in this folder. You did not see how it was done: judge the result, not the account of it. You can only read (Read, Grep, Glob). Nothing you do changes the folder.',
    part('The goal (GOAL.md in this folder)', input.goal, '(This folder has no GOAL.md. Judge against the request below.)'),
    part('The last request to the agent', input.prompt, '(Not known.)'),
    part('What the agent says it did', input.claim, '(The agent left no message.)'),
    ...(input.check ? [checkPart(input.check)] : []),
    `## What changed\n\n${changes || '(Nothing is known about what changed. Find the relevant files from the goal and the request.)'}`,
    [
      '## How to review',
      '',
      '1. The goal decides. When there is a goal, its items are the criteria: one criterion per item of its list, in its order. A ticked box is the agent saying an item is done, not evidence that it is. The last request is context: what the agent was asked most recently, which may be one step of the goal or something else altogether. Work that answers the last request and leaves an item of the goal undone does not pass. Without a goal, turn the last request into a short list of criteria.',
      "2. Check each criterion in the files yourself. A criterion passes only when you have read the code or text that satisfies it. Follow what the code actually does for the cases the criterion names, edge cases included. Comments, names and the agent's message are claims, not evidence.",
      '3. A must-fix is one of: a criterion that is not met; something that worked and is now broken by the change; a statement by the agent that the files do not bear out. Every must-fix needs evidence: the file, the line, and what happens there. Without evidence it is not a finding.',
      '4. Leave out style, naming, possible improvements and anything nobody asked for. When everything asked for is met, the verdict is "pass" and mustFix is empty. Do not look for something to say.',
      '5. The verdict is "needs-human" only when you cannot tell: the criteria are ambiguous, or the answer depends on something outside this folder.',
      '6. Language: write everything you answer with (the summary, every criterion, the evidence, the findings) in the language the goal is written in, or the request when there is no goal. A goal in Korean gets an answer in Korean, whatever language the code and this briefing are in.'
    ].join('\n')
  ].join('\n\n')
}

const text = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function verdictOf(raw: unknown): JudgeVerdict | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (v.verdict !== 'pass' && v.verdict !== 'must-fix' && v.verdict !== 'needs-human') return null
  if (!Array.isArray(v.criteria) || !Array.isArray(v.mustFix)) return null
  const criteria: JudgeCriterion[] = []
  for (const c of v.criteria.slice(0, 40) as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object' || typeof c.pass !== 'boolean' || !text(c.criterion)) return null
    criteria.push({ criterion: text(c.criterion), pass: c.pass, evidence: text(c.evidence) })
  }
  let mustFix: JudgeFinding[] = []
  for (const f of v.mustFix.slice(0, 40) as Record<string, unknown>[]) {
    if (!f || typeof f !== 'object' || !text(f.title)) return null
    // No evidence, no finding: that is the rule the judge was given.
    if (!text(f.evidence)) continue
    mustFix.push({
      title: text(f.title, 300),
      evidence: text(f.evidence),
      file: text(f.file, 300) || null,
      line: typeof f.line === 'number' && Number.isFinite(f.line) && f.line > 0 ? Math.floor(f.line) : null
    })
  }
  // The three parts must tell one story; where they do not, the findings decide.
  let verdict: JudgeVerdict['verdict'] = v.verdict
  if (verdict === 'must-fix' && !mustFix.length) {
    mustFix = criteria.filter((c) => !c.pass && c.evidence).map((c) => ({ title: c.criterion.slice(0, 300), evidence: c.evidence, file: null, line: null }))
    if (!mustFix.length) verdict = 'needs-human'
  } else if (verdict === 'pass' && (mustFix.length || criteria.some((c) => !c.pass))) {
    verdict = mustFix.length ? 'must-fix' : 'needs-human'
  }
  return { verdict, summary: text(v.summary), criteria, mustFix }
}

/** Reads what `claude -p --output-format json` printed. Never throws: a run that failed says why. */
export function readJudgeOutput(stdout: string): JudgeRun {
  let out: Record<string, unknown>
  try {
    out = JSON.parse(stdout) as Record<string, unknown>
  } catch {
    return { verdict: null, costUsd: null, error: stdout.trim() ? 'the judge did not answer in JSON' : 'the judge printed nothing' }
  }
  if (!out || typeof out !== 'object') return { verdict: null, costUsd: null, error: 'the judge did not answer in JSON' }
  const costUsd = typeof out.total_cost_usd === 'number' ? out.total_cost_usd : null
  if (out.is_error === true || (typeof out.subtype === 'string' && out.subtype !== 'success')) {
    const why = text(out.subtype, 80) || text(out.result, 200) || 'the judge stopped with an error'
    return { verdict: null, costUsd, error: why }
  }
  let raw = out.structured_output
  if (raw === undefined && typeof out.result === 'string') {
    try {
      raw = JSON.parse(out.result)
    } catch {
      raw = undefined
    }
  }
  const verdict = verdictOf(raw)
  return verdict ? { verdict, costUsd, error: null } : { verdict: null, costUsd, error: 'the judge answered in an unexpected shape' }
}

/** Whether a text is written in Korean (decides the language of the drafted reply). */
export function isKorean(...texts: (string | null)[]): boolean {
  return /[가-힣]/.test(texts.filter(Boolean).join(' '))
}

/**
 * The reply a verdict suggests: only what must be fixed, each with its evidence, and leave to
 * disagree. A judge can be wrong, and an agent told to "fix" a sound thing would break it.
 * Null when there is nothing to send (passed, or a person has to decide).
 */
export function draftReply(verdict: JudgeVerdict, korean: boolean): string | null {
  if (verdict.verdict !== 'must-fix' || !verdict.mustFix.length) return null
  const items = verdict.mustFix.slice(0, MAX_FINDINGS).map((f, i) => {
    const where = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''
    return `${i + 1}. ${f.title}${where}\n   ${korean ? '근거' : 'Evidence'}: ${f.evidence.replace(/\s+/g, ' ').slice(0, 600)}`
  })
  const more = verdict.mustFix.length - items.length
  return korean
    ? [
        '검토 결과 아래 항목이 아직 맞지 않습니다.',
        '',
        ...items,
        ...(more > 0 ? [`(그 밖에 ${more}건)`] : []),
        '',
        '항목마다 직접 확인한 뒤, 맞는 지적이면 고치고 틀린 지적이면 고치지 말고 이유를 답해 주세요. 끝나면 항목별로 무엇을 했는지 알려 주세요.'
      ].join('\n')
    : [
        'A review found that these are not right yet.',
        '',
        ...items,
        ...(more > 0 ? [`(and ${more} more)`] : []),
        '',
        'Check each one yourself. Fix the ones that are right; for one that is wrong, change nothing and say why. Then tell me what you did for each.'
      ].join('\n')
}
