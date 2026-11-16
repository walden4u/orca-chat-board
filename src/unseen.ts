// Checked chats that finished and were not seen on this machine. The server keeps one unseen mark
// a card, and its own panel (open on a screen nobody may be sitting at) opens the reply box first
// and clears it, so the panel here would never hear of it. This machine keeps its own: set when a
// checked chat stops working or the server marks it, cleared when its box opens here, when it is
// answered from here or when it works again.

/** What the marks are read from and written to: a card of the server's board. */
export type SeenCard = {
  key: string
  watch?: boolean
  closed?: boolean
  state?: string | null
  mainState?: string | null
  stateAt?: number
  unseenAt?: number | null
}

export type UnseenHere = {
  /** Puts this machine's marks on a board from the server, noting the turns that ended since the last one. */
  adorn(cards: SeenCard[], now: number): void
  /** The chat's box opened here, or it was answered from here. */
  saw(key: string): void
}

export function unseenHere(): UnseenHere {
  const unseen: Record<string, number> = {}
  /** The mark each chat had when it was seen here. */
  const seen: Record<string, number> = {}
  let wasWorking: Record<string, boolean> | null = null
  return {
    adorn(cards, now) {
      const working: Record<string, boolean> = {}
      for (const c of cards) {
        // Orca's monitoring mode (working overall, the main agent's turn over) is a finished turn.
        const busy = c.state === 'working' && (!c.mainState || c.mainState === 'working')
        working[c.key] = busy
        if (busy || c.closed || !c.watch) delete unseen[c.key]
        // The server's own mark, unless it is the one just seen here (it clears it a moment later).
        else if (c.unseenAt && c.unseenAt !== seen[c.key]) unseen[c.key] ??= c.unseenAt
        else if (wasWorking?.[c.key] && c.state) unseen[c.key] = c.stateAt || now
        // The server's mark already seen here does not show here either.
        if (unseen[c.key]) c.unseenAt = unseen[c.key]
        else if (c.unseenAt && c.unseenAt === seen[c.key]) c.unseenAt = null
      }
      for (const key of Object.keys(unseen)) if (!(key in working)) delete unseen[key]
      wasWorking = working
    },
    saw(key) {
      if (unseen[key]) seen[key] = unseen[key]
      delete unseen[key]
    }
  }
}
