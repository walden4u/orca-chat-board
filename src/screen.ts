// Reads an agent's state off its terminal screen, for the chats Orca has lost track of.

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
