# The right panel

The panel sits beside a conversation and shows what the agent works on: the
files it changed, the project's files, its tasks, its processes and its
browser. It reads the conversation's own working directory, on the machine
that runs it.

![The Changes tab beside a conversation](images/panel-changes-desktop.png)

## Open the panel

1. Press Panel in the conversation header.
2. Pick a surface in the panel's menu. With the menu showing, one letter
   opens a surface too: B the Browser, D the Device panel, M Discussions.
3. Press **+** in the tab strip to open another surface beside the first.
4. Drag the panel's left edge to resize it. A double click on the edge, or
   Home, restores the default width, and Escape cancels a drag.

The conversation list stays open beside the panel. In a narrow window, where
the list and the panel would leave the conversation too little room, the panel
lies over the conversation instead; click outside it to hide it.

Tabs are kept per conversation. The width is shared by every conversation on
this device. Settings, Input, Keyboard lists the shortcuts that open the panel and
each surface.

## What each surface shows

| Surface | What it shows |
| --- | --- |
| Changes | The working tree's changed files. Click one to see its diff. |
| Files | The working directory as a tree, with a Filter field. |
| File | One file: a text editor, an image viewer, or a video or sound player. |
| Tasks | Goal and loop, Pull request watches, Agent tasks, Project todos. |
| Trace | The processes of this conversation ([task manager](task-manager.md)). |
| Browser | The browser the agent drives ([the agent's browser](browser.md)). |
| Preview | A local page the agent opened for you. |
| Device | Simulators and emulators ([devices](devices.md)). |
| Window | A desktop window an agent watches ([devices](devices.md)). |
| Subagents | The conversation's subagents and workflow runs ([subagents](subagents.md)). |
| Discussions | What the agents said to each other ([coordination](coordination.md)). |

## Changes and files

- The Changes tab draws additions in green and deletions in red. On a narrow
  panel it shows the list or one diff, with All changes, Previous file and
  Next file to move between them.
- The panel never locks the repository: the agent's own git commands keep
  working while you read.
- A text file opens in an editor. Save with the Save button or your system's
  save shortcut. An unsaved edit stays with its tab when you switch tabs or
  conversations, and closing the tab asks first.
- An image opens fitted to the panel. The wheel zooms, a drag pans, and the
  bar has Fit and 1:1. Any other file shows its size and a download link.
- Syntax colors follow the file's extension. A text over 200,000 characters
  stays plain.

A finished turn that wrote files ends with a card listing them as New, Changed
or Deleted. A row opens the file in a File tab. In the desktop app on its own
machine, Show in folder opens your file manager with the file selected; it
never runs the file.

## Tasks and pull requests

The Tasks tab has four sections:

- Goal and loop: the [goal](goals.md) or loop running in this conversation.
- Pull request watches: the pull requests the agent asked Boite to watch.
  Boite reads each one on GitHub about once a minute and wakes the agent when
  a check fails, the checks pass, a review or comment lands, the branch
  conflicts or it leaves the merge queue unmerged. Stop watching ends it.
- Agent tasks: the agent's own task list.
- Project todos: the project's list. Type in Add a todo to add one. A card
  marked Awaiting you waits for your confirmation: Confirm it is done, or
  Move back to open. Only you can remove a todo or mark it done.

## Point the agent at a page element

Preview comments is on by default, in Settings, Conversations, In the
conversation.

1. Open a Browser tab and choose Reference an element.
2. Click an element. A mention is added to your message at the cursor.
3. Write around it and send. Click a sent mention to show the element again.

A message holds at most 8 references. Escape cancels the selection. A draft
with references cannot be stashed or sent with /goal or /loop.

## Choose what the panel offers

- Settings, Appearance, Workspace, The side panel opens on: Its menu, Files
  or Changes.
- Settings, Appearance, Buttons, Side panel menu hides surfaces you never use.
  A right click on a card in the menu does the same, and the menu's last row,
  Choose the buttons, leads back there.

A hidden surface still opens from the command palette, its shortcut, or when
the agent opens it.

## The floating panel

In the desktop app, Float inside the app in the browser toolbar turns the
panel into a card over the conversation. Drag its top bar to move it and any
edge or corner to resize it. Return to panel puts it back. Pages keep their
forms and history through all of this. At phone width the card fills the
screen.

## On a phone

- At 720 px wide and below, the panel covers the chat. Chat or Back hides it
  without closing the agent's browser tabs.
- The phone header's Browser button opens the agent's browser directly.
- A reload keeps the tabs and starts with the panel closed.
- A paired phone offers Changes, Files, Subagents and Discussions. Files are
  read only, with no Save. Tasks and Trace stay in the owner's app.

## Limits

- The panel only reads files inside the conversation's working directory. A
  path that leads outside, through a link or `..`, is refused.
- Switching conversations keeps browser pages alive. Closing a tab, archiving
  the conversation or quitting the app releases them.
- The Linux app has no built-in browser: it offers to open pages in your own
  browser instead.

## Going further

- [The agent's browser](browser.md): watch the agent's pages and take over.
- [Files and previews](files-and-previews.md): files and pages in the chat.
- [Terminal](terminal.md): a shell under the chat.
- [Task manager](task-manager.md): processes, CPU and memory.
- [Phone](phone.md): the app on a paired phone.
- Technical reference: [panel](internals/panel.md)
