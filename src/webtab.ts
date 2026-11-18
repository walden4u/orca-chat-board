// Shows a chat of the paired server in this machine's Orca. Nothing a plugin or the CLI can call
// moves this window to a server's tab, so the server's own web client (the page it serves on its
// pairing port) is kept in a browser tab of this Orca and steered to the chat's tab there.
import { createBrowserTab, evalInBrowserTab, listBrowserTabs, localWorktreeId, serverEndpoint, showBrowserTab } from './cli.ts'

/** What the page answered: `ok`, or why the chat's tab is not showing. */
export type WebTabResult = 'ok' | 'not-paired' | 'not-ready' | 'no-workspace' | 'workspace-not-opened' | 'no-tab' | 'tab-not-active'

/**
 * The script run in the web client. Workspaces are rows of a virtual list, found by their id
 * (scrolling the list when the row is not drawn); tabs carry the server's tab id.
 */
export function steerScript(worktreeId: string, tabId: string, hook = ''): string {
  const body = [
    hook,
    'const norm = (s) => String(s).replace(/\\\\/g, "/").toLowerCase();',
    'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));',
    `const want = norm(${JSON.stringify(worktreeId)});`,
    `const tabId = ${JSON.stringify(tabId)};`,
    'const side = () => document.querySelector("[data-worktree-sidebar]");',
    // A page just opened is still loading; one that asks for a pairing code will not get further.
    'const asks = () => /pairing/i.test((document.body && document.body.innerText || "").slice(0, 400));',
    // The sidebar's own button: the first labelled one of the title bar, whatever the language.
    'const toggle = () => [...document.querySelectorAll("button[aria-label]:not([aria-hidden=true])")].filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.top < 40 && !b.closest("[data-worktree-sidebar-container],[data-worktree-sidebar],[data-tab-id]"); }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];',
    // With its sidebar hidden (as in a narrow tab) the page has no list of workspaces at all, and
    // with no workspace open nothing else of it either (seen 2026-11-18): its title bar is enough.
    'const loaded = () => side() || document.querySelector("[data-rendered-active-worktree-id],[data-terminal-workbench-container]") || (document.readyState === "complete" && !asks() && toggle());',
    'for (let i = 0; i < 80 && !loaded() && !asks(); i++) await sleep(100);',
    'if (!loaded()) return asks() ? "not-paired" : "not-ready";',
    'let opened = false;',
    // Only the sidebar's rows: a workspace opened before has hidden tab strips with the same id.
    'const findRow = () => [...(side() ? side().querySelectorAll("[data-worktree-id]") : [])].find((r) => norm(r.getAttribute("data-worktree-id")) === want);',
    'const findTab = () => [...document.querySelectorAll("[data-tab-id]")].find((t) => t.getAttribute("data-tab-id").endsWith(tabId) && t.offsetParent);',
    'const active = () => { const a = document.querySelector("[data-rendered-active-worktree-id]"); return norm(a ? a.getAttribute("data-rendered-active-worktree-id") : ""); };',
    'const hide = () => { if (opened && side()) { const b = toggle(); if (b) b.click(); } };',
    'if (active() !== want) {',
    '  if (!side()) { const b = toggle(); if (b) { b.click(); opened = true; } for (let i = 0; i < 30 && !side(); i++) await sleep(100); await sleep(150); }',
    '  if (!side()) return "no-workspace";',
    '  let row = findRow();',
    '  if (!row) {',
    '    let sc = side();',
    '    while (sc && !(sc.scrollHeight > sc.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;',
    '    if (!sc) { hide(); return "no-workspace"; }',
    '    const back = sc.scrollTop;',
    // The list draws its rows a moment after a scroll, and scrolls itself back to the open workspace.
    '    for (let y = 0; y <= sc.scrollHeight && !row; y += Math.max(120, sc.clientHeight / 2)) { for (let i = 0; i < 5 && !row; i++) { sc.scrollTop = y; await sleep(50); row = findRow(); } }',
    '    if (!row) { sc.scrollTop = back; hide(); return "no-workspace"; }',
    '  }',
    '  row.click();',
    '  for (let i = 0; i < 40 && active() !== want; i++) await sleep(100);',
    '  hide();',
    '  if (active() !== want) return "workspace-not-opened";',
    '}',
    'let tab = null;',
    'for (let i = 0; i < 40 && !(tab = findTab()); i++) await sleep(100);',
    'if (!tab) return "no-tab";',
    'if (tab.getAttribute("data-active") !== "true") {',
    // The tabs are drag-sortable: they take a whole pointer gesture, not a bare click().
    '  const r = tab.getBoundingClientRect();',
    '  const o = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, isPrimary: true, pointerType: "mouse", view: window };',
    '  tab.dispatchEvent(new PointerEvent("pointerdown", o)); tab.dispatchEvent(new MouseEvent("mousedown", o));',
    '  await sleep(50);',
    '  const u = Object.assign({}, o, { buttons: 0 });',
    '  tab.dispatchEvent(new PointerEvent("pointerup", u)); tab.dispatchEvent(new MouseEvent("mouseup", u)); tab.dispatchEvent(new MouseEvent("click", u));',
    '  for (let i = 0; i < 10 && (findTab() || tab).getAttribute("data-active") !== "true"; i++) await sleep(100);',
    '}',
    // The keys into the chat's terminal in the page, should this tab of Orca have them (Alt+K from
    // the board): the hidden tabs' terminals are not drawn, so the one drawn is this chat's.
    'const ta = [...document.querySelectorAll(".xterm-helper-textarea")].find((x) => x.closest(".xterm") && x.closest(".xterm").offsetParent);',
    'if (ta) ta.focus({ preventScroll: true });',
    'return (findTab() || tab).getAttribute("data-active") === "true" ? "ok" : "tab-not-active";'
  ].join(' ')
  return `(async () => { ${body} })()`
}

/**
 * Script lines that make the web client page post Alt+K to the server's door (`url`, with `body`
 * as it is): a key pressed in that page never reaches Orca, so Orca's shortcut for `board.keys`
 * does nothing there. Run again with each chat shown, it only refreshes where to post.
 */
export function keyHook(url: string, token: string, from: string): string {
  return [
    // The first version of this hook (its listener cannot be taken out) is silenced.
    // Earlier versions of this hook (their listeners cannot be taken out) are silenced: change the
    // name whenever the listeners change, or a page that has the old ones never gets the new.
    'for (const old of ["__chatBoardKeys", "__chatBoardKeys2", "__chatBoardKeys3", "__chatBoardKeys4", "__chatBoardKeys5", "__chatBoardKeys6"]) if (window[old]) window[old].url = "";',
    'const kb = window.__chatBoardKeys7 || (window.__chatBoardKeys7 = {});',
    'kb.post = (what) => fetch(kb.url, { method: "POST", mode: "no-cors", body: JSON.stringify({ token: kb.token, from: kb.from, what }) }).catch(() => {});',
    'if (!kb.on) { kb.on = true; window.addEventListener("keydown", (e) => {',
    '  if (!kb.url || !e.altKey || e.ctrlKey || e.shiftKey || e.metaKey || e.code !== "Quote") return;',
    '  e.preventDefault(); e.stopImmediatePropagation();',
    // One press can arrive twice (seen on b9, 5 to 15 ms apart): posted once.
    '  if (e.repeat || Date.now() - (kb.keyAt || 0) < 400) return;',
    // Leaving: the terminal's field lets go, and the input method with it (b9, 2026-11-18: the
    // Korean input method stayed with the field left, and nothing could be typed where the keys went).
    '  kb.keyAt = Date.now(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); kb.post("key");',
    '}, true);',
    // A click of yours in a terminal here is where a click can be made for you later (Alt+K on
    // the board): Orca does not hand the keys to this page when it is on screen already.
    '  window.addEventListener("pointerdown", (e) => {',
    '    if (!kb.url || !e.isTrusted || e.button !== 0 || !(e.target instanceof Element)) return;',
    '    const term = e.target.closest(".xterm");',
    '    if (!term) return;',
    // That click is to type in the terminal: its field gets the keys, should the page not have
    // put them there (seen on b9: Alt+K reached the page after such a click, the letters did not
    // reach the terminal).
    // Arriving: out of the field and back in, for the input method to follow (as the board does).
    '    setTimeout(() => { const ta = term.querySelector(".xterm-helper-textarea"); if (!ta) return; const had = document.activeElement === ta; ta.blur(); setTimeout(() => { ta.focus({ preventScroll: true }); if (!had) kb.post(document.activeElement === ta ? "focus-fixed" : "focus-not-fixed"); }, 30); }, 80);',
    '    if (Date.now() - (kb.markedAt || 0) < 2000) return;',
    '    kb.markedAt = Date.now(); kb.post("mark");',
    '  }, true);',
    // Orca put another tab in this one's place: a click made at the spot of the terminal would
    // land on that one, so the board shows the chat again first.
    '  document.addEventListener("visibilitychange", () => { if (kb.url && document.hidden) kb.post("page-hidden"); }); }',
    `kb.url = ${JSON.stringify(url)}; kb.token = ${JSON.stringify(token)}; kb.from = ${JSON.stringify(from)};`
  ].join(' ')
}

let hook = ''
/** What `keyHook` lines each script run in the page starts with ('' for none). */
export function setKeyHook(next: string): void {
  hook = next
}

/** Puts the key hook into the web client page now, if its browser tab is open; never makes one. */
export async function hookWebTab(webUrl: string): Promise<boolean> {
  if (!hook) return false
  if (!page || !home) {
    const worktree = await localWorktreeId()
    const origin = new URL(webUrl).origin
    const open = (await listBrowserTabs(worktree)).find((t) => t.url.startsWith(origin))
    if (!open) return false
    page = open.page
    home = worktree
  }
  return (await evalInBrowserTab(page, `(async () => { ${hook} return "ok"; })()`)) === 'ok'
}

/** `ws://host:port` of a paired server is where it serves its web client over http. */
export function webUrlOf(endpoint: string): string {
  return endpoint.replace(/^ws/i, 'http').replace(/\/+$/, '') + '/'
}

/** The browser tab holding the web client, once found or made. */
let page: string | null = null

/** This machine's workspace that holds it. */
let home: string | null = null

async function webTab(url: string): Promise<string> {
  const worktree = (home = await localWorktreeId())
  const origin = new URL(url).origin
  const open = (await listBrowserTabs(worktree)).find((t) => t.url.startsWith(origin))
  return open ? open.page : createBrowserTab(url, worktree)
}

/**
 * Shows the chat's tab in the web client and brings that browser tab forward. `webUrl` is the
 * server's web client; without it the saved server's address is used.
 */
export async function showChatInWebTab(worktreeId: string, tabId: string, webUrl?: string): Promise<WebTabResult> {
  const script = steerScript(worktreeId, tabId, hook)
  steps = []
  // How long each command took, for the log: a slow one holds up every chat asked for after it.
  const timed = async <T>(name: string, run: Promise<T>): Promise<T> => {
    const began = Date.now()
    try {
      const out = await run
      steps.push(`${name} ${Date.now() - began} ms`)
      return out
    } catch (err) {
      steps.push(`${name} failed after ${Date.now() - began} ms`)
      throw err
    }
  }
  // The tab is shown whatever the page answers: a page that asks for a pairing code has to be seen
  // too. Steering it and bringing it forward are separate commands, run together.
  const steer = async (tab: string, workspace: string): Promise<string> =>
    (await Promise.all([timed('page', evalInBrowserTab(tab, script)), timed('switch', showBrowserTab(tab, workspace))]))[0]
  if (page && home) {
    try {
      return (await steer(page, home)) as WebTabResult
    } catch {
      // The remembered tab was closed: it is looked for again below.
    }
  }
  page = await timed('find', webTab(webUrl ?? webUrlOf(await serverEndpoint())))
  return (await steer(page, home!)) as WebTabResult
}

/** The commands of the last `showChatInWebTab` and how long each took. */
let steps: string[] = []
export function lastSteps(): string {
  return steps.join(', ')
}

/** Forgets the browser tab: the server shown has changed. */
export function forgetWebTab(): void {
  page = null
  home = null
}
