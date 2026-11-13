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

Add a project with Add a project at the bottom of the sidebar. The sidebar
lists threads by project or by recent activity: switch between Projects and
Recent in Display options.

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
Usage, in Settings, AI accounts, with it. You cannot fork it or move it to a project. Files the
agent's own CLI writes elsewhere, such as its session transcripts in your home
folder, stay.

## Worktrees

A worktree conversation starts on a temporary branch, then Boite renames the
branch after the conversation's title while the first turn runs. A branch you
named yourself, or one with a remote, keeps its name. The header shows the
branch.

- Worktree by default, in a project's Manage project menu, turns the switch on
  for every new thread there.
- Settings, Conversations, Worktrees sets where new worktrees go: In each project
  (under `.boite/worktrees`) or One shared folder.
- A worktree stays on disk after its thread is archived. Show worktrees lists
  them; Remove deletes the folder and its branch, and Remove the clean ones
  clears those with nothing to lose.
- Remove settled worktrees, in Manage project, deletes a worktree an hour
  after all its conversations are done or archived, only when its last commit
  is on another branch or in a merged pull request. Uncommitted changes always
  stay.
- Ask to finish after merge: once every pull request of a worktree conversation
  is merged or closed, Boite asks its agent whether the conversation is done.
  The agent moves it to Done or keeps it open when it still has something to
  say. Nothing goes to Done by itself.

## Titles

A thread first takes the first line of your prompt. While the first turn runs,
the agent's small model writes a short title of 2 to 6 words. When your request
leaves the subject unclear ("fix this", a bare link or image), the title is
refined once the first answer is done. A title you set yourself is never
replaced.

- Rename a thread with Rename in its thread menu, or in the header.
- Regenerate title, in the thread menu or the title menu, asks again. The item
  reads Writing a title while it works.
- Settings, Conversations, Agent replies, Title model picks the model. Automatic
  uses the thread's own agent on its small model.
- Muse Code, OpenCode, Antigravity, Grok and pi keep the prompt's title under
  Automatic.

## Notifications

On a desktop, notifications appear in the bottom-right corner without moving
the conversation. They stay above the message box and its controls. On a
phone, they sit above the message box or the bottom tabs.

## Done, archived and deleted

- Mark done moves a thread to the Done group. Archive puts it aside to pick up
  later; the toast offers Undo, or press Ctrl+Z.
- The agent of an archived thread stops. Restore it from View archived threads
  in the project menu, or Settings, Conversations, Archived threads. Its agent starts
  again with your first message.
- Delete done threads after (days) defaults to 3. Manual archives are kept.
- A deleted conversation can be restored from Show deleted conversations in
  Settings, Conversations, Archived threads, for the number of days set in
  Keep deleted conversations for.
- Archive project takes a project out of the list. Its threads keep running,
  and a new thread brings it back. Remove from Boite removes the project and
  its threads; the files on disk stay.

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
left out, and Usage, in Settings, AI accounts, does not count the imported
turns.

## Project icons

Each project shows a tile: the logo found in its folder, else the mark of its
stack (React, Rust, Godot and others), else its first letter. Boite looks for
SVG, PNG, WebP, JPEG or ICO images of at most 256 KB. After you change the
logo, pick Refresh icon in Manage project.

## Going further

- [First steps](first-steps.md): your first project and conversation.
- [Models](models.md): change the agent or model in a conversation.
- [Secrets](secrets.md): give an agent a key without pasting it in the chat.
- [Experiments](experiments.md): unfinished features, in Nightly builds.
- Technical reference: [drafts](internals/drafts.md),
  [titles](internals/titles.md), [imports](internals/imports.md),
  [project icons](internals/project-icons.md).
