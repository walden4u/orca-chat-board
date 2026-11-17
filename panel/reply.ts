// Reply box: a card's whole last exchange (your prompt, the agent's reply) with a field to answer
// it. Send types your text into that chat's terminal as the next prompt; nothing is sent before.
// The box lives outside the board, so the board's redraws never touch what you are typing.
import type { DraftTally, GoalFile, JudgeState } from '../src/protocol.ts'
import { t } from './i18n.ts'
import { loadPreview, plain } from './preview.ts'

export type ReplyTarget = {
  key: string
  title: string
  workspace: string
  /** The review feature is on (a setting): the box has its Review button. */
  canJudge: boolean
  /** Goal mode, for an agent that has `/goal` (Claude Code in a terminal): the box can split a goal and run it. */
  canGoal: boolean
  /** The checklist in the chat's folder (GOAL.md), if it has one. */
  goalFile: GoalFile | null
  /** The last review of this chat's work, if any, and how its drafts were used so far. */
  judge: JudgeState | null
  tally: DraftTally | null
  /** When the agent's current state began: a review older than that is of an earlier turn. */
  turnAt: number | null
  /** An Orca chat tab: it can be read, but Orca has no way to send to one. */
  chatTab: boolean
  working: boolean
  /** The agent asks for permission: that is answered in the chat itself, not with a message. */
  blocked: boolean
  /**
   * The box opened by itself (a checked chat finished). It then leaves the keyboard where it is:
   * you may be typing in a terminal, and that text must not land here.
   */
  auto: boolean
  /**
   * The box opened from a click on the card, so a second click right away is that card's
   * double-click. Not when it follows another box: there a quick second click is you closing boxes.
   */
  fromCard: boolean
  /**
   * The box opened because the arrow keys came to its card (a setting). It takes the keyboard, and
   * leaves Orca's tab alone until you click in it: on the way past, nothing should move but the box.
   */
  byArrows: boolean
  /** Checked chats that finished and wait behind this one. */
  waiting: number
}

export type ReplyHandlers = {
  onSent: (title: string) => void
  /** Show the chat itself in Orca. */
  onOpenChat: () => void
  /** Read, not answered: on to the next waiting chat. */
  onNext: () => void
  /** Closed by hand (✕, Escape, a click outside). */
  onClosed: () => void
  /**
   * You are at this box: at once for one you opened, at your first click for one that opened by
   * itself. Orca may move the keyboard while it answers; the field takes it back afterwards.
   */
  onEngaged: () => Promise<boolean>
  /** After Orca was asked to show the chat: where the keyboard ended up, for the log. */
  onKeys: (what: string) => void
  /**
   * An arrow key in a field that holds nothing you typed: on to the box of the card that way
   * (columns, rows). Left out, the arrow keys are the field's own, as they always were.
   */
  onArrow?: (dx: number, dy: number) => void
}

const ARROWS: Record<string, [number, number] | undefined> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }

/** A step of the mouse made for you (see `takeBack`): `KeysOp` of the worker's keys.ts. */
export type MouseOp = 'warm' | 'mark' | 'click' | 'click-idle' | 'move' | 'restore' | 'cancel'
let mouse: (op: MouseOp) => Promise<boolean> = async () => false
/** The board gives the reply boxes their way to the mouse. */
export function setReplyMouse(next: (op: MouseOp) => Promise<boolean>): void {
  mouse = next
}

/** Whether the pointer is over this frame: a click made where it is must land here. */
let pointerIn = false
document.addEventListener('pointermove', () => (pointerIn = true), true)
let markedAt = 0
document.addEventListener(
  'pointerdown',
  (e) => {
    pointerIn = true
    // Where you click in this panel is where a click can be made for you later (see `takeBack`).
    if (!SHOWING_TAKES_KEYS || !e.isTrusted || Date.now() - markedAt < 2000) return
    markedAt = Date.now()
    void mouse('mark')
  },
  true
)
document.documentElement.addEventListener('mouseleave', () => (pointerIn = false))

/**
 * Showing a chat here means Orca switches to its terminal tab, which takes the keyboard from this
 * panel. (Not so on the board of another machine, which shows the chat in a browser tab.)
 */
export const SHOWING_TAKES_KEYS = true

/** Whether a click made where the pointer is would land on this panel. */
export function pointerOverPanel(): boolean {
  return pointerIn
}

const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_PICTURES = 5
const MAX_PICTURE_BYTES = 10 * 1024 * 1024
/**
 * Bytes per piece handed to the worker: a multiple of 3, so the base64 pieces join cleanly, and
 * small enough for Orca's cap on one panel message (66,560 bytes; this makes 60,000 of base64).
 */
const PIECE_BYTES = 45_000

/** The second click of a double-click on a card lands on the box that the first one opened. */
const DOUBLE_CLICK_MS = 500

/** What you typed and did not send, per chat, until the panel reloads. */
const drafts = new Map<string, string>()
/**
 * What you last sent to a chat from here, until Orca's record of the chat catches up. Some sessions
 * stop reporting to Orca (started before a restart, say): their record stays at an old exchange,
 * and without this the box would look as if nothing had been sent.
 */
const sent = new Map<string, { text: string; at: number }>()

/** Whether a reply still carries a finding of the drafted one: the draft was edited, not replaced. */
const carries = (text: string, draft: string) => draft.split('\n').some((line) => /^\d+\. /.test(line) && text.includes(line.trim()))

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
/** What changes about a chat while its box is open: a turn starts or ends, a goal item gets ticked. */
export type ReplyLive = { working: boolean; turnAt: number | null; goalFile: GoalFile | null }

let current: {
  key: string
  shut: () => void
  setWaiting: (n: number) => void
  setJudge: (judge: JudgeState | null, tally: DraftTally | null) => void
  setChat: (live: ReplyLive) => void
} | null = null

/** The chat whose box is open, if any. */
export const replyKey = (): string | null => current?.key ?? null

/** Closes the box without telling anyone (the draft is kept). */
export function closeReply(): void {
  current?.shut()
}

/** The number of chats waiting behind the open box changed. */
export function setReplyWaiting(n: number): void {
  current?.setWaiting(n)
}

/**
 * The chat whose box is open moved on (its agent finished or started a turn, or ticked an item of
 * its goal): the box follows, without touching what you are typing.
 */
export function setReplyChat(key: string, live: ReplyLive): void {
  if (current?.key === key) current.setChat(live)
}

/** The review of the chat whose box is open changed (it started, or its result is in). */
export function setReplyJudge(key: string, judge: JudgeState | null, tally: DraftTally | null): void {
  if (current?.key === key) current.setJudge(judge, tally)
}

/**
 * Says what a button is for and when to press it, in a note that shows above the buttons while
 * the pointer is on it. (A `title` takes a second to show and is easy to miss.)
 */
function tip(button: HTMLElement, text: string): void {
  button.classList.add('tip')
  button.dataset.tip = text
  button.setAttribute('aria-description', text)
}

/** The scorecard of a review: what the judge checked, what it says must be fixed, and what it was not shown. */
function scorecard(judge: JudgeState, tally: DraftTally | null, stale: boolean, offered: boolean): HTMLElement[] {
  const line = (cls: string, text: string) => node('div', cls, text)
  if (judge.state === 'running') return [line('preview-who', t.judgeTitle), line('reply-hint', t.judgeRunningSince(clock(judge.at)))]
  if (judge.state === 'failed') {
    const why = judge.error === 'interrupted' ? t.judgeInterrupted : judge.error === 'nothing' ? t.judgeNothing : t.judgeFailed(judge.error ?? '')
    return [line('preview-who', t.judgeTitle), line('reply-hint', why)]
  }
  const v = judge.verdict
  if (!v) return []
  const out: HTMLElement[] = []
  const met = v.criteria.filter((c) => c.pass).length
  const cost = typeof judge.costUsd === 'number' ? judge.costUsd.toFixed(2) : null
  out.push(line('preview-who', `${t.judgeTitle} · ${clock(judge.at)} · ${t.judgeMeta(met, v.criteria.length, Math.round((judge.ms ?? 0) / 1000), cost)}`))
  out.push(line(`judge-verdict ${v.verdict}`, v.verdict === 'pass' ? t.judgePass : v.verdict === 'must-fix' ? t.judgeMustFix(v.mustFix.length) : t.judgeNeedsHuman))
  if (stale) out.push(line('reply-hint', t.judgeStale))
  if (v.summary) out.push(line('preview-text', v.summary))
  for (const note of judge.notes ?? []) out.push(line('reply-hint', t.judgeNotes[note] ?? note))
  if (judge.check) {
    const c = judge.check
    out.push(line(`judge-item ${c.code === 0 ? 'pass' : 'fail'}`, t.verifyRan(c.command, c.code, Math.round(c.ms / 1000))))
    if (c.code !== 0 && c.tail) out.push(node('pre', 'judge-check', c.tail))
  }
  const list = node('div', 'judge-list')
  for (const c of v.criteria) {
    const row = node('div', `judge-item ${c.pass ? 'pass' : 'fail'}`)
    row.append(node('span', 'judge-mark', c.pass ? '✓' : '✗'), node('span', 'judge-what', c.criterion))
    list.append(row)
    if (c.evidence) list.append(line('judge-evidence', c.evidence))
  }
  if (v.criteria.length) out.push(list)
  if (v.mustFix.length) {
    const fixes = node('div', 'judge-list')
    v.mustFix.forEach((f, i) => {
      const where = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''
      fixes.append(line('judge-item fail', `${i + 1}. ${f.title}${where}`), line('judge-evidence', f.evidence))
    })
    out.push(line('preview-who', t.judgeFixes), fixes)
  }
  if (offered) out.push(line('reply-hint', t.judgeDraft))
  if (tally && tally.asIs + tally.edited + tally.dropped > 0) out.push(line('reply-hint', t.judgeTally(tally.asIs, tally.edited, tally.dropped)))
  return out
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (text !== undefined) n.textContent = text
  return n
}

function section(who: string, text: string, cls: string): HTMLElement {
  const s = node('div', `preview-${cls}`)
  s.append(node('div', 'preview-who', who), node('div', 'preview-text', text))
  return s
}

export function openReply(target: ReplyTarget, handlers: ReplyHandlers): void {
  closeReply()
  const openedAt = Date.now()
  const readOnly = target.chatTab || target.blocked

  const backdrop = node('div', 'reply-backdrop')
  const dialog = node('div', 'reply')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-label', t.replyTitle(target.title))

  const head = node('div', 'reply-head')
  const shut = node('button', 'ghost', '✕')
  shut.title = t.close
  shut.setAttribute('aria-label', t.close)
  const toChat = node('button', 'ghost', '↗')
  toChat.title = t.openChat
  toChat.setAttribute('aria-label', t.openChat)
  const waiting = node('span', 'reply-waiting')
  head.append(node('span', 'reply-title', target.title))
  if (target.workspace) head.append(node('span', 'chip ws', target.workspace))
  head.append(waiting, toChat, shut)

  // The exchange, then the review of it: two parts, so that loading one never wipes the other.
  const body = node('div', 'reply-body')
  const exchange = node('div', 'reply-exchange')
  exchange.append(node('div', 'preview-text preview-empty', t.replyLoading))
  const judgeBox = node('div', 'reply-judge')
  judgeBox.hidden = true
  // The goal is shown where the work is read and reviewed: the checklist in the chat's folder, as
  // far as the agent has ticked it. It is what a run works through and what a review checks.
  const goalBox = node('div', 'reply-goal')
  // These three follow the chat while the box is open (setChat): whether its agent is working,
  // when its current state began, and its goal's checklist.
  let working = target.working
  let turnAt = target.turnAt
  let goal = target.goalFile
  const showGoal = () => {
    goalBox.replaceChildren()
    goalBox.hidden = !goal
    if (!goal) return
    goalBox.append(node('div', 'preview-who', `${t.goalFile} · ${t.goalProgress(goal.done, goal.total)}`))
    if (goal.title) goalBox.append(node('div', 'preview-text', goal.title))
    const list = node('div', 'judge-list')
    for (const item of goal.items) {
      const row = node('div', `judge-item${item.done ? ' pass' : ''}`)
      row.append(node('span', 'judge-mark', item.done ? '✓' : '☐'), node('span', 'judge-what', item.text))
      list.append(row)
    }
    if (goal.items.length) goalBox.append(list)
    if (goal.total > goal.items.length) goalBox.append(node('div', 'reply-hint', t.goalMore(goal.total - goal.items.length)))
    // What a review will run first: the command the agent named in the file.
    if (goal.verify && target.canJudge) goalBox.append(node('div', 'reply-hint', t.verifyAuto(goal.verify)))
  }
  showGoal()
  body.append(exchange, goalBox, judgeBox)

  const foot = node('div', 'reply-foot')
  const hint = node('div', 'reply-hint')
  const showHint = () => {
    hint.textContent = target.chatTab ? t.replyChatTab : target.blocked ? t.replyBlocked : working ? t.replyWorking : ''
    hint.hidden = !hint.textContent
  }
  showHint()
  foot.append(hint)
  /** The one next step, in words: what is in the field and what Enter does, or that a review is due. */
  const advice = node('div', 'reply-hint reply-advice')
  advice.hidden = true
  foot.append(advice)
  const input = node('textarea', 'reply-input')
  input.rows = 3
  input.placeholder = t.replyPlaceholder
  input.setAttribute('aria-label', t.replyTitle(target.title))
  input.value = drafts.get(target.key) ?? ''
  input.disabled = readOnly
  const shelf = node('div', 'reply-shelf')
  shelf.hidden = true
  const status = node('span', 'reply-status')
  status.setAttribute('role', 'status')
  const next = node('button', 'ghost reply-next', t.next)
  next.title = t.nextHint
  // Goal mode: split what is in the field into a checklist (GOAL.md), run that checklist to its
  // end (`/goal`), and have the work reviewed. Each is one prompt to the agent, or one review.
  const split = node('button', 'ghost reply-next', t.goalSplit)
  tip(split, t.goalSplitHint)
  split.hidden = !target.canGoal
  const run = node('button', 'ghost reply-next', t.goalRun)
  tip(run, t.goalRunHint)
  run.hidden = !target.canGoal
  const review = node('button', 'ghost reply-next', t.judge)
  tip(review, t.judgeHint)
  review.hidden = !target.canJudge
  const send = node('button', 'primary', t.send)
  send.disabled = readOnly
  const row = node('div', 'reply-row')
  row.append(split, run, review, status, next, send)
  foot.append(shelf, input, row)

  dialog.append(head, body, foot)
  backdrop.append(dialog)

  const setWaiting = (n: number) => {
    waiting.textContent = n > 0 ? t.replyWaiting(n) : ''
    waiting.hidden = n <= 0
    next.hidden = n <= 0
  }
  setWaiting(target.waiting)

  // The review of this chat's work and the reply drafted from it.
  let judge: JudgeState | null = null
  let draft: string | null = null
  /** What waits in the agent's own input (its suggestion for your next prompt). */
  let suggestion: string | null = null
  const offer = () => {
    input.placeholder = draft ? t.judgeDraftHint : suggestion ? t.replySuggestion(suggestion) : t.replyPlaceholder
  }
  // The reply drafted from a review is put in the empty field for you. It is selected, so typing
  // replaces it and Enter sends it. Nothing goes out unless you send it.
  let filled = ''
  /** A review of an earlier turn is still worth reading, but its draft answers that turn, not this one. */
  const isStale = () => !!judge && judge.state === 'done' && turnAt !== null && judge.at < turnAt
  /**
   * What stands out is what comes next. A line above the field only when the field was filled for
   * you (it says what Enter would send); otherwise the goal button whose turn it is: Plan goal
   * while the folder has no checklist, Run goal while items are left and the agent has stopped,
   * Review once every item is ticked and this turn has no review yet.
   */
  const advise = () => {
    advice.textContent = !readOnly && filled && input.value === filled ? t.draftInField : ''
    advice.hidden = !advice.textContent
    const idle = target.canGoal && !working && judge?.state !== 'running'
    const planned = !!goal && goal.total > 0
    const left = goal ? goal.total - goal.done : 0
    split.classList.toggle('due', idle && !planned)
    run.classList.toggle('due', idle && planned && left > 0)
    review.classList.toggle('due', idle && planned && left === 0 && (!judge || isStale()))
  }
  const fill = () => {
    const text = draft
    // Never over what you typed: into an empty field, or over an earlier fill you left as it was.
    if (text && (!input.value || input.value === filled)) {
      input.value = text
      filled = text
      // Room to read what is about to go out, within reason.
      input.rows = Math.min(10, Math.max(3, text.split('\n').length + 1))
      if (document.activeElement === input) input.select()
    } else if (!text && filled && input.value === filled) {
      // What was put there answered a turn that is over: it leaves as it came, unless you touched it.
      input.value = ''
      filled = ''
      input.rows = 3
    }
    advise()
  }
  input.addEventListener('focus', () => {
    if (filled && input.value === filled) input.select()
  })
  input.addEventListener('input', advise)
  /** You asked to see the review of an earlier turn in full. */
  let oldShown = false
  let tallyNow: DraftTally | null = null
  const showJudge = (nextJudge: JudgeState | null, tally: DraftTally | null) => {
    judge = nextJudge
    tallyNow = tally
    const running = judge?.state === 'running'
    const stale = isStale()
    draft = !readOnly && !stale && judge?.state === 'done' && judge.draft && !judge.used ? judge.draft : null
    review.disabled = running
    review.textContent = running ? t.judgeRunning : t.judge
    if (judge && stale && !oldShown) {
      // The chat has moved on since this review: one line that it exists, not the whole scorecard
      // again every time the box opens.
      const kept = judge
      const more = node('button', 'ghost judge-old', t.judgeOld(clock(kept.at)))
      more.onclick = () => {
        oldShown = true
        showJudge(kept, tally)
      }
      judgeBox.replaceChildren(more)
    } else judgeBox.replaceChildren(...(judge ? scorecard(judge, tally, stale, !!draft) : []))
    judgeBox.hidden = !judge
    offer()
    fill()
  }

  let open = true
  let busy = false
  const onKey = (e: KeyboardEvent) => {
    // Also in the middle of a Korean syllable: there the key arrives as `Process`, and only `code`
    // says it was Escape. What you typed is kept for this chat either way.
    if ((e.key === 'Escape' || e.code === 'Escape') && !busy) leave(handlers.onClosed)
  }
  // Pictures: pasted or dropped here, handed to the worker in pieces, attached to the prompt on Send.
  type Picture = { id: string; url: string; ready: boolean; thumb: HTMLElement }
  let pictures: Picture[] = []
  const refreshSend = () => {
    send.disabled = readOnly || busy || pictures.some((p) => !p.ready)
    shelf.hidden = pictures.length === 0
  }
  const removePicture = (p: Picture, forget = true) => {
    pictures = pictures.filter((x) => x !== p)
    URL.revokeObjectURL(p.url)
    p.thumb.remove()
    if (forget) void orca.plugin.request('attach.drop', { id: p.id }).catch(() => undefined)
    refreshSend()
  }
  const addPicture = async (file: File) => {
    if (readOnly || !open) return
    if (!PICTURE_TYPES.includes(file.type)) return
    if (pictures.length >= MAX_PICTURES || file.size > MAX_PICTURE_BYTES) {
      status.textContent = pictures.length >= MAX_PICTURES ? t.attachTooMany(MAX_PICTURES) : t.attachTooBig
      return
    }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    const url = URL.createObjectURL(file)
    const thumb = node('div', 'reply-thumb busy')
    const img = node('img', '')
    img.src = url
    img.alt = file.name || t.attachImage
    const drop = node('button', '', '✕')
    drop.title = t.attachRemove
    drop.setAttribute('aria-label', t.attachRemove)
    thumb.append(img, drop)
    shelf.append(thumb)
    const picture: Picture = { id, url, ready: false, thumb }
    drop.onclick = () => removePicture(picture)
    pictures.push(picture)
    status.textContent = ''
    refreshSend()
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      for (let at = 0; at < bytes.length; at += PIECE_BYTES) {
        if (!pictures.includes(picture)) return
        let binary = ''
        const piece = bytes.subarray(at, at + PIECE_BYTES)
        for (let i = 0; i < piece.length; i += 0x8000) binary += String.fromCharCode(...piece.subarray(i, i + 0x8000))
        const { result } = await orca.plugin.request('attach.put', { id, type: file.type, data: btoa(binary) })
        if (result !== 'ok') throw new Error(result)
      }
      picture.ready = true
      thumb.classList.remove('busy')
    } catch (err) {
      if (pictures.includes(picture)) {
        removePicture(picture)
        status.textContent = t.attachFailed((err as Error).message)
      }
    }
    refreshSend()
  }
  const imagesOf = (data: DataTransfer | null) => [...(data?.files ?? [])].filter((f) => f.type.startsWith('image/'))

  // Orca's window comes back to the front: the next keys belong to the answer, not to whichever
  // button was pressed last.
  const onShown = () => {
    if (document.visibilityState !== 'visible') return
    setTimeout(() => {
      if (open && !readOnly && !busy && document.activeElement !== input) input.focus()
      // Orca gave the keys back to this panel by itself (it had them when you left): the mouse
      // that was waiting for you to come back has nothing left to do, and must not move.
      if (open && taking && hasKeys()) {
        stopped = true
        void mouse('cancel')
      }
    }, 0)
  }
  window.addEventListener('focus', onShown)
  document.addEventListener('visibilitychange', onShown)

  const shutBox = () => {
    if (!open) return
    open = false
    window.removeEventListener('focus', onShown)
    document.removeEventListener('visibilitychange', onShown)
    for (const p of [...pictures]) removePicture(p)
    // What you typed is kept for this chat; what was only put there for you is offered afresh next time.
    if (input.value.trim() && input.value !== filled) drafts.set(target.key, input.value)
    else drafts.delete(target.key)
    document.removeEventListener('keydown', onKey, true)
    if (taking) {
      stopped = true
      void mouse('cancel')
    }
    backdrop.remove()
    current = null
  }
  /** Closes the box, then says how it was left. */
  const leave = (then: () => void) => {
    if (busy) return
    shutBox()
    then()
  }
  current = { key: target.key, shut: shutBox, setWaiting, setJudge: showJudge, setChat: (live) => setChat(live) }

  /**
   * Sends what is in the field, or `prepared`: a prompt one of the goal buttons made. `keepField`:
   * the prompt was not made of the field's text, so what you typed there stays for this chat.
   */
  const submit = async (prepared?: string, keepField = false) => {
    const text = prepared ?? input.value.trim()
    if (busy || readOnly || (!text && !pictures.length) || pictures.some((p) => !p.ready)) return
    busy = true
    send.disabled = true
    input.readOnly = true
    send.textContent = t.sending
    status.textContent = ''
    let result: { ok: boolean; error: string | null }
    try {
      result = await orca.plugin.request('chat.send', { key: target.key, text, images: pictures.map((p) => p.id) })
    } catch (err) {
      result = { ok: false, error: (err as Error).message }
    }
    busy = false
    if (result.ok) {
      const note = pictures.length ? `${text}${text ? '\n' : ''}${t.attachSent(pictures.length)}` : text
      sent.set(target.key, { text: note, at: Date.now() })
      // A drafted reply was on offer: note what became of it (sent as it was, edited, or not used).
      if (draft && judge) {
        const how = text === draft.trim() ? 'asIs' : carries(text, draft) ? 'edited' : 'dropped'
        void orca.plugin.request('judge.tally', { key: target.key, how }).catch(() => undefined)
      }
      // The worker has the pictures now: nothing to forget there.
      for (const p of [...pictures]) removePicture(p, false)
      if (!keepField) input.value = ''
      shutBox()
      handlers.onSent(target.title)
      return
    }
    input.readOnly = false
    send.textContent = t.send
    // The worker may have used some pictures up before it failed: start over with them.
    if (result.error === 'image-lost' || pictures.length) for (const p of [...pictures]) removePicture(p)
    refreshSend()
    status.textContent =
      result.error === 'closed'
        ? t.chatClosed
        : result.error === 'chat-tab'
          ? t.replyChatTab
          : result.error === 'image-lost'
            ? t.attachLost
            : t.replyFailed(result.error ?? '')
    input.focus()
  }
  // A picture from the clipboard (a screenshot, say) or dropped on the box is attached, not typed.
  input.addEventListener('paste', (e) => {
    const files = imagesOf(e.clipboardData)
    if (!files.length) return
    e.preventDefault()
    for (const f of files) void addPicture(f)
  })
  dialog.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
  })
  dialog.addEventListener('drop', (e) => {
    const files = imagesOf(e.dataTransfer)
    if (!files.length) return
    e.preventDefault()
    for (const f of files) void addPicture(f)
  })

  shut.onclick = () => leave(handlers.onClosed)
  toChat.onclick = () => leave(handlers.onOpenChat)
  next.onclick = () => leave(handlers.onNext)
  send.onclick = () => void submit()
  // Split: the goal you typed goes to the agent as a request to write it down as a checklist with
  // a way to check each item, and to build nothing yet. You read the file before anything runs.
  split.onclick = () => {
    const wanted = input.value.trim()
    if (!wanted || wanted === filled) {
      status.textContent = t.goalSplitEmpty
      input.focus()
      return
    }
    void submit(t.goalSplitPrompt(wanted))
  }
  // Run: Claude Code's own `/goal` keeps the agent at the checklist until every item is ticked.
  run.onclick = () => {
    if (!goal || goal.total === 0) {
      status.textContent = t.goalRunNoFile
      return
    }
    void submit(t.goalRunCommand, true)
  }
  // Double-click on a card: its first click opened this box, its second one arrives here.
  // Only for a box that a card click opened (see `fromCard`).
  backdrop.addEventListener(
    'mousedown',
    (e) => {
      if (!target.fromCard || e.detail < 2 || Date.now() - openedAt > DOUBLE_CLICK_MS) return
      e.preventDefault()
      e.stopPropagation()
      leave(handlers.onOpenChat)
    },
    true
  )
  // A click on the dimmed board closes the box; what you typed is kept for this chat.
  backdrop.onmousedown = (e) => {
    if (e.target === backdrop) leave(handlers.onClosed)
  }
  // A review: asked for here, done by the worker. It answers at once; the result comes with a
  // board update (setReplyJudge), also when the box was closed and opened again meanwhile.
  // Asked each time: the review's state can change while a request is on its way.
  const reviewing = () => judge?.state === 'running'
  review.onclick = async () => {
    if (busy || reviewing()) return
    status.textContent = ''
    review.disabled = true
    let result: { ok: boolean; error: string | null }
    try {
      result = await orca.plugin.request('judge.run', { key: target.key })
    } catch (err) {
      result = { ok: false, error: (err as Error).message }
    }
    if (!open) return
    if (result.ok) {
      if (!reviewing()) showJudge({ state: 'running', at: Date.now() }, null)
      return
    }
    review.disabled = false
    status.textContent =
      result.error === 'busy' ? t.judgeBusy : result.error === 'no-folder' ? t.judgeNoFolder : result.error === 'closed' ? t.chatClosed : t.judgeFailed(result.error ?? '')
  }
  // In a field you emptied, Tab brings back the reply drafted from the review, or else takes what
  // waits in the agent's own input (its suggestion for your next prompt), shown dimmed.
  input.onkeydown = (e) => {
    // The arrow keys walk on to the next card's box while the field holds nothing of yours (empty,
    // or the drafted reply as it was put there). A held key is one step, not a run of boxes.
    const step = ARROWS[e.key]
    const bare = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !e.isComposing && e.keyCode !== 229
    if (step && handlers.onArrow && bare && !busy && (!input.value || input.value === filled)) {
      e.preventDefault()
      if (!e.repeat) handlers.onArrow(step[0], step[1])
      return
    }
    const again = draft ?? suggestion
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && again && !input.value && !readOnly) {
      e.preventDefault()
      input.value = again
      advise()
      return
    }
    // Enter sends, Shift+Enter adds a line. While an IME composes (Korean, Japanese…), Enter
    // belongs to the IME: it confirms the word and must not send (keyCode 229 in older engines).
    // A held key is not a decision: one Enter, one message.
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229 || e.repeat) return
    e.preventDefault()
    void submit()
  }
  document.addEventListener('keydown', onKey, true)

  showJudge(target.judge, target.tally)
  document.body.append(backdrop)
  if (!readOnly && !target.auto) setTimeout(() => input.focus(), 0)
  // Orca showed the chat's tab and gave its terminal the keys. This frame cannot have them back
  // by asking (tried for 3 s after a click: never), only by a click in it. So one is made for
  // you where the pointer already is, over this box, and a sheet over the box takes it, so that
  // it presses none of the buttons.
  const hasKeys = () => document.activeElement === input && document.hasFocus()
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
  let taking = false
  let stopped = false
  // `whenStill`: for a box that opened by itself. You may be typing in a terminal just then, and
  // keys taken in the middle of a word would end up in this box, so the mouse waits until it and
  // the keyboard have been still for a moment (and gives up after some seconds). With the
  // pointer somewhere else, it is first put on the spot of your last click in this panel, and
  // put back afterwards; the click is made only once the sheet has felt the pointer arrive.
  const takeBack = async (whenStill = false) => {
    if (!open || readOnly || busy || taking) return
    if (hasKeys()) return handlers.onKeys('kept')
    taking = true
    let brought = false
    let clicked = false
    let what = 'with the terminal, no click came'
    stopped = false
    // The sheet is there only for the moment of the click: while the mouse waits for you (which
    // may be minutes, with the pointer elsewhere) the box stays as it is.
    const click = async (op: MouseOp) => {
      const sheet = node('div', 'reply-sheet')
      sheet.addEventListener('click', () => {
        clicked = true
        sheet.remove()
        if (open) input.focus()
      })
      document.body.append(sheet)
      try {
        await mouse(op)
        await pause(250)
      } finally {
        sheet.remove()
      }
    }
    try {
      if (pointerIn) {
        await click(whenStill ? 'click-idle' : 'click')
      } else {
        // One wait of the worker is short (a request has 30 s); the box goes on asking while it
        // is open and the keys are elsewhere, for as long as you may reasonably be away.
        const until = Date.now() + 30 * 60_000
        while (open && !brought && !hasKeys() && !stopped && Date.now() < until) {
          const asked = Date.now()
          brought = await mouse('move')
          // Refused at once (no spot remembered yet, no helper): not asked again in a hurry.
          if (!brought && Date.now() - asked < 2000) await pause(3000)
        }
        if (!brought) what = hasKeys() ? 'back by your own click' : 'with the terminal, pointer elsewhere and not brought here'
        else {
          await pause(150)
          // The panel felt the pointer arrive, or the spot is no longer on it: then no click.
          if (!pointerIn) what = 'with the terminal, the pointer did not land on the panel'
          else if (open && !hasKeys()) await click('click')
        }
      }
      if (hasKeys()) what = clicked ? 'back by a click' : 'kept'
      else if (clicked) what = 'clicked, still with the terminal'
    } finally {
      taking = false
      if (brought) void mouse('restore')
      if (open) handlers.onKeys(what)
    }
  }
  // You clicked in the box yourself while the mouse was waiting for you: it has nothing left to do.
  dialog.addEventListener(
    'pointerdown',
    (e) => {
      if (!taking || !e.isTrusted) return
      stopped = true
      void mouse('cancel')
    },
    true
  )
  // A box that opened by itself takes the keys too: at once when this panel has them anyway,
  // and otherwise by that click, once you are not typing.
  if (!readOnly && target.auto) {
    setTimeout(() => {
      if (!open) return
      const seen = [document.hasFocus() ? 'T' : 'F']
      if (document.hasFocus()) input.focus()
      else if (SHOWING_TAKES_KEYS) void takeBack(true)
      // The keys may leave in the moments after (seen 2026-11-17: this panel had them when the
      // box opened, and you found them in the terminal): looked at again a few times.
      for (const ms of [300, 1000, 2000, 4000]) {
        setTimeout(() => {
          if (!open) return
          seen.push(hasKeys() ? 'T' : 'F')
          if (!hasKeys() && SHOWING_TAKES_KEYS) void takeBack(true)
          if (ms === 4000) handlers.onKeys(`opened by itself, panel had the keys at 0, 0.3, 1, 2, 4 s: ${seen.join(' ')}`)
        }, ms)
      }
    }, 0)
  }
  let engaged = false
  const engage = () => {
    if (engaged) return
    engaged = true
    void handlers.onEngaged().then((moved) => {
      if (open && !readOnly && !busy && document.activeElement !== input) input.focus()
      if (moved) setTimeout(() => void takeBack(), 150)
    })
  }
  if (target.auto || target.byArrows) dialog.addEventListener('pointerdown', engage, true)
  else engage()

  const loadExchange = () =>
    void loadPreview(target.key, true).then(
    (data) => {
      if (!open) return
      if (data.suggestion && !readOnly) {
        suggestion = data.suggestion
        offer()
      }
      exchange.replaceChildren()
      const when = data.at ? ` · ${clock(data.at)}` : ''
      if (data.prompt) exchange.append(section(t.previewYou, plain(data.prompt), 'you'))
      if (data.message) exchange.append(section(t.previewAgent + when, plain(data.message), 'agent'))
      if (!data.prompt && !data.message && !data.screen) exchange.append(node('div', 'preview-text preview-empty', t.previewEmpty))
      // Orca's record is behind this chat's terminal: what is above is old, the screen is now.
      if (data.screen) {
        const now = node('div', 'reply-screen')
        now.append(node('div', 'preview-who', t.replyScreen), node('div', 'reply-hint', t.replyScreenNote), node('pre', '', data.screen))
        exchange.append(now)
        sent.delete(target.key)
        setTimeout(() => (body.scrollTop = body.scrollHeight), 0)
        return
      }
      // Sent from here after Orca's last record of this chat: show it, and say the record is behind.
      const mine = sent.get(target.key)
      if (mine && (data.at ?? 0) < mine.at) {
        exchange.append(section(`${t.previewYou} · ${clock(mine.at)}`, mine.text, 'you'), node('div', 'reply-hint', t.replySentNote))
        body.scrollTop = body.scrollHeight
      } else sent.delete(target.key)
    },
    () => {
      if (open) exchange.replaceChildren(node('div', 'preview-text preview-empty', t.previewEmpty))
    }
  )
  loadExchange()

  // The chat moved on while its box is open. What the box says follows it: whether the agent is
  // working, the goal's list, which button is due, whether the review is of this turn, and, when
  // a turn started or ended, the exchange itself. The field and what you typed in it stay as they are.
  function setChat(live: ReplyLive): void {
    const turned = live.working !== working || live.turnAt !== turnAt
    const ticked = live.goalFile?.done !== goal?.done || live.goalFile?.total !== goal?.total || live.goalFile?.verify !== goal?.verify
    if (!open || (!turned && !ticked)) return
    working = live.working
    turnAt = live.turnAt
    goal = live.goalFile
    showHint()
    showGoal()
    showJudge(judge, tallyNow)
    // Orca's record of the exchange lands a moment after the news that the turn ended.
    if (turned) setTimeout(() => open && loadExchange(), 700)
  }
}
