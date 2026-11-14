// Panel styles, injected at load (the generated page has no stylesheet of ours).
export const CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--orca-background);
  color: var(--orca-foreground);
  font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  display: flex; flex-direction: column; overflow: hidden;
}
button { font: inherit; color: inherit; cursor: pointer; }
input, textarea {
  font: inherit; color: var(--orca-foreground); background: var(--orca-background);
  border: 1px solid var(--orca-input); border-radius: 4px; padding: 3px 6px; width: 100%;
}
input:focus, textarea:focus, button:focus-visible, .card:focus-visible {
  outline: 2px solid var(--orca-ring); outline-offset: -1px;
}

.toolbar {
  display: flex; gap: 6px; align-items: center; padding: 8px;
  border-bottom: 1px solid var(--orca-border); flex: none;
}
.toolbar input { flex: 1; min-width: 60px; }
.ghost {
  background: none; border: 1px solid transparent; border-radius: 4px; padding: 2px 6px;
  color: var(--orca-muted-foreground);
}
.ghost:hover { background: var(--orca-accent); color: var(--orca-accent-foreground); }
.ghost.on { color: var(--orca-foreground); border-color: currentColor; }
.error {
  margin: 6px 8px 0; padding: 6px 8px; border-radius: 4px; flex: none;
  background: color-mix(in srgb, var(--orca-destructive) 15%, transparent);
  color: var(--orca-foreground);
}

.board {
  flex: 1; overflow: auto; padding: 8px; display: flex; gap: 8px;
  align-items: flex-start; min-height: 0;
}
.board > .column { flex: 1 1 200px; min-width: 200px; }
.board > .column.collapsed { flex: 0 0 34px; min-width: 34px; }
.card, .column-head { flex: none; }

/* Collapsed column: a narrow strip with the count and the title running down. */
.column.collapsed {
  cursor: pointer; align-items: center; padding: 6px 0 10px; gap: 8px; min-height: 160px;
  background: color-mix(in srgb, var(--col) 14%, var(--orca-card));
}
.column.collapsed:hover { background: color-mix(in srgb, var(--col) 24%, var(--orca-card)); }
.column.collapsed .strip-title {
  writing-mode: vertical-rl; font-weight: 600; white-space: nowrap;
  color: color-mix(in srgb, var(--col) 70%, var(--orca-foreground));
}

@media (max-width: 420px) {
  .board { flex-direction: column; align-items: stretch; }
  .board > .column, .board > .column.collapsed { flex: none; min-width: 0; }
  .column.collapsed { flex-direction: row; min-height: 0; padding: 6px 8px; }
  .column.collapsed .strip-title { writing-mode: horizontal-tb; flex: 1; }
}

.column {
  --col: #4f8ff7;
  background: color-mix(in srgb, var(--col) 6%, var(--orca-card)); color: var(--orca-card-foreground);
  border: 1px solid color-mix(in srgb, var(--col) 35%, var(--orca-border));
  border-top: 3px solid var(--col); border-radius: var(--orca-radius, 6px);
  display: flex; flex-direction: column; min-height: 60px;
}
.column-head {
  display: flex; align-items: center; gap: 4px; padding: 6px 8px;
  background: color-mix(in srgb, var(--col) 16%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--col) 30%, var(--orca-border));
}
.column-title { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: color-mix(in srgb, var(--col) 70%, var(--orca-foreground)); }
.count { font-variant-numeric: tabular-nums; font-weight: 600; font-size: 11px; padding: 0 6px; border-radius: 9px;
  background: color-mix(in srgb, var(--col) 30%, transparent); color: var(--orca-foreground); }
.column-body { padding: 6px; display: flex; flex-direction: column; gap: 6px; min-height: 40px; }
.column.drop-target { border-color: var(--orca-primary); }
.column.drop-target { border-color: var(--col); box-shadow: 0 0 0 1px var(--col); }
.drop-line { height: 2px; background: var(--col); border-radius: 1px; margin: -4px 0; }
.empty { color: var(--orca-muted-foreground); text-align: center; padding: 8px 0; font-size: 11px; }

.card {
  --st: var(--orca-border);
  background: color-mix(in srgb, var(--st) 7%, var(--orca-background));
  border: 1px solid var(--orca-border); border-left: 3px solid var(--st);
  border-radius: 5px; padding: 6px 8px; cursor: pointer; position: relative;
}
.card:hover { border-color: color-mix(in srgb, var(--col) 60%, var(--orca-border)); border-left-color: var(--st); }
.card.st-working { --st: #4f8ff7; }
.card.st-blocked { --st: #e5484d; }
.card.st-waiting { --st: #f0a020; }
.card.st-done { --st: #2fb170; }
.card.st-interrupted { --st: #e5484d; }
.card.st-monitoring { --st: #4f8ff7; }
.card.st-stale { --st: #8b95a5; }

/* The chat on screen in Orca: a ring in the column's colour. */
.card.active {
  border-color: var(--col);
  border-left-color: var(--st);
  box-shadow: 0 0 0 1px var(--col), 0 0 10px -2px color-mix(in srgb, var(--col) 70%, transparent);
  background: color-mix(in srgb, var(--col) 14%, var(--orca-background));
}

/* Unseen: the agent stopped while you were looking elsewhere (like Orca's yellow tab). */
.card.unseen {
  background: color-mix(in srgb, #f5c518 12%, var(--orca-background));
  border-color: color-mix(in srgb, #f5c518 70%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, #f5c518 55%, transparent);
}
.card.unseen .card-title { font-weight: 650; }
/* Setting "pinkWaiting": a checked chat that waits for your answer, and the toolbar's edge while there is one. */
.card.answer-due {
  background: color-mix(in srgb, #ff5fa2 22%, var(--orca-background));
  border-color: color-mix(in srgb, #ff5fa2 80%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, #ff5fa2 60%, transparent);
}
.toolbar.answer-due { border-bottom: 2px solid #ff5fa2; background: color-mix(in srgb, #ff5fa2 10%, transparent); }
.unseen-dot {
  width: 8px; height: 8px; border-radius: 50%; flex: none; background: #f5c518; margin-top: 5px;
  box-shadow: 0 0 0 3px color-mix(in srgb, #f5c518 25%, transparent);
}
.column-head .unseen-dot, .column.collapsed .unseen-dot { margin-top: 0; }
/* Checked: this chat's reply box opens by itself when it finishes. The mark is the switch. */
.watch {
  flex: none; width: 15px; height: 15px; margin-top: 1px; padding: 0; border-radius: 3px;
  display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; line-height: 1;
  background: var(--orca-primary); color: var(--orca-primary-foreground); border: 1px solid var(--orca-primary);
}
.watch:hover { background: transparent; color: var(--orca-foreground); }
.watch.off { background: transparent; border-color: var(--orca-muted-foreground); }
.watch.off:hover { border-color: var(--orca-foreground); }

.status { width: 16px; height: 16px; flex: none; display: inline-flex; margin-top: 1px; }
.status svg { width: 100%; height: 100%; }
.status.working { color: #4f8ff7; }
.status.working svg { animation: spin 0.9s linear infinite; }
.status.waiting { color: #f0a020; }
.status.waiting svg { animation: tip 2.4s ease-in-out infinite; }
.status.done { color: #2fb170; }
.status.interrupted { color: #e5484d; }
.status.blocked { color: #f76b15; }
.status.closed { color: var(--orca-muted-foreground); }
.status.monitoring { color: #4f8ff7; }
.status.monitoring svg { animation: beat 1.6s ease-in-out infinite; }
.status.stale { color: #8b95a5; }
.time.monitoring { color: #4f8ff7; }
.time.stale { color: #e5a50a; }
@keyframes beat { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes tip { 0%, 70% { transform: rotate(0); } 85%, 100% { transform: rotate(180deg); } }
@media (prefers-reduced-motion: reduce) { .status svg { animation: none !important; } }
.card.dragging { opacity: .4; cursor: grabbing; }
.card.closed { opacity: .65; cursor: default; }
.card-top { display: flex; gap: 6px; align-items: flex-start; }
.card-title { flex: 1; font-weight: 500; word-break: break-word; }
.card-meta { display: flex; gap: 6px; align-items: center; margin-top: 4px; flex-wrap: wrap;
  color: var(--orca-muted-foreground); font-size: 11px; }
.card-meta:empty { display: none; }
/* Time sits at the right edge, under the status icon. */
.card-meta .time { margin-left: auto; font-variant-numeric: tabular-nums; }
.chip { --c: #8b95a5; border: 1px solid color-mix(in srgb, var(--c) 45%, transparent); border-radius: 3px; padding: 0 4px;
  background: color-mix(in srgb, var(--c) 14%, transparent); color: color-mix(in srgb, var(--c) 65%, var(--orca-foreground)); }
.logo { width: 15px; height: 15px; display: inline-flex; flex: none; border-radius: 3px; }
.logo svg { width: 100%; height: 100%; }
.logo { color: var(--orca-foreground); object-fit: contain; }
/* The same line for something done (a message sent): not an error, so not in its colour. */
.error.notice { background: color-mix(in srgb, var(--orca-primary) 14%, transparent); }
.logo.initial { align-items: center; justify-content: center; font-size: 10px; font-weight: 700;
  background: var(--orca-muted); color: var(--orca-muted-foreground); }
.chip.ws { --c: #1fb5b5; }
.note { margin-top: 4px; color: var(--orca-muted-foreground); white-space: pre-wrap; word-break: break-word; }
.card-actions { position: absolute; top: 3px; right: 3px; display: none; gap: 2px;
  background: var(--orca-background); border-radius: 4px; }
.card:hover .card-actions, .card:focus-within .card-actions { display: flex; }
.card-actions button { padding: 0 4px; }

.badge { --b: #8b95a5; border-radius: 9px; padding: 0 7px; font-size: 10px; font-weight: 600; white-space: nowrap;
  background: color-mix(in srgb, var(--b) 28%, transparent); color: color-mix(in srgb, var(--b) 55%, var(--orca-foreground));
  border: 1px solid color-mix(in srgb, var(--b) 50%, transparent); }
.badge.working { --b: #4f8ff7; }
.badge.blocked { --b: #e5484d; }
.badge.waiting { --b: #f0a020; }
.badge.done { --b: #2fb170; }
.badge.closed { background: var(--orca-muted); color: var(--orca-muted-foreground); }

.edit { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.edit-actions { display: flex; gap: 4px; justify-content: flex-end; }
.edit-hint { font-size: 11px; line-height: 1.35; color: var(--orca-muted-foreground); }
.primary { background: var(--orca-primary); color: var(--orca-primary-foreground);
  border: none; border-radius: 4px; padding: 2px 8px; }

.preview {
  position: fixed; z-index: 50; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px;
  background: var(--orca-popover); color: var(--orca-popover-foreground);
  border: 1px solid var(--orca-border); border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35); pointer-events: none; font-size: 12px; overflow: hidden;
  opacity: 0; transform: translateY(-4px) scale(.98); transform-origin: top left;
  transition: opacity .14s ease-out, transform .16s cubic-bezier(.2, .8, .2, 1);
}
.preview.show { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { .preview { transition: opacity .1s linear; transform: none; } }
.preview-who { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  color: var(--orca-muted-foreground); margin-bottom: 2px; }
.preview-agent .preview-who { color: #d97757; }
.preview > * { flex: none; }
.preview.clipped { -webkit-mask-image: linear-gradient(#000 calc(100% - 32px), transparent); mask-image: linear-gradient(#000 calc(100% - 32px), transparent); }
.preview-text { white-space: pre-wrap; word-break: break-word; line-height: 1.45; }
.preview-you .preview-text { color: var(--orca-muted-foreground); max-height: 8.7em; overflow: hidden; }
.preview-empty { color: var(--orca-muted-foreground); font-style: italic; }

.reply-backdrop { position: fixed; inset: 0; z-index: 60; display: flex; padding: 8px;
  background: color-mix(in srgb, var(--orca-background) 70%, transparent); }
.reply { flex: 1; min-width: 0; max-width: 760px; margin: 0 auto; display: flex; flex-direction: column;
  background: var(--orca-popover); color: var(--orca-popover-foreground);
  border: 1px solid var(--orca-border); border-radius: 6px; box-shadow: 0 8px 24px rgba(0, 0, 0, .35); }
.reply-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; flex: none;
  border-bottom: 1px solid var(--orca-border); }
.reply-title { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reply-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px;
  user-select: text; }
.reply-body > * { flex: none; }
.reply .preview-text { max-height: none; overflow: visible; }
.reply-foot { flex: none; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px;
  border-top: 1px solid var(--orca-border); }
.reply-hint { color: var(--orca-muted-foreground); }
.reply-input { resize: vertical; min-height: 4.4em; max-height: 40vh; line-height: 1.45; }
.reply-row { display: flex; align-items: center; gap: 8px; }
.reply-status { flex: 1; min-width: 0; color: var(--orca-destructive); word-break: break-word; }
.reply-screen { border-top: 1px dashed var(--orca-border); padding-top: 8px; }
.reply-screen pre { margin: 6px 0 0; padding: 8px; border-radius: 4px; overflow-x: auto; white-space: pre;
  font: 11px/1.35 ui-monospace, "Cascadia Mono", Consolas, "D2Coding", monospace;
  background: var(--orca-background); border: 1px solid var(--orca-border); }
.reply-shelf { display: flex; flex-wrap: wrap; gap: 6px; }
.reply-shelf[hidden] { display: none; }
.reply-thumb { position: relative; width: 64px; height: 64px; border-radius: 4px; overflow: hidden;
  border: 1px solid var(--orca-border); background: var(--orca-background); }
.reply-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.reply-thumb.busy img { opacity: .4; }
.reply-thumb button { position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; padding: 0; border: none;
  border-radius: 50%; font-size: 9px; line-height: 16px; text-align: center;
  background: var(--orca-popover); color: var(--orca-popover-foreground); }
/* The review of the chat's work, under the exchange: verdict, criteria with evidence, what to fix. */
.reply-exchange { display: flex; flex-direction: column; gap: 10px; }
.reply-judge { display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed var(--orca-border); padding-top: 8px; }
.reply-judge[hidden] { display: none; }
.reply-goal { display: flex; flex-direction: column; gap: 4px; border-top: 1px dashed var(--orca-border); padding-top: 8px; }
.reply-goal[hidden] { display: none; }
.reply-advice { color: var(--orca-foreground); }
.reply-advice[hidden] { display: none; }
.judge-verdict { font-weight: 600; }
.judge-verdict.pass { color: #2fa36b; }
.judge-verdict.must-fix { color: var(--orca-destructive); }
.judge-list { display: flex; flex-direction: column; gap: 2px; }
.judge-item { display: flex; gap: 6px; line-height: 1.4; word-break: break-word; }
.judge-item.pass .judge-mark { color: #2fa36b; }
.judge-item.fail { color: var(--orca-destructive); }
.judge-mark { flex: none; width: 1em; font-weight: 700; }
.judge-evidence { margin: 0 0 4px 1.4em; color: var(--orca-muted-foreground); white-space: pre-wrap; word-break: break-word; line-height: 1.4; }
.reply-waiting { flex: none; color: var(--orca-muted-foreground); white-space: nowrap; }
.reply-next { border-color: var(--orca-border); padding: 3px 10px; }
.reply-row .primary { padding: 3px 14px; }
.reply-row .primary:disabled { opacity: .5; cursor: default; }

details.archive { border-top: 1px solid var(--orca-border); padding: 6px 8px; flex: none; max-height: 40%; overflow: auto; }
.toolbar .ghost { white-space: nowrap; }
details.archive summary { cursor: pointer; color: var(--orca-muted-foreground); display: flex; align-items: center; gap: 6px; }
details.archive summary { list-style: none; }
details.archive summary::-webkit-details-marker { display: none; }
details.archive summary::before { content: '▸'; }
details.archive[open] summary::before { content: '▾'; }
details.archive .archive-title { flex: 1; }
.reopen { margin-left: auto; border-color: var(--orca-border); color: var(--orca-foreground); white-space: nowrap; }
.card.closed .card-meta { flex-wrap: wrap; }
details.archive .list { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.danger { color: var(--orca-destructive); }
`
