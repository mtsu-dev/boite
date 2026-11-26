# Conversations and projects

A project is a folder on your machine. Each conversation (a thread) runs an
agent in a project, in that folder, in a git worktree of its own, or in a
draft folder when you have no project yet.

## Start a conversation

1. Press New thread at the top of the sidebar, or pick New thread in a
   project's menu.
2. The heading reads Start a thread, followed by the project. Open the project
   name to change it, or pick Open a folder to add one.
3. Turn on Worktree under the message box to work in a git worktree on its own
   branch instead of the project folder.
4. Type your request and send it.

The chat shows Starting agent while the agent launches, then Working for once
it starts working. The startup timer counts the current turn.
Your message stays near the top while the reply fits below it. When the reply
outgrows that space, the chat follows the latest text until you scroll up.
The conversation header names what it is waiting on and how long the wait has
lasted when the start time is available. In the thread list, rows waiting on
sub-agents, pull requests, monitors or background work show a pulsing icon and
the elapsed time (with full details in the tooltip), while rows waiting on your
answer keep the steady Needs you dot. When a pull request watch pauses, the
header gives the reason and the next check time.

An agent can warn that something went wrong beside its work while it carries
on: the disk was full and part of the conversation was not saved, attached
files did not reach it, or its instruction files are too long. The warning
shows as a warning line in the reply, with the agent's own report behind its
"i". The turn goes on.

After the agent answers, the empty message box can show the next message the
agent expects, in grey with a Tab key beside it. Press Tab to write it in as
a draft you can edit, then send it as usual; Tab never sends. Press Esc to
hide it until the next answer. On a phone it shows as a chip above the box:
tap it to write it in, or tap its x to hide it. The suggestion goes away once
you type, and is not shown while a question or a permission waits for you.

It comes from Claude and Codex themselves, at no extra cost, and only in
conversations you lead, not in subagents, workflows or councils. Codex shows
one only on versions that support it; Claude starts from its second answer. The conversation must be on screen when
the answer ends, unless agents stay warm a few minutes. Turn it off with Suggest the next message in Settings,
General; a Claude conversation already open follows the change the next time
its agent starts.

The message box checks spelling and corrects as you type, as your system
does. Turn off Check spelling and correct as I type in Settings, General, In
the conversation, to keep your text as typed, with no red underline.

Add a project with Add a project at the bottom of the sidebar. The sidebar
lists threads by project or by recent activity: on a desktop, switch between
Projects and Recent under View in the Filter menu; on a phone, in the list's
title. Under Display in the desktop Filter menu, Mochi layout turns on the left
app rail with your mochis, teams and shortcuts along the window's edge; with it
off, Activity, Contacts, Mochis, machines, updates, limits and Settings sit in
the compact bar at the foot of the sidebar. The two arrows at the start of the
list's head go back and forward through the conversations and pages you opened,
as a mouse's side buttons do.

If a machine's conversation list is incomplete, press Try again in the list.
The conversations already loaded stay available while Boite reloads it.

Fold a project to hide its threads. Its heading shows the thread count just
after the project name, on desktop and phone.

In the Projects view, the projects where something needs you come first.
Below them, Inactive gathers the projects where no thread runs and nothing
waits on you; fold it to hide them. No threads, closed at launch, lists the
projects without a single thread: choose one to start a thread there. Archived
projects come last, closed too. Turn off Inactive projects in the Filter menu
to keep every project in the main list.

A thread with a pull request keeps its last badge on this device. When you
reopen Boite, the badge can appear as soon as the thread is listed, and Boite
updates it when it checks again.

The Threads button in the app rail (when Mochi layout is on) and the Threads
tab on a phone show how many threads are at work across your machines. When
subagents are at work too, a second, lighter number counts them: in the rail,
under the first, both at the rail's edge so the button's icon stays readable;
beside it on the phone's tab.

A middle click on the Activity button takes the finished threads off Activity
on every machine, without opening it. Failures, stops, questions and
permissions stay, and so does the button's number. On a phone, or without a
middle button, Mark all as read at the top of Activity clears the finished
threads along with failures and stops.

## Drafts without a project

A new device opens a draft. Drafts live in `Documents/Boite`, and each
conversation started there gets a folder of its own, named after the day and
the first words of its title, such as `2026-09-23 Plan the trip to Lisbon`.
The agent works in that folder, so what it writes stays with the conversation.
The folder keeps its name when the title changes later.

- The drafts folder is not a git repository, so the Worktree switch is hidden
  there.
- Under the message box, Work in a folder of mine opens a folder instead.
- On Windows, Boite follows a Documents folder that OneDrive or you moved. On
  Linux it reads the Documents folder your desktop sets.
- A paired phone can start a draft too.

### Incognito

Turn on Incognito at the right of the draft's header before the first send.
The conversation and its folder are erased as soon as you leave it: open
another thread, start a new draft, archive it or delete it. It never shows in
the sidebar, the command palette or the phone's lists, and its usage leaves
the Usage page with it. You cannot fork it or move it to a project. Files the
agent's own CLI writes elsewhere, such as its session transcripts in your home
folder, stay.

## Worktrees

A new worktree conversation starts from the project's default branch. Boite
checks the remote for its latest commit and uses the local default branch when
offline. Boite renames the temporary branch after the conversation's title
while the first turn runs. A branch you named yourself, or one with a remote,
keeps its name. The header shows the branch.

- Worktree by default, in a project's Manage project menu, turns the switch on
  for every new thread there.
- Settings, General, Worktrees sets where new worktrees go: In each project
  (under `.boite/worktrees`) or One shared folder.
- A worktree stays on disk after its thread is archived. Show worktrees lists
  them; Remove deletes the folder and its branch, and Remove the clean ones
  clears those with nothing to lose.
- When a worktree's folder is deleted by hand or by a script while its branch
  stays, the next message to its conversation, yours or one Boite sends,
  checks the branch out there again with all its commits. Changes that were never committed are gone with
  the folder. When the branch is gone too, the conversation says which folder
  is missing.
- Remove settled worktrees, in Manage project, retires a worktree an hour
  after all its conversations are done or archived, only when its last commit
  is on another branch or in a merged pull request. It keeps worktrees with
  uncommitted changes, including files Git ignores. Boite logs where it saved
  files that changed during removal or that Boite could not verify. Run
  `boite projects recoveries` from your terminal to find those files and
  check them before deleting them by hand. Deleted copies drop out of the list
  the next time you run the command.
- Ask to finish after merge: once every pull request of a worktree conversation
  is merged or closed, Boite asks its agent whether the conversation is done.
  The agent moves it to Done or keeps it open when it still has something to
  say, or when its last answer waits on you: a build to try, a question, a
  choice or an offer. Nothing goes to Done by itself.

## Titles

A thread first takes the first line of your prompt. While the first turn runs,
the agent's small model writes a short title of 2 to 6 words. When your request
leaves the subject unclear ("fix this", a bare link or image), the title is
refined once the first answer is done. A title you set yourself is never
replaced.

- Rename a thread with Rename in its thread menu, or in the header.
- Choose Copy thread ID in the thread menu to put the thread's ID on the clipboard.
- Regenerate title, in the thread menu or the title menu, asks again. The item
  reads Writing a title while it works.
- Settings, General, Agent replies, Title model picks the model. Automatic
  uses the thread's own agent on its small model.
- Muse Code, OpenCode, Antigravity, Grok and pi keep the prompt's title under
  Automatic.

## Notifications

On a desktop, notifications appear in the top-right corner, under the top bar,
without moving the conversation. On a phone, they sit
above the message box or the bottom tabs.

## Done, archived and deleted

- Mark done moves a thread to the Done group. Archive puts it aside to pick up
  later; the toast offers Undo, or press Ctrl+Z.
- A project's archived threads open under its card from the archive count in
  its heading, beside the Done count, on desktop and phone, ten rows at a time.
  Select a row to read the conversation.
- Archived threads is also a section of Settings > General, for every project.
  Filter and the command palette open it there. Each row shows the
  project, why the thread was archived and when it will be deleted, with
  Restore and Delete. Select a title to read the conversation. Restore it from
  the row or from the open conversation before sending a message. Restoring brings back your message
  draft. Its agent starts again with your first message.
- A project's Done list opens from the Done count in its heading, on desktop
  and phone, and shows ten rows at a time; scroll it for the rest.
  The row shows when each conversation was put away. To reveal Restore on
  desktop, point to the row or focus it with the keyboard. Restore is visible
  on touch screens.
- Delete done threads after (days) defaults to 3. Manual archives are kept.
- Delete shows how long the conversation's machine keeps its history. Choose
  Archive in the same dialog to put a current conversation aside.
- The owner can restore a deleted conversation from Show deleted conversations
  for the number of days set in Keep deleted conversations for. Find both under
  Settings > General on desktop and Settings > General > Archived threads on
  a phone. Pick a machine in Archived threads to change its retention settings.
  On a paired phone, use Undo in the confirmation toast immediately after
  deleting a conversation.
- Once a mode is picked in Conversation storage, it replaces Keep deleted
  conversations for: see [Conversation storage](#conversation-storage).
- Archive project takes a project out of the list. Its threads keep running,
  and a new thread brings it back. Remove from Boite stops its conversations
  and hides the project. Add the same folder again to recover its history and
  reopen the conversations that were open. Files on disk stay in place.

## Import a Claude Code or Codex session

1. Open a project's menu (right click, or the dots beside its name), then
   Manage project, Import a session.
2. Pick a session started in that folder. One already imported shows
   Imported.
3. Boite opens a thread with its history, and your next message continues the
   same session.

The list holds the Claude Code and the Codex sessions of that folder, for
every account of either agent. When it holds both kinds, each row names its
agent. Other agents' sessions cannot be imported. Subagent conversations are
left out, and the Usage page does not count the imported turns.

## Project icons

Each project shows a tile: the logo found in its folder, else the mark of its
stack (React, Rust, Godot and others), else its first letter. Boite looks for
SVG, PNG, WebP, JPEG or ICO images of at most 256 KB. After you change the
logo, pick Refresh icon in Manage project.

## Going further

- [First steps](first-steps.md): your first project and conversation.
- [Models](models.md): change the agent or model in a conversation.
- [Secrets](secrets.md): give an agent a key without pasting it in the chat.
- [Experiments](experiments.md): unfinished features, in Nightly builds, such as the animated background of a new thread.
- Technical reference: [drafts](internals/drafts.md),
  [titles](internals/titles.md), [imports](internals/imports.md),
  [project icons](internals/project-icons.md).


## Conversation storage

Agents write a lot to disk as they work. Conversation storage, under
Settings > General (Settings > General > Archived threads on a phone), decides
what the machine keeps as a conversation ages. Nothing changes until you pick
a mode and press Apply.

| Mode | A deleted conversation | An open conversation |
| --- | --- | --- |
| Delete | compacted at once, erased after 7 days | kept whole |
| Classic | compacted after 7 days and kept, its images erased after 30 days | kept whole |
| Storage | compacted after 30 days and kept with its images | compacted after 30 days without activity |
| Custom | you set each delay | you set each delay |

- Compacted means smaller, not summarized: every message, the agent's
  reasoning, every tool call and every error stay. Long tool outputs are
  shortened and each image is stored once.
- A deleted conversation restores until it is compacted. After that it has
  left the app and stays readable for audits, by you and by your agents.
- An open conversation that was compacted still shows whole. Replying to it
  starts a fresh agent session from what the app shows.
- Usage and costs are kept in every mode, even for an erased conversation.
- Pick a mode to see what it would free on this machine before applying it.
  Compare shows the four modes side by side; Custom opens it so you can type
  each delay, and an empty field means never.
- Sessions no conversation uses are listed under the modes once one is
  applied. Compact them keeps them for audits; nothing erases them.
