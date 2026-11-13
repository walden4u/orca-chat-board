# Chat Board for Orca

A kanban of your **agent chats**: the Claude, Codex, Cursor, Gemini and other agent tabs you have open, terminal or chat, across every Orca workspace. Orca's Workspace Board groups work by workspace. Chat Board groups it by conversation, which helps when you keep many chats on different topics open in the same workspace.

![Chat Board in dark theme](assets/screenshot-dark.png)

> **This is a fork** of [SantiagoCaprile/orca-chat-board](https://github.com/SantiagoCaprile/orca-chat-board), on the `workspace-sync` branch. It adds to release 1.1.1:
>
> - the board works on Windows (upstream issue #1);
> - it can follow Orca's Workspace Board in both directions;
> - a reply box on every card, to read a chat's last exchange and answer it, images included, without leaving the board;
> - checked chats, whose reply box opens by itself when they finish;
> - a way to open an archived Claude chat again after Orca restarts;
> - a Korean UI.
>
> None of this is in an upstream release. The screenshots are the upstream ones and do not show it.

## Contents

- [Install](#install)
- [Using the board](#using-the-board)
- [Reply to a chat](#reply-to-a-chat)
- [Checked chats](#checked-chats)
- [The archive, and continuing a chat](#the-archive-and-continuing-a-chat)
- [Sync with the Workspace Board](#sync-with-the-workspace-board)
- [Settings](#settings)
- [When something looks wrong](#when-something-looks-wrong)
- [Permissions](#permissions)
- [Limitations](#limitations)
- [How it works](#how-it-works) and [Development](#development)

## Install

### The upstream release

```sh
orca plugin install SantiagoCaprile/orca-chat-board
```

Orca lists the access the plugin asks for (see [Permissions](#permissions)) and asks you to approve it. Then open **Chat Board** from the right sidebar's activity bar. On Windows this release shows an empty board; use the fork.

### This fork

The fork runs from a folder on your machine as an Orca *development plugin*. Orca loads the TypeScript files directly, so there is nothing to build, and it reloads the plugin whenever a file in the folder changes.

1. Get the code and switch to the branch:

   ```sh
   git clone https://github.com/walden4u/orca-chat-board
   cd orca-chat-board
   git checkout workspace-sync
   ```

2. Load the folder into Orca:

   ```sh
   orca plugin dev load .
   ```

   The plugin runs code, so the first load stops with `approval_required`. It lists the access the plugin asks for and prints the same command with `--approve <fingerprint>`. Run that command to approve it.

3. If you also installed the upstream plugin from the catalog, turn it off so you do not get two Chat Board panels:

   ```sh
   orca plugin disable santiagocaprile.chat-board
   ```

4. Check that it runs. The fork shows up as `local.chat-board` with the `dev` tag:

   ```sh
   orca plugin list
   # local.chat-board 1.1.1  running  trusted-worker, dev
   ```

5. Open **Chat Board** from the right sidebar's activity bar, or run `orca plugin open local.chat-board`.

The folder now stays under **Settings → Plugins → Development folders**, and Orca loads it again each time it starts. To remove it, run `orca plugin dev unload local.chat-board`.

Do not edit the files of a plugin installed from the catalog. Orca checks their hash and disables the plugin when they change. Make changes in the development folder.

## Using the board

Every tab that runs an agent is one card: terminal tabs, and Orca's chat tabs once they have a conversation. With the default settings the board has four columns of its own (Backlog, In progress, In review, Done), and new chats land in the first one.

| You want to | Do this |
|---|---|
| Read a chat's last reply and answer it | Click the card. See [Reply to a chat](#reply-to-a-chat). |
| Go to the chat in Orca | Double-click its card, or click ↗ on the card or in the reply box. |
| See what a chat was about | Hover its card for a moment. |
| Have a chat come to you when it finishes | Click the box at the top left of its card. See [Checked chats](#checked-chats). |
| Move a chat | Drag its card to another column, or up and down within a column. |
| Rename a chat or add a note | Click ✎ on the card. Enter saves, Shift+Enter starts a new line in the note. The name is the chat's Orca tab name. |
| Find a chat | Type in the filter box. It matches title, note, workspace and agent. |
| Update the board now | Click ⟳. |
| Continue a chat that was closed | Click **Archive N** in the toolbar. See [The archive](#the-archive-and-continuing-a-chat). |

### What a card shows

- **Status icon:** a spinner while the agent works, an hourglass when it waits for you, a check when it is done, a red cross when it was interrupted, an alert when it needs permission.
- **Yellow card with a dot:** the agent stopped while you were looking at another chat, like Orca's unread tab. Its column header gets a dot too. The mark clears when you read the chat in its reply box, open it, or when the agent starts working again.
- **Coloured ring:** the chat you have open in Orca now.
- **Pulse icon and "next 3m":** a loop or watcher is running there. That covers `/loop` (`ScheduleWakeup`), `CronCreate` schedules and `Monitor` watches. When a loop misses its run by about one interval, the card shows "no signal".
- **Check mark:** you checked this chat. Click the mark to uncheck.
- **Logo, workspace, time and note:** the agent's logo (the same icons Orca uses, for all 45 agents it knows), the workspace's name, the time since the last change, and your note.

Hovering a card shows your last message and the agent's last reply in a popover, as wide as the panel and as tall as the room above or below the card.

### Columns

Add a column with **+ Column**, rename it by double-clicking its title, reorder it with ‹ ›, collapse it into a narrow strip with ⇤, and delete it. A deleted column's cards go to the first column. When you start talking to a chat in **Backlog**, its card moves to **In progress**; a setting turns this off.

With the [Workspace Board sync](#sync-with-the-workspace-board) on, the columns are Orca's workspace statuses instead, and most of this is done in Orca.

The UI follows Orca's theme (light or dark) and language (Spanish for `es-*`, Korean for `ko-*`, English otherwise).

![Chat Board in light theme](assets/screenshot-light.png)

## Reply to a chat

Click a card to open its reply box. It shows your last message and the agent's whole last reply, with the time of Orca's record, and a field to answer.

| You want to | Do this |
|---|---|
| Send an answer | Type it and press Enter. Shift+Enter starts a new line. |
| Use the prompt the agent suggests | Press Tab in the empty field. |
| Attach an image | Paste it into the field, or drop image files on the box. |
| Go to the chat itself | Click ↗ in the box. |
| Close the box | ✕, Escape, or a click outside it. What you typed is kept for that chat until the panel reloads. |

- **Send** types your text into that chat's terminal as your next prompt. The box closes and a line under the toolbar confirms it.
- **Tab takes the agent's suggestion.** When the agent has a next prompt waiting in its own input (Claude Code shows one dimmed after a reply), the reply box shows it dimmed in the empty field, and Tab fills it in for you to send or change. It is read from the chat's terminal when the box opens. Text you typed in that terminal and did not send shows up the same way.
- **Images:** up to 5 per message, 10 MB each, PNG, JPEG, GIF or WebP. They show as thumbnails you can remove, and Send attaches them before your text; an image alone can be sent too. The worker writes each one to `orca-chat-board` in your temp folder and pastes its path into the chat's terminal, where Claude Code turns the path of an image file into an attached image (`[Image #1]`). Other agents may see only the path. Files older than three days are removed the next time an image is sent.
- **The chat beside the box.** With the setting **Show the chat in Orca with its reply box** on, Orca also switches to that chat's tab when its box opens, so the whole conversation is next to the box. A box that opened by itself switches only once you click in it: switching earlier would take away the tab you are typing in.
- **Orca's chat tabs** can be read in the box but not answered, because Orca has no command to send to them. A chat that asks for permission opens read-only too: answer it in the chat (↗).
- **When Orca's record is old.** Some sessions stop reporting to Orca, for example ones that were open when Orca restarted. If Orca's record of a chat is more than two minutes behind that chat's terminal, the box shows the terminal's screen as it is now under the old exchange. After you send from the box, what you sent is shown there until Orca's record catches up.

## Checked chats

Check a card (the box at its top left, always there; click again to uncheck) and its reply box opens by itself when that chat's agent finishes or asks you something, also when its tab is the one on screen in Orca.

- **One after the other.** Answer the box, or leave it unanswered with **Next** or ✕, and the box of the next checked chat that finished opens, in the order they finished. The box says how many are waiting.
- **It does not take the keyboard.** A box that opened by itself leaves the cursor where it is, so what you are typing elsewhere stays there. Click its field to type in it.
- **It waits its turn.** Nothing opens while a box, an edit or a drag is in progress, or while the panel is out of sight; it opens when you are back.
- **Leaving for the chat itself (↗) holds the rest back** for two minutes, or until another checked chat finishes.
- **Loops do not open a box for each run.**

The check is saved with the card. Chats that are not checked only turn yellow.

## The archive, and continuing a chat

A chat you close goes to the archive and keeps its column, note and check. You can close it in Orca, or from its card: **▾** among the card's hover buttons closes that chat's tab in Orca. It asks first with a second click, because the agent in that tab stops, and it warns when the chat cannot be opened again (anything but a Claude terminal chat). Orca's own chat tabs cannot be closed this way. The archive is put away by default: **Archive N** in the toolbar shows how many chats it holds and opens it under the board, up to 40% of the panel's height. The same button, or the archive's title line, puts it away again. Remove one card with ✕, or all of them with **Clear**.

Orca does not keep agent tabs across a restart, so after one most cards are in the archive. To continue such a chat, click **↻ Continue** on its card:

1. Claude starts in that card's workspace the way Orca's own new-agent tab does, so Orca tracks its status, and Orca shows the tab.
2. A few seconds later Claude's list of that folder's conversations appears (the plugin types `/resume`). Pick the one to continue. Nothing is chosen for you.
3. The card leaves the archive and goes back to its column under the new tab, with its note and check.

This works for Claude chats in terminal tabs. Other agents and Orca's chat tabs have no such button yet.

## Sync with the Workspace Board

Click **⇄** in the panel's toolbar, or turn on **Sync with the Workspace Board** in Settings. From then on the two boards show the same thing from two sides: Orca's board by workspace, this one by chat.

- **Columns are workspace statuses.** You get Orca's statuses (Todo, In progress, In review, Done and your custom ones). Turning sync on replaces the columns you had; each chat goes to the column of its workspace's status.
- **Drag a chat here, and Orca follows.** Dropping a card in another column sets that workspace's status in Orca. The other chats of the same workspace move along, because a workspace has only one status.
- **Move a workspace in Orca, and the chats follow here.** Orca does not announce the change, so the panel shows it within about 10 seconds. Click ⟳ to see it at once.
- **Orca's side wins.** At every refresh the cards are put back in the column of their workspace's status.
- **Column names are Orca's status names.** Rename a status in Orca and the column follows at the next refresh. In Orca, open the Workspace Board, then its **Board settings** menu; the **Statuses** list there renames, adds and removes statuses. While the names come from Orca, a column cannot be renamed here.
- **Columns can be reordered (‹ ›) and collapsed (⇤) here, but not added or deleted.** A status you add in Orca gets a column at once, and one you remove loses its column once no workspace uses it.
- **"Move to In progress when you start a chat" is off while synced**, since the status now belongs to the workspace.

Click ⇄ again to stop. The columns stay as they are and become ordinary columns that you can rename, add to and delete.

### How the status names are read

Neither Orca's CLI nor its plugin API tells a plugin what a status is called. So, only while the sync is on, the worker opens Orca's own profile database read-only and takes the status list from it: `profile-state.db` in the active profile's folder under Orca's data folder (`%APPDATA%\orca` on Windows), document `ui`, field `workspaceStatuses`. It reads the id and the label of each status and nothing else, and never writes to that file.

This is not an Orca interface, so an Orca update can change it. When the read fails for any reason, the worker logs `status names not read from Orca's profile` once. The columns then keep the names they had, a new custom status shows up under its id (`status-5`), and you can rename columns here again by double-clicking the title. It has been tried on Windows with Orca 1.4.255 only.

## Settings

Under **Settings → Plugins → Chat Board**:

| Setting | Default |
|---|---|
| Move to In progress when you start a chat | on |
| Sync with the Workspace Board | off |
| Check Orca automatically | on |
| Show the chat in Orca with its reply box | off |
| Show agent logo | on |
| Show workspace | on |
| Show agent status icon | on |
| Show time since last change | on |
| Show notes | on |
| Show a preview on hover | on |
| Language (Auto, English, Español, 한국어) | Auto |

### Check Orca automatically

Orca does not tell plugins when you switch tabs, so while the panel is on screen it asks Orca:

- every 3 seconds while an agent is working, or within 30 seconds of you using the panel (moving the pointer over it, sending a reply);
- every 15 seconds while nothing moves.

Each check starts the `orca` CLI, a second or more of work on Windows, and only one runs at a time. Turn the setting off to stop them and update by hand:

| | On | Off |
|---|---|---|
| Agent status icons | live | live |
| A chat opens or closes | at once | at once |
| Ring around the open chat | within 3 seconds (15 while idle) | when you click a card here, or on ⟳ |
| Yellow "not seen yet" mark clears | within 3 seconds (15 while idle) | when you click the card here, or on ⟳ |
| Changes made on Orca's Workspace Board (with the sync on) | within about 10 seconds (15 while idle) | on ⟳ |
| Status of a chat Orca lost track of (see [Limitations](#limitations)) | a few seconds behind | on ⟳ |

Opening the panel always reads the board afresh, and ⟳ works either way.

## When something looks wrong

| What you see | What to do |
|---|---|
| The board is empty or shows an error | Run `orca plugin logs local.chat-board`. A failed CLI call is logged with the reason the CLI gave. |
| The plugin is listed but not `running` or `idle` | It is waiting for approval. Run `orca plugin dev reload .` and follow the `--approve` command it prints. |
| After restarting Orca, most cards are gone | They are in the archive. Click **Archive N**, then **↻ Continue** on a card. |
| A checked chat finished and no reply box opened | Look in `orca plugin logs local.chat-board` for lines starting with `checked chat` and `panel: reply`. They say what the worker saw and what the panel did with it. |
| The reply box shows an old exchange | Orca's record of that chat is behind. The time next to "Agent" is the record's. If the chat is more than two minutes ahead, the terminal's screen is shown under it; closing the chat and continuing it from the archive makes Orca track it again. |
| "Not sent: … timed out" in the reply box | The message may still arrive. Look at the chat (↗) before sending it again. |
| A column is called `status-5` | The status names could not be read from Orca. Look for `status names not read` in the log; meanwhile, double-click the title to rename the column. |
| Double-clicking a column title does nothing | The sync is on and the name is Orca's. Rename the status in Orca. |
| A card did not move after you changed a status in Orca | Wait 10 seconds or click ⟳. |
| A card has no status icon | Orca has not reported a status for that session yet. See [Limitations](#limitations). |

## Permissions

Orca asks you to approve these when you load the plugin. Here is what each one is used for:

| Permission | What the plugin does with it |
|---|---|
| **Runs its own code** (Node worker) | Runs the Orca CLI commands listed below, because the plugin API alone sees only the focused workspace and cannot open, rename or write to tabs. Also the two file accesses listed below. |
| `storage:own` | Saves the board: columns, card positions, notes, checks, agent status and monitors. All of it stays in the plugin's own folder. |
| `agent:read` | Agent status icons, the yellow "not seen yet" mark, and moving a Backlog card when you start a chat. |
| `workspace:read` | Knows which tab you are looking at, for the "not seen yet" mark and the open-chat highlight, and refreshes the board when chats open or close. |
| `settings:own` | The plugin's options in Orca's Settings. |
| Hook `agent.tool.after` (observe only) | Detects loops and watchers. Orca hands this hook every tool call an agent makes. The plugin looks only at `ScheduleWakeup`, `CronCreate`/`CronDelete`, `Monitor` and `TaskStop`, keeping their timing and description, and drops every other call without storing it. The hook never blocks or changes a call. |

### The CLI commands the worker runs

| Command | When | For |
|---|---|---|
| `orca terminal list`, `orca worktree ps` | at every refresh | The chats in every workspace, their status, chat tabs included. |
| `orca terminal switch`, `orca worktree activate` | you open a chat | Showing its tab, or its workspace for a chat tab. |
| `orca terminal rename`, `orca chat rename` | you rename a card | The chat's tab name. |
| `orca terminal send` | you press Send in a reply box | Your text and the paths of the images you attached, to that one chat. |
| `orca terminal read --screen` | a reply box opens | The agent's suggested next prompt, and the screen itself when Orca's record of the chat is behind its terminal. |
| `orca terminal read --screen` | a terminal has fresh output long after Orca's record of a finished turn | Telling whether that chat is working. Only a busy-or-not answer is kept. |
| `orca terminal close --tab` | you click ▾ on a card, then confirm | Closing that chat's tab, which stops the agent in it. |
| `orca agent launch`, then `orca terminal send` with `/resume` | you click ↻ Continue on an archived card | Starting Claude in that workspace with its list of conversations. |
| `orca worktree list`, `orca worktree set --workspace-status` | the Workspace Board sync is on | Reading every workspace's status, and setting one when you drag a card. |

### Files outside the plugin's own folder

- **Read:** Orca's profile database, read-only, for the ids and names of the workspace statuses, and only while the sync is on. See [how the status names are read](#how-the-status-names-are-read).
- **Written:** the images you attach in a reply box, as files in `orca-chat-board` under your temp folder, which the agent needs to read them.

### What stays where

The plugin makes no network requests and sends nothing anywhere. Some of what Orca's CLI returns, such as a preview of each terminal's latest output and the agent's last message, prompt or tool input, is never stored by the plugin; it keeps only titles, agent type and status. The hover preview and the reply box read your last prompt and the agent's last reply from Orca when you ask, show them, and keep them for a few seconds in memory only. A terminal screen read for the reply box is shown and not stored. The plugin sends input to an agent only when you press Send or ↻ Continue, and only the text you typed, the images you attached, or `/resume`.

## Limitations

- Orca puts plugin panels in the right sidebar only, and a plugin cannot draw outside its panel. The reply box is as wide as the sidebar.
- Orca does not tell plugins about tab switches, so the panel asks. See [Check Orca automatically](#check-orca-automatically).
- The reply box shows the last exchange only. Orca does not hand a chat's history to plugins.
- Orca's chat tabs show up once they have a conversation. Opening one shows its workspace but not the tab itself, because Orca cannot switch to a chat tab from outside yet, and nothing can be sent to one. Loop monitoring is not detected in chat tabs, since Orca's tool hook names no terminal for them.
- Monitoring is recognised from tool calls, because Orca does not expose its own monitoring state to plugins. Only Claude Code's tool names are known so far. Orca does not run this hook for agents on SSH or WSL hosts.
- **Chats Orca lost track of.** A chat shows no status icon until Orca reports one for it. Some sessions, such as ones started before Orca's status hooks were set up or ones that were open when Orca restarted, never report. For those the plugin reads the state off the terminal instead: when a terminal has fresh output long after Orca's record of a finished turn, it reads that terminal's screen once, and a Claude Code spinner line or an "esc to interrupt" hint there means a turn is running; the turn is over when the terminal goes quiet and the screen no longer shows it. This runs with the automatic check or on ⟳, lags a few seconds behind, misses turns shorter than that, and knows only "working" and "done". Other agents' screens are not recognised yet.
- Attached images, the suggested prompt and ↻ Continue rest on how Claude Code behaves in a terminal. Other agents get the image's path as text and have no suggestion or Continue button.
- Upstream is tested on macOS. This fork is used on Windows 10 with Orca 1.4.255. On Linux the worker uses the CLI launcher Orca ships (`orca-ide`), but this has not been tried yet. If the board stays empty there, please open an issue.

## How it works

- `src/worker.ts` is a Node worker. It lists chats through the Orca CLI, tracks agent status and tool calls from Orca's events and hooks, and answers the panel.
- `src/board.ts` holds the pure board logic: merging chats, moving cards, columns and the unseen mark. A chat that comes back with a new tab id, for example after an Orca restart, is matched back to its card by pty id, or by title and workspace.
- `src/cli.ts` is the one place that starts the `orca` CLI.
- `src/sync.ts` holds the rules of the Workspace Board sync, and `src/profile.ts` reads the status names from Orca's profile.
- `src/monitor.ts` recognises loops and watchers from tool calls and decides when one has lost its signal.
- `src/screen.ts` reads a busy turn and the suggested prompt off a terminal's screen, and `src/attach.ts` keeps and saves the images of a reply.
- `panel/` is the HTML panel. It uses native drag & drop, and holds the board (`index.ts`), the reply box (`reply.ts`), the hover preview (`preview.ts`), the strings (`i18n.ts`), status icons (`icons.ts`) and agent logos (`logos.ts`).

## Development

```sh
orca plugin dev watch . --check   # load this folder into Orca and reload on save
orca plugin test .                # tests
npx -y -p typescript tsc -p tsconfig.ci.json --noEmit   # type-check
orca plugin shot local.chat-board --panel board --width 900 --out board.png
orca plugin logs local.chat-board # the worker's log
```

Type-check with `tsconfig.ci.json`. `tsc -p .` writes `.js` files next to the sources.

CI (GitHub Actions, Linux, macOS and Windows) type-checks against a snapshot of Orca's typings and runs the tests that need no Orca host. See [`ci/`](ci/README.md).

## Credits

The agent logos are the ones Orca ships for each agent. They belong to their respective owners.

## License

[MIT](LICENSE)
