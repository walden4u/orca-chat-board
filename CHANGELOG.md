# Changelog

## Unreleased

- **A door for a board shown from another machine**: a copy of the board loaded in the Orca of another machine can pass its requests to this one. Asked once (`remote.open`, through the orca CLI of a paired server), the worker answers the same panel requests over HTTP on the machine's Tailscale address, for whoever sends the token it gave, and tells those boards of every change of the board (`GET /events`). Nothing listens until that is asked; the setting "Answer boards on other machines directly" shuts it, and `remote.renew` makes a new token. Pieces of a picture can be numbered (`at` of `attach.put`) and then arrive in any order.
- **Open last chats again when Orca starts** (setting, off by default): quitting Orca closes every tab and so archives every card. With this on, the Claude terminal chats that were open then are opened again when Orca is back, each as its own conversation, in the background, its card where it was. The Claude session of a tab is read from the database Orca's agent hooks report to, read-only; with the setting on, Continue on an archived card opens that conversation without Claude's list too.
- **Goal mode** (setting, off by default): work you hand over and come back to. The goal lives in `GOAL.md` in the chat's folder, a checklist the agent writes and ticks off, and three buttons in the chat's box drive it. **Plan goal** sends what you typed to the agent to plan in plan mode; you approve the plan in the chat, and the agent writes the steps to `GOAL.md`, each with a way to check it, and works through them. **Run goal** sets the checklist as the chat's goal with Claude Code's `/goal`, which keeps the agent at it until every item is ticked. The card shows the progress ("Goal 2/6") and the box lists the items. While the mode is off the board is as it was.
- **Review** (with goal mode): a second Claude, the judge, checks the work in the files instead of taking the agent's word. It runs Claude Code without a screen in the chat's folder, read-only (`claude -p --restricted --tools Read,Grep,Glob`, your settings and hooks left out, the session not saved), with `GOAL.md`, your last prompt, the agent's last message and git's account of what changed since the goal file was added. The result is a scorecard in the box (each item met or not with the evidence, what must be fixed, time and cost) and, when something must be fixed, a drafted reply put in the field. Nothing is sent by itself. The board counts how each chat's drafts were used (sent as they were, edited, not used); a draft is not used when the chat goes on to another turn without it.
- **Check command for reviews** (with goal mode): with Plan goal the agent ends `GOAL.md` with a line `verify: <command>`, usually the test suite. A review runs it in the chat's folder first and hands the judge, who cannot run anything, its exit code and the end of its output; the judge is told the agent chose it. It runs with your account; nothing runs when `GOAL.md` has no such line.
- **How the judge was checked:** `docs/auto-reply-research.md` (in Korean) reports the check behind this design: 42 planted problems found out of 42, 5 of 6 correct cases passed, about 12 seconds and 3 cents a review with Sonnet. The cases, the script and the judge's verdicts are in `docs/auto-reply-research/`.
- **Pink for chats that wait for you** (setting, off by default): a checked chat whose agent finished or asked something gets a pink card, and the toolbar gets a pink edge while there is one. It stays until the agent works again (you answered) or you uncheck the card.
- **The check has a fixed place:** every open card shows the box at its top left, empty or checked, and a click there turns it on or off. Before, an unchecked card had the button only among the hover buttons.
- **Archive from the card:** a new button on an open card (▾, among the hover buttons) closes that chat's tab in Orca, which moves the card to the archive. It asks first with a second click, and says so when the agent is working or when the chat cannot be opened again (anything but a Claude terminal chat). Orca's chat tabs cannot be closed from outside.
- **Sync with the Workspace Board** (off by default): columns become Orca's workspace statuses. Dragging a chat sets its workspace's status, and moving a workspace on Orca's board moves its chats. Turn it on in Settings or with the ⇄ button.
- **Synced column names follow Orca:** rename, add or remove a status on Orca's Workspace Board and the columns follow. Orca has no command for the status names, so the worker reads them from Orca's profile database, read-only. If that fails, the board keeps its names and lets you rename columns as before.
- **Check Orca automatically** (on by default): turn it off to stop the check that runs every 3 seconds while the panel is on screen, and update with ⟳ instead.
- **Synced boards update by themselves:** a change made on Orca's board (a workspace moved, a status renamed) was read but not drawn until something else changed.
- **Reply box:** a click on a card now shows your last message and the agent's whole last reply, and lets you answer. A double-click, or ↗, opens the chat in Orca as a click did before. Send types your text into that chat's terminal (`orca terminal send`). Orca's chat tabs can be read but not answered.
- **Checked chats open by themselves:** check a card and its reply box opens when its agent finishes; answering or pressing Next opens the next one that finished. The check mark stays on the card and unchecks with a click.
- **Reply box on a chat Orca lost track of:** when Orca's record of a chat is behind its terminal, the box shows the terminal's screen as it is now under the old exchange, with the time of the record. What you sent from the box is shown until the record catches up.
- **Status for chats Orca lost track of:** a session that stopped reporting to Orca stayed "done" on its card for hours while it worked. Its status is now read off its terminal (fresh output and a busy screen), so the card, the unseen mark and a checked chat's reply box follow it again.
- **Chats that finish close together:** the end of a turn could be read from a listing before its event arrived; the event then looked like nothing new, so the card got no unseen mark and a checked chat opened no reply box. Either way of learning it now counts.
- **Send no longer waits behind the automatic check:** on a busy machine the checks queued up in the worker and Send timed out after 30 seconds. One check runs at a time, and Send does not go through that queue.
- **Images in a reply:** paste or drop images into the reply box and Send attaches them to the prompt (Claude Code shows them as `[Image #1]`).
- **Lighter automatic check:** it runs every 3 seconds only while an agent works or you use the panel, and every 15 seconds otherwise.
- **"Sent" is not shown as an error:** the line that confirms a sent reply has its own colour.
- **Tab takes the agent's suggestion:** the reply box shows the next prompt the agent suggests, and Tab fills it in.
- **Open an archived chat again:** ↻ on an archived Claude card starts Claude in its workspace with the list of conversations to resume, and the card moves to the new tab.
- **Archive button:** the archive is put away by default, and a toolbar button with the number of archived chats opens and closes it.
- **The chat beside its reply box** (a setting, off by default): Orca switches to the chat's tab when its reply box opens.
- **Archive, README:** the README is reorganised around what you want to do.
- **Korean UI:** the panel is in Korean when Orca is, or when you pick 한국어 under Language.
- **Filter:** text typed through an IME (Korean, Japanese, Chinese) arrived as loose letters, because the filter box was replaced on every keystroke.
- **Bigger hover preview:** as wide as the panel and as tall as the room above or below the card, with the reply shown from its start.
- **Hover preview:** a second popover could stay on screen when the board was redrawn under the pointer.
- **Windows:** the board listed nothing because Orca starts plugin workers without `APPDATA`, which `orca.exe` needs. The worker now passes it. A failing CLI call also shows the CLI's own reason.

## 1.1.1

- **Monitoring pulse for background work:** a chat whose turn ended while background commands, monitors, crons or subagents are still running now shows the monitoring pulse instead of the working spinner. This follows Orca's own rule and works for any agent.

## 1.1.0

- **Orca chat tabs:** agents opened in Orca's chat view now get cards, once they have a conversation. Clicking one opens its workspace, since Orca can't switch to a chat tab from a plugin yet. Renaming uses `orca chat rename`. The yellow "not seen yet" mark follows Orca's own unread flag.
- **Status for every chat:** terminal chats that never sent a status event take their status from Orca's own record.
- **Hover preview:** hover a card to see your last message and the agent's last reply. It is read from Orca when you hover, never stored, and fades in and out. You can turn it off in Settings with "Show a preview on hover".
- **Windows and Linux:** the worker runs the CLI launcher that Orca ships (`orca.exe`, `orca-ide`), with no shell.
- **CI:** type-check and the tests that need no Orca host run on Linux, macOS and Windows.

## 1.0.0

First release: a kanban of agent chats across workspaces, with live status icons, the "not seen yet" mark, the open-chat highlight, loop monitoring, renaming tabs, notes, auto-move to In progress, archive, settings, and English and Spanish UI.
