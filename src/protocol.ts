// Panel <-> worker contract, shared by src/worker.ts and panel/index.ts.

export type AgentState = 'working' | 'blocked' | 'waiting' | 'done'

export type Column = {
  id: string
  title: string
  /** Shown as a narrow strip with its title and count, Jira style. */
  collapsed?: boolean
}

/** One thing the judge checked: a criterion, whether the work meets it, and what it saw. */
export type JudgeCriterion = { criterion: string; pass: boolean; evidence: string }

/** Something the judge says must be fixed, with the evidence it found. */
export type JudgeFinding = { title: string; evidence: string; file: string | null; line: number | null }

export type JudgeVerdict = {
  /** `needs-human`: the judge could not tell, and says so instead of guessing. */
  verdict: 'pass' | 'must-fix' | 'needs-human'
  summary: string
  criteria: JudgeCriterion[]
  mustFix: JudgeFinding[]
}

/** What the judge was not shown, or was shown with a caveat. */
export type JudgeNote = 'no-git' | 'diff-cut' | 'shared-folder' | 'last-commit' | 'no-goal'

/**
 * The last review of a chat's work by the judge: a second Claude that can only read the chat's
 * folder. It runs when you ask, and never sends anything to the chat: its findings are offered as a draft in the reply box.
 */
export type JudgeState = {
  state: 'running' | 'done' | 'failed'
  /** When the run started. */
  at: number
  verdict?: JudgeVerdict
  /** The reply the verdict suggests (what must be fixed); null when there is nothing to send. */
  draft?: string | null
  /** You sent a reply after this verdict (the draft or your own words): the draft is used up. */
  used?: boolean
  costUsd?: number | null
  ms?: number
  /** Why the run failed: `interrupted`, `nothing`, or the reason the judge or the program gave. */
  error?: string
  notes?: JudgeNote[]
  /** The card's check command as the board ran it for this review: its exit code and the end of what it printed. */
  check?: JudgeCheck
}

/** `code` null: the command did not finish (it could not be started, or ran past its time). */
export type JudgeCheck = { command: string; code: number | null; ms: number; tail: string }

/**
 * A chat's goal as its folder holds it: the checklist in GOAL.md, which the agent writes and ticks
 * off. Read from the file at each listing, never stored on the card.
 */
export type GoalFile = { title: string | null; done: number; total: number; items: { text: string; done: boolean }[] }

/** How you used the replies the judge drafted for a chat. */
export type DraftTally = { asIs: number; edited: number; dropped: number }

/** What the board remembers about one chat (one Orca terminal tab running an agent). */
export type StoredCard = {
  /** Orca tab id of the chat. */
  key: string
  column: string
  order: number
  /** Optional name the person gives the card; falls back to the terminal title. */
  label: string
  note: string
  /** Last terminal title seen, without the agent's spinner prefix. */
  title: string
  agent: string | null
  worktreeId: string
  worktreeName: string
  ptyId: string
  /** Set for an Orca chat tab (not a terminal): its chat session id. */
  sessionId?: string | null
  closed: boolean
  closedAt: number | null
  /** When the agent finished (or started waiting) while you were not looking; null once seen. */
  unseenAt?: number | null
  /** You checked this chat: when its agent finishes unseen, the panel opens its reply box by itself. */
  watch?: boolean
  /**
   * A command of yours that tells whether the work holds (`mix test`, say). With goal mode on, a
   * review runs it in the chat's folder first and hands its output to the judge, who cannot run anything.
   */
  verify?: string
  judge?: JudgeState
  drafts?: DraftTally
  addedAt: number
}

export type BoardState = {
  version: 1
  columns: Column[]
  cards: Record<string, StoredCard>
  /** The columns are Orca's workspace statuses (the "sync with the Workspace Board" setting). */
  synced?: boolean
}

export type CardView = StoredCard & {
  /** Live terminal handle (`term_…`), null when the chat is closed. */
  handle: string | null
  state: AgentState | null
  stateAt: number | null
  /** The main agent's own turn. `working` overall while this is not = Orca's monitoring mode
   *  (the turn ended but background shells, monitors or subagents keep running). */
  mainState: AgentState | null
  /** How the agent's last turn ended, when Orca says: `interruption`, `failure`, `success`… */
  outcome: string | null
  lastOutputAt: number | null
  monitor: MonitorInfo | null
  /** The chat's tab is the one on screen in the focused workspace. */
  active: boolean
  /** The checklist in the chat's folder (GOAL.md), with goal mode on; null without the file or the mode. */
  goalFile: GoalFile | null
}

export type BoardView = {
  columns: Column[]
  cards: CardView[]
  refreshedAt: number
  /** Why listing terminals failed (raw detail, the panel words it); the board then shows what it last knew. */
  error: string | null
  /** Columns are Orca's workspace statuses: they cannot be added here, and a move sets the workspace's status. */
  synced: boolean
  /** Synced, and the column titles are Orca's own status names: renamed in Orca, not here. */
  orcaNames: boolean
}

/** A loop, schedule or background watcher an agent left running (seen through its tool calls). */
export type MonitorInfo = {
  kind: 'loop' | 'cron' | 'monitor'
  /** Seconds between runs, when the agent said. */
  everySec: number | null
  /** When the agent said it wakes up next. */
  nextAt: number | null
  /** Last time it set the monitor up or ran a turn. */
  lastRunAt: number
  /** No sign of life for about twice the interval. */
  stale: boolean
  /** Cron expression or short description, when the agent gave one. */
  label: string | null
}

export type CardPatch = { key: string; label?: string; note?: string; watch?: boolean; verify?: string }

declare module 'orca' {
  interface PluginRequests {
    /** Lists live chats, merges them into the stored board and answers the view. */
    'board.get': { input: { refresh?: boolean; locale?: string }; output: BoardView }
    /** Moves a card to `index` among the open cards of `column`. */
    'board.move': { input: { key: string; column: string; index: number }; output: BoardView }
    /** Replaces the column list; cards in a removed column go to the first one. */
    'board.columns.set': { input: { columns: Column[] }; output: BoardView }
    'card.update': { input: CardPatch; output: BoardView }
    /** Forgets a card; only closed chats can be deleted. */
    'card.delete': { input: { key: string }; output: BoardView }
    /** Re-checks which chats are on screen: open-chat highlight, and clears their unseen mark. */
    'seen.check': { input: Record<string, never>; output: BoardView }
    /** You read this chat in its reply box: clears its unseen mark. */
    'card.seen': { input: { key: string }; output: BoardView }
    /** Writes one line from the panel to the plugin's log (which box opened, how it was left). */
    trace: { input: { message: string }; output: null }
    /** Forgets every closed chat. */
    'archive.clear': { input: Record<string, never>; output: BoardView }
    /** Your last prompt and the agent's last message, read from Orca when asked (never stored). */
    'chat.preview': {
      /**
       * `screen` (the reply box): also read the chat's terminal, for what waits in the agent's input
       * (`suggestion`) and, when Orca's record is behind the terminal, the screen itself.
       */
      input: { key: string; screen?: boolean }
      output: { prompt: string | null; message: string | null; at: number | null; screen: string | null; suggestion: string | null }
    }
    /** Turns the Workspace Board sync on or off (the same setting as in Orca's Settings). */
    'sync.set': { input: { on: boolean }; output: BoardView }
    /** Shows the chat's terminal tab in Orca. */
    'chat.focus': { input: { key: string }; output: { ok: boolean; error: 'closed' | string | null } }
    /**
     * Sends `text` to the chat as your next prompt (typed into its terminal, then Enter). Only when
     * you press Send in the reply box. `chat-tab`: Orca has no way to send to its chat tabs.
     */
    'chat.send': {
      /** `images`: ids of pictures handed over with `attach.put`; they are attached before the text. */
      input: { key: string; text: string; images?: string[] }
      output: { ok: boolean; error: 'closed' | 'chat-tab' | 'empty' | 'image-lost' | string | null }
    }
    /**
     * Opens an archived Claude chat again: a new Claude tab in its workspace with Claude's list of
     * conversations to resume. `unsupported`: not a Claude terminal chat.
     */
    /**
     * Archives an open chat from its card: closes its terminal tab in Orca, which stops the agent
     * in it. The card stays, in the archive. Orca's chat tabs cannot be closed from outside.
     */
    'chat.archive': { input: { key: string }; output: { ok: boolean; error: 'closed' | 'chat-tab' | string | null } }
    'chat.reopen': { input: { key: string }; output: { ok: boolean; error: 'open' | 'unsupported' | string | null } }
    /**
     * Starts a review of the chat's work by the judge. Answers at once (a review takes longer than
     * a panel waits); the result arrives on the card (`judge`) with a board update.
     * `off`: goal mode is turned off in Settings. `busy`: another review is running.
     * `no-folder`: the chat's folder is not on this machine.
     */
    'judge.run': { input: { key: string }; output: { ok: boolean; error: 'off' | 'closed' | 'busy' | 'no-folder' | string | null } }
    /** How you used the reply the judge drafted: sent as it was, sent after editing, or not used. */
    'judge.tally': { input: { key: string; how: keyof DraftTally }; output: null }
    /** One piece (base64, in order) of a picture attached in the reply box; kept in memory until Send. */
    'attach.put': { input: { id: string; type: string; data: string }; output: { result: 'ok' | 'type' | 'size' | 'count' } }
    /** Forgets a picture that was attached and not sent. */
    'attach.drop': { input: { id: string }; output: null }
  }
  interface PluginPanelEvents {
    'board.changed': BoardView
  }
}
