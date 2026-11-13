// Reply box: a card's whole last exchange (your prompt, the agent's reply) with a field to answer
// it. Send types your text into that chat's terminal as the next prompt; nothing is sent before.
// The box lives outside the board, so the board's redraws never touch what you are typing.
import { t } from './i18n.ts'
import { loadPreview, plain } from './preview.ts'

export type ReplyTarget = {
  key: string
  title: string
  workspace: string
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
  onEngaged: () => Promise<void>
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

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
let current: { key: string; shut: () => void; setWaiting: (n: number) => void } | null = null

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

  const body = node('div', 'reply-body')
  body.append(node('div', 'preview-text preview-empty', t.replyLoading))

  const foot = node('div', 'reply-foot')
  const hint = target.chatTab ? t.replyChatTab : target.blocked ? t.replyBlocked : target.working ? t.replyWorking : ''
  if (hint) foot.append(node('div', 'reply-hint', hint))
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
  const send = node('button', 'primary', t.send)
  send.disabled = readOnly
  const row = node('div', 'reply-row')
  row.append(status, next, send)
  foot.append(shelf, input, row)

  dialog.append(head, body, foot)
  backdrop.append(dialog)

  const setWaiting = (n: number) => {
    waiting.textContent = n > 0 ? t.replyWaiting(n) : ''
    waiting.hidden = n <= 0
    next.hidden = n <= 0
  }
  setWaiting(target.waiting)

  let open = true
  let busy = false
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.isComposing && !busy) leave(handlers.onClosed)
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

  const shutBox = () => {
    if (!open) return
    open = false
    for (const p of [...pictures]) removePicture(p)
    if (input.value.trim()) drafts.set(target.key, input.value)
    else drafts.delete(target.key)
    document.removeEventListener('keydown', onKey, true)
    backdrop.remove()
    current = null
  }
  /** Closes the box, then says how it was left. */
  const leave = (then: () => void) => {
    if (busy) return
    shutBox()
    then()
  }
  current = { key: target.key, shut: shutBox, setWaiting }

  const submit = async () => {
    const text = input.value.trim()
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
      // The worker has the pictures now: nothing to forget there.
      for (const p of [...pictures]) removePicture(p, false)
      input.value = ''
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
  // What waits in the agent's own input (its suggestion for your next prompt): shown dimmed in the
  // empty field, and Tab takes it, as in the agent's terminal.
  let suggestion: string | null = null
  input.onkeydown = (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && suggestion && !input.value && !readOnly) {
      e.preventDefault()
      input.value = suggestion
      return
    }
    // Enter sends, Shift+Enter adds a line. While an IME composes (Korean, Japanese…), Enter
    // belongs to the IME: it confirms the word and must not send (keyCode 229 in older engines).
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return
    e.preventDefault()
    void submit()
  }
  document.addEventListener('keydown', onKey, true)

  document.body.append(backdrop)
  if (!readOnly && !target.auto) setTimeout(() => input.focus(), 0)
  let engaged = false
  const engage = () => {
    if (engaged) return
    engaged = true
    void handlers.onEngaged().then(() => {
      if (open && !readOnly && !busy && document.activeElement !== input) input.focus()
    })
  }
  if (target.auto) dialog.addEventListener('pointerdown', engage, true)
  else engage()

  void loadPreview(target.key, true).then(
    (data) => {
      if (!open) return
      if (data.suggestion && !readOnly) {
        suggestion = data.suggestion
        input.placeholder = t.replySuggestion(suggestion)
      }
      body.replaceChildren()
      const when = data.at ? ` · ${clock(data.at)}` : ''
      if (data.prompt) body.append(section(t.previewYou, plain(data.prompt), 'you'))
      if (data.message) body.append(section(t.previewAgent + when, plain(data.message), 'agent'))
      if (!data.prompt && !data.message && !data.screen) body.append(node('div', 'preview-text preview-empty', t.previewEmpty))
      // Orca's record is behind this chat's terminal: what is above is old, the screen is now.
      if (data.screen) {
        const now = node('div', 'reply-screen')
        now.append(node('div', 'preview-who', t.replyScreen), node('div', 'reply-hint', t.replyScreenNote), node('pre', '', data.screen))
        body.append(now)
        sent.delete(target.key)
        setTimeout(() => (body.scrollTop = body.scrollHeight), 0)
        return
      }
      // Sent from here after Orca's last record of this chat: show it, and say the record is behind.
      const mine = sent.get(target.key)
      if (mine && (data.at ?? 0) < mine.at) {
        body.append(section(`${t.previewYou} · ${clock(mine.at)}`, mine.text, 'you'), node('div', 'reply-hint', t.replySentNote))
        body.scrollTop = body.scrollHeight
      } else sent.delete(target.key)
    },
    () => {
      if (open) body.replaceChildren(node('div', 'preview-text preview-empty', t.previewEmpty))
    }
  )
}
