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

/**
 * A coding agent's screen while a turn is running: Claude Code's spinner line
 * ("✽ Wrangling… (2m 22s · ↓ 9.4k tokens)"), or the "esc to interrupt" hint that Claude Code,
 * Codex and others show. Typing at the prompt shows neither, which is the point: terminal output
 * alone cannot tell you typing from the agent working.
 */
export function looksBusy(rows: readonly string[]): boolean {
  return rows
    .slice(-30)
    // The spinner line starts with the spinner's glyph, never with a prompt mark: that is your own line.
    .some((row) => /esc to (interrupt|cancel)/i.test(row) || /^\s*[^\w\s❯>›$#]\s+\S+…\s+\(.*\b\d+s\b/u.test(row))
}
