// Reads an agent's state off its terminal screen, for the chats Orca has lost track of.

/**
 * What waits in the agent's input: its suggestion for your next prompt (Claude Code shows one dimmed
 * after a reply, and Tab takes it), or text typed there and not sent. Orca reports it as `draft`;
 * a placeholder on the prompt row itself ("❯ Try "how do I log an error?"", after a no-break
 * space) is one too. Null when the input is empty.
 */
export function suggestionOf(rows: readonly string[], draft: string | null): string | null {
  const clean = (text: string) => {
    const one = text.replace(/\s+/g, ' ').trim()
    return (/^Try "(.+)"$/.exec(one)?.[1] ?? one).slice(0, 2000) || null
  }
  if (draft?.trim()) return clean(draft)
  const row = [...rows].reverse().find((r) => /^[❯›>] \S/.test(r))
  return row ? clean(row.slice(2)) : null
}

/** A question the agent's program asks on its screen, with a list to pick from (see `menuOf`). */
export type ScreenMenu = {
  /** What is asked: the rows above the list, as they are on the screen. */
  question: string
  options: string[]
  /** The option the screen's pointer (❯) is on. */
  at: number
  /** The list is numbered 1, 2, 3…: pressing a number picks at once. Otherwise arrows and Enter. */
  numbered: boolean
  /**
   * In a question where several options may be ticked (a number ticks one), the option at this
   * index is the screen's "Next" row, which has no number: it goes on to the next question. Put
   * last, so that every other option keeps its number.
   */
  next?: number
}

// A permission request has no word about Enter under it, only "Esc to cancel · Tab to amend".
// "esc to interrupt" is a running turn's hint, not a list's.
const MENU_FOOT = /\bEnter to (confirm|select|save|continue|submit)\b|\bEsc to (cancel|go back|resume|exit)\b/i
/** A rule that sets a list and its question off from the rest of the screen. */
const RULE = /^[\s─━═▔▁-]{8,}$/
/** A dashed rule inside the question (a permission request frames its command so): a paragraph break. */
const SOFT_RULE = /^[\s╌┄┈]{8,}$/
const MAX_OPTIONS = 9
const MAX_QUESTION_ROWS = 14

/**
 * A list to pick from at the foot of the screen, as Claude Code draws them: "Resume this
 * conversation? ❯ 1. Resume  2. Start a new conversation · Enter to confirm", a permission
 * request, a question of the agent's, the trust question of a new folder ("❯ No, exit / Yes, I
 * trust this folder", without numbers). Null unless all of it is there: the pointer on one of
 * two or more options, and under them the line that says what Enter does. A prompt you typed
 * starts with ❯ too, and has no such line under it.
 */
export function menuOf(rows: readonly string[]): ScreenMenu | null {
  const all = rows.map((r) => r.trimEnd())
  while (all.length && !all[all.length - 1]) all.pop()
  // The line about Enter is the last thing on the screen, or nearly (it may wrap, or have a status row under it).
  let foot = -1
  for (let i = all.length - 1; i >= Math.max(0, all.length - 4); i--) {
    if (MENU_FOOT.test(all[i]!)) {
      foot = i
      break
    }
  }
  let review = false
  if (foot < 0) {
    // The review of the answers to the agent's questions ends with its list ("❯ 1. Submit
    // answers / 2. Cancel") and no word about Enter under it (Claude Code 2.1.327, 2026-11-18).
    if (!all.some((r) => /^\s*Review your answers\s*$/.test(r))) return null
    foot = all.length
    review = true
  }
  let pointed = -1
  for (let i = foot - 1; i >= Math.max(0, foot - 40); i--) {
    if (/^\s*❯\s+\S/.test(all[i]!)) {
      pointed = i
      break
    }
  }
  if (pointed < 0) return null
  const label = (text: string) => text.split(/\s{2,}/)[0]!.trim()
  const numberOf = (row: string) => /^\s*(?:❯\s+)?(\d+)\.\s+(\S.*)$/.exec(row)
  const NEXT_ROW = /^\s*(?:❯\s+)?Next\s*$/
  // The pointer on the "Next" row of a question where several may be ticked: the options are
  // the numbered rows above it, counted from the nearest one.
  const onNext = NEXT_ROW.test(all[pointed]!)
  if (onNext) {
    let i = pointed - 1
    while (i >= Math.max(0, pointed - 30) && !numberOf(all[i]!)) i--
    if (i < Math.max(0, pointed - 30)) return null
    pointed = i
  }
  const options: string[] = []
  let at = 0
  let next: number | undefined
  let first = pointed
  const own = numberOf(all[pointed]!)
  if (own) {
    // Numbered: 1 up to the pointed one above it, the rest below. Rows in between describe an
    // option, or carry on one too long for a row (a permission's "Yes, and always allow access
    // to C:\…"): those follow a row that fills the screen's width, and are joined to it.
    const width = Math.max(...all.map((r) => r.length))
    const labelAt = (i: number, text: string) => {
      let whole = text
      for (let j = i; j + 1 < foot && all[j]!.length >= width - 1 && !numberOf(all[j + 1]!) && all[j + 1]!.trim(); j++) whole += all[j + 1]!.trim()
      return label(whole)
    }
    const n = Number(own[1])
    const found = new Map<number, string>([[n, labelAt(pointed, own[2]!)]])
    let want = n - 1
    for (let i = pointed - 1; want >= 1 && i >= Math.max(0, pointed - 30); i--) {
      const m = numberOf(all[i]!)
      if (!m || Number(m[1]) !== want) continue
      found.set(want--, labelAt(i, m[2]!))
      first = i
    }
    if (want >= 1) return null
    want = n + 1
    for (let i = pointed + 1; i < foot; i++) {
      const m = numberOf(all[i]!)
      if (m && Number(m[1]) === want) found.set(want++, labelAt(i, m[2]!))
    }
    for (let k = 1; found.has(k); k++) options.push(found.get(k)!)
    at = n - 1
    // A question where several may be ticked ("[ ] Apple", "[✔] Banana") has a "Next" row.
    const ticks = options.some((o) => /^\[[ ✔✓x]\]\s/u.test(o))
    if (ticks && all.slice(first, foot).some((r) => NEXT_ROW.test(r))) {
      options.push('Next')
      next = options.length - 1
      if (onNext) at = next
    } else if (onNext) {
      return null
    }
  } else {
    // Not numbered: the rows right above and below whose text starts where the pointed one's does.
    const col = all[pointed]!.indexOf('❯') + 2
    const fits = (row: string | undefined) => !!row && row.length > col && !row.slice(0, col).trim() && row[col] !== ' '
    while (fits(all[first - 1])) first--
    let last = pointed
    while (last + 1 < foot && fits(all[last + 1])) last++
    for (let i = first; i <= last; i++) options.push(label(all[i]!.slice(col)))
    at = pointed - first
  }
  if (options.length < 2 || options.length > MAX_OPTIONS || options.some((o) => !o)) return null
  // The question: what stands above the list, up to the rule that sets the whole thing off.
  const asked: string[] = []
  for (let i = first - 1; i >= 0 && asked.length < MAX_QUESTION_ROWS; i--) {
    const row = all[i]!
    if (RULE.test(row) && row.trim()) break
    // (The review lists each question with ●, as the agent's own lines start: it keeps them.)
    if (/^\s*[❯⎿✻✽✢]/u.test(row) || (!review && /^\s*●/u.test(row))) break
    asked.unshift(SOFT_RULE.test(row) ? '' : row.trim())
  }
  while (asked.length && !asked[0]) asked.shift()
  while (asked.length && !asked[asked.length - 1]) asked.pop()
  return { question: asked.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 1500), options, at, numbered: !!own, ...(next === undefined ? {} : { next }) }
}

/**
 * The keys that pick option `index` of a menu, as writes to the terminal one after the other: its
 * number where the list is numbered (it picks at once), otherwise the arrows there and then Enter
 * on its own. Both seen to work in Claude Code 2.1.327 (2026-11-18).
 */
export function keysFor(menu: ScreenMenu, index: number): string[] {
  // "Next" in a question where several may be ticked: the right arrow goes on to the next question.
  if (index === menu.next) return ['\x1b[C']
  if (menu.numbered) return [String(index + 1)]
  const steps = index - menu.at
  const arrows = (steps > 0 ? '\x1b[B' : '\x1b[A').repeat(Math.abs(steps))
  return arrows ? [arrows, '\r'] : ['\r']
}

/**
 * A coding agent's screen while a turn is running: Claude Code's spinner line
 * ("✽ Wrangling… (2m 22s · ↓ 9.4k tokens)"), or the "esc to interrupt" hint that Claude Code,
 * Codex and others show. Typing at the prompt shows neither, which is the point: terminal output
 * alone cannot tell you typing from the agent working.
 */
export function looksBusy(rows: readonly string[]): boolean {
  // A list waiting for your pick says "Esc to cancel" too (a permission request): that is no work.
  if (menuOf(rows)) return false
  return rows
    .slice(-30)
    // The spinner line starts with the spinner's glyph, never with a prompt mark: that is your own line.
    .some((row) => /esc to (interrupt|cancel)/i.test(row) || /^\s*[^\w\s❯>›$#]\s+\S+…\s+\(.*\b\d+s\b/u.test(row))
}
