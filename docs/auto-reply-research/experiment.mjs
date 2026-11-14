// The check of the judge reported in ../auto-reply-research.md. It plants one problem at a time
// in a copy of the plugin's sources and looks at whether the judge (src/judge.ts) finds it.
//
//   node docs/auto-reply-research/experiment.mjs setup
//       copies the sources the cases were made from (commit 5f5e555) into the work folder
//   node docs/auto-reply-research/experiment.mjs prep [ids…]
//       runs the plugin's own tests against each case: do they notice the planted problem?
//       (needs the orca CLI; about 8 seconds a case)
//   node docs/auto-reply-research/experiment.mjs run <main|extra|name> <round> [ids…] [--model sonnet] [--effort medium]
//       runs the judge on the cases; uses your Claude Code login and your usage
//   node docs/auto-reply-research/experiment.mjs score <main|extra|name> [--md]
//       scores the fresh verdicts in the work folder, or the kept ones in results/<set>.json when there are none
//
// Node 24 (or 22 with --experimental-strip-types: the plugin's sources are TypeScript).
// The work folder is outside the plugin (your temp folder, or JUDGE_CHECK_WORK): inside it, Orca
// would reload the plugin at every file written and run the copied tests as the plugin's own.
// judgeEnv drops what would make a judge started from one of Orca's terminals report to Orca as
// that terminal's agent.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { EXTRA, GOALS, MAIN, POOL, REPEATS } from './pool.mjs'
import { judgeArgs, judgePrompt, readJudgeOutput } from '../../src/judge.ts'
import { claudeProgram, judgeEnv } from '../../src/tools.ts'

const COMMIT = '5f5e555'
const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const work = process.env.JUDGE_CHECK_WORK ?? join(tmpdir(), 'orca-chat-board-judge-check')
const bed = join(work, 'testbed')
const base = join(work, 'base')
const [command, ...rest] = process.argv.slice(2)
const flag = (name, otherwise) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : otherwise)
const words = rest.filter((w, i) => !w.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && rest[i - 1] !== '--md'))

function setup() {
  rmSync(work, { recursive: true, force: true })
  mkdirSync(bed, { recursive: true })
  // File by file out of git: no checkout, no archive tool, and the files are the committed bytes.
  const paths = ['src', 'panel', 'ci', 'assets', 'orca-plugin.json', 'tsconfig.json', 'tsconfig.ci.json']
  const listed = spawnSync('git', ['ls-tree', '-r', '--name-only', COMMIT, ...paths], { cwd: repo, encoding: 'utf8' })
  if (listed.status !== 0) throw new Error(`git ls-tree failed: ${listed.stderr}`)
  for (const file of listed.stdout.split('\n').filter(Boolean)) {
    const shown = spawnSync('git', ['show', `${COMMIT}:${file}`], { cwd: repo, maxBuffer: 64 * 1024 * 1024 })
    if (shown.status !== 0) throw new Error(`git show ${file} failed`)
    mkdirSync(dirname(join(bed, file)), { recursive: true })
    writeFileSync(join(bed, file), shown.stdout)
  }
  // What the judge is shown: the sources without their tests, and no git history.
  mkdirSync(join(base, 'src'), { recursive: true })
  for (const f of readdirSync(join(bed, 'src'))) if (!f.endsWith('.test.ts')) cpSync(join(bed, 'src', f), join(base, 'src', f))
  cpSync(join(bed, 'orca-plugin.json'), join(base, 'orca-plugin.json'))
  console.log(`sources of ${COMMIT} are in ${work}`)
}

/** The file of a case with its problem planted (or as it is, for a correct case left untouched). */
function planted(c, folder) {
  const original = readFileSync(join(folder, c.file), 'utf8')
  if (c.find === undefined) return original
  const parts = original.split(c.find)
  if (parts.length !== 2) throw new Error(`${c.id}: the text to replace was found ${parts.length - 1} times`)
  return parts.join(c.put)
}

function prep(ids) {
  for (const c of POOL.filter((c) => !ids.length || ids.includes(c.id))) {
    const path = join(bed, c.file)
    const original = readFileSync(path, 'utf8')
    writeFileSync(path, planted(c, bed))
    try {
      const r = spawnSync('orca plugin test .', { cwd: bed, shell: true, encoding: 'utf8', timeout: 180000 })
      const failed = [...new Set([...`${r.stdout ?? ''}${r.stderr ?? ''}`.matchAll(/^✖ (.+?) \(\d/gm)].map((m) => m[1]))]
      console.log(c.id, c.kind, r.status === 0 ? 'tests PASS' : `tests FAIL (${failed.length})`, failed.slice(0, 2).join(' | '))
    } finally {
      writeFileSync(path, original)
    }
  }
}

function idsOf(set, given) {
  return given.length ? given : set === 'main' ? MAIN : set === 'extra' ? EXTRA : set === 'repeats' ? REPEATS : []
}

async function run(set, round, given) {
  const model = flag('--model', 'sonnet')
  const effort = flag('--effort', 'medium')
  const claude = claudeProgram({ platform: process.platform, env: process.env }, existsSync)
  if (!claude) throw new Error('Claude Code was not found on this machine')
  const out = join(work, 'out', set)
  mkdirSync(out, { recursive: true })
  const env = judgeEnv({ platform: process.platform, env: process.env })
  const queue = POOL.filter((c) => idsOf(set, given).includes(c.id)).filter((c) => !existsSync(join(out, `${c.id}.r${round}.json`)))
  console.log(`${queue.length} runs of ${set}, ${model} ${effort}, round ${round}`)
  const one = (c) =>
    new Promise((resolve) => {
      const folder = join(work, 'cases', c.id)
      rmSync(folder, { recursive: true, force: true })
      cpSync(base, folder, { recursive: true })
      writeFileSync(join(folder, c.file), planted(c, base))
      const started = Date.now()
      const child = spawn(claude, judgeArgs({ model, effort, budgetUsd: 1 }), { cwd: folder, env, windowsHide: true })
      let stdout = ''
      const timer = setTimeout(() => child.kill(), 420000)
      child.stdout.on('data', (d) => (stdout += d))
      child.on('close', (code) => {
        clearTimeout(timer)
        writeFileSync(join(out, `${c.id}.r${round}.json`), JSON.stringify({ id: c.id, round: Number(round), ms: Date.now() - started, code, stdout }, null, 1))
        console.log(`${c.id} ${c.kind} code ${code} ${Math.round((Date.now() - started) / 1000)}s`)
        resolve()
      })
      // The judge gets what it gets in the plugin: the goal, a request, the agent's claim that all
      // is done, and the name of the changed file. There is no git history here, so no diff.
      child.stdin.end(
        judgePrompt({
          goal: GOALS[c.goal],
          prompt: `위 목표의 기준을 모두 만족하도록 \`${c.file}\`를 구현해 주세요.`,
          claim: `\`${c.file}\`에서 목표의 기준을 모두 구현했고, 기준마다 코드를 다시 읽어 확인했습니다. 빠진 것은 없습니다.`,
          files: [c.file],
          diff: null,
          diffNote: '(This folder has no git history, so there is no diff. Read the changed file as it is now.)'
        })
      )
    })
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) await one(c)
    })
  )
}

/** The verdicts of a set: fresh ones from ./work when there are any, else the kept ones. */
function verdictsOf(set) {
  const fresh = join(work, 'out', set)
  if (existsSync(fresh)) {
    return readdirSync(fresh)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => {
        const r = JSON.parse(readFileSync(join(fresh, f), 'utf8'))
        const read = readJudgeOutput(r.stdout)
        return { id: r.id, round: r.round, sec: Math.round(r.ms / 1000), costUsd: read.costUsd, verdict: read.verdict, error: read.error }
      })
  }
  return JSON.parse(readFileSync(join(here, 'results', `${set}.json`), 'utf8')).map((r) => ({ ...r, error: null }))
}

// The rule, fixed before any run. A planted problem is caught when the verdict is must-fix AND the
// criterion it breaks is marked as not met (when the judge did not keep the goal's numbering: when
// a finding names the function). A correct case is a false alarm unless the verdict is pass.
function score(set) {
  const byId = new Map(POOL.map((c) => [c.id, c]))
  const items = (goal) => GOALS[goal].split('\n').filter((l) => /^\d+\. /.test(l)).length
  const rows = verdictsOf(set).map((r) => {
    const c = byId.get(r.id)
    const v = r.verdict
    const numbered = !!v && v.criteria.length === items(c.goal)
    const failed = v ? v.criteria.map((x, i) => (x.pass ? 0 : i + 1)).filter(Boolean) : []
    const hit = numbered ? failed.includes(c.breaks) : !!v && v.mustFix.some((m) => `${m.title} ${m.evidence}`.includes(c.fn))
    const result = !v
      ? `error: ${r.error}`
      : c.kind === 'ok'
        ? v.verdict === 'pass' ? 'passed' : v.verdict === 'needs-human' ? 'unsure' : 'FALSE ALARM'
        : v.verdict === 'must-fix' && hit ? 'caught' : v.verdict === 'needs-human' ? 'unsure' : v.verdict === 'must-fix' ? 'WRONG REASON' : 'MISSED'
    return { ...r, kind: c.kind, fn: c.fn, result, other: numbered ? failed.filter((n) => n !== c.breaks) : [] }
  })
  const first = rows.filter((r) => r.round === 1)
  const count = (kind, result) => first.filter((r) => r.kind === kind && r.result === result).length
  const total = (kind) => first.filter((r) => r.kind === kind).length
  if (rest.includes('--md')) {
    console.log('| 사례 | 종류 | 함수 | 판정 | 결과 | 함께 미달로 표시한 다른 기준 | 시간(초) | 비용($) |\n|---|---|---|---|---|---|---|---|')
    for (const r of rows) console.log(`| ${r.id}${r.round === 1 ? '' : ' (반복)'} | ${r.kind} | ${r.fn} | ${r.verdict?.verdict ?? '-'} | ${r.result} | ${r.other.join(', ') || '-'} | ${r.sec} | ${r.costUsd?.toFixed(3) ?? '-'} |`)
  } else for (const r of rows) console.log(`${r.id.padEnd(5)} r${r.round} ${r.kind.padEnd(10)} ${r.result.padEnd(14)} other=${r.other.join(',') || '-'} ${r.sec}s $${r.costUsd?.toFixed(3)}`)
  const secs = rows.map((r) => r.sec).sort((a, b) => a - b)
  const cost = rows.reduce((n, r) => n + (r.costUsd ?? 0), 0)
  const again = rows.filter((r) => r.round !== 1).map((r) => r.result === first.find((x) => x.id === r.id)?.result)
  console.log(
    JSON.stringify(
      {
        set,
        runs: rows.length,
        bugs: `${count('bug', 'caught')}/${total('bug')} caught`,
        incomplete: `${count('incomplete', 'caught')}/${total('incomplete')} caught`,
        correct: `${count('ok', 'passed')}/${total('ok')} passed`,
        repeatsAgree: `${again.filter(Boolean).length}/${again.length}`,
        secMedian: secs[Math.floor(secs.length / 2)],
        secMax: secs[secs.length - 1],
        costTotal: Number(cost.toFixed(2)),
        costPerRun: Number((cost / rows.length).toFixed(3))
      },
      null,
      1
    )
  )
}

if (command === 'setup') setup()
else if (command === 'prep') prep(words)
else if (command === 'run') await run(words[0] ?? 'main', words[1] ?? '1', words.slice(2))
else if (command === 'score') score(words[0] ?? 'main')
else console.log('usage: experiment.mjs setup | prep [ids…] | run <set> <round> [ids…] | score <set> [--md]')
