// The goal of a chat's work lives in one place the agent, you and the judge all read: GOAL.md in
// the chat's folder, a checklist the agent writes and ticks off. Pure: reading that checklist.
import type { GoalFile } from './protocol.ts'

export const GOAL_FILE = 'GOAL.md'

const MAX_ITEMS = 40
const MAX_TEXT = 160
const MAX_VERIFY = 300

/** The checklist of a GOAL.md: its title (first line), its items and which of them are ticked. */
export function parseGoalFile(text: string): GoalFile {
  const lines = text.split(/\r?\n/)
  const first = lines.find((line) => line.trim()) ?? ''
  // A first line that is already an item is no title.
  const title = /^\s*(?:[-*+]|\d+[.)])\s*\[[ xX]\]/.test(first) ? null : first.replace(/^#+\s*/, '').trim().slice(0, MAX_TEXT) || null
  const items: GoalFile['items'] = []
  for (const line of lines) {
    const item = /^\s*(?:[-*+]|\d+[.)])\s*\[([ xX])\]\s*(.+)$/.exec(line)
    if (item) items.push({ text: item[2]!.trim().slice(0, MAX_TEXT), done: item[1] !== ' ' })
  }
  // One line `verify: <command>` names the command that checks the whole work (the first such line counts).
  let verify = ''
  for (const line of lines) {
    const found = /^\s*verify:\s*(.+?)\s*$/i.exec(line)
    if (!found) continue
    verify = found[1]!.replace(/^`(.*)`$/, '$1').trim().slice(0, MAX_VERIFY)
    break
  }
  return { title, done: items.filter((i) => i.done).length, total: items.length, items: items.slice(0, MAX_ITEMS), ...(verify ? { verify } : {}) }
}
