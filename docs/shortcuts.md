# Keyboard shortcuts

Most actions in Boite have a keyboard shortcut, and you can change any of
them. In the table, Ctrl means Ctrl on Windows and Linux and Cmd on macOS.

## Default shortcuts

| Shortcut | What it does |
| --- | --- |
| Ctrl+K | Open the command palette |
| Ctrl+N | Start a new thread in the open project |
| Ctrl+Enter | Send the message, then open a fresh draft with the same choices |
| Ctrl+Shift+S | Stash the composer text, or take it back |
| Ctrl+F | Find in this thread; Enter and Shift+Enter walk the matches |
| Ctrl+Alt+C | Copy the last answer |
| Ctrl+Shift+T | Reopen the thread archived last |
| Alt+1 to Alt+9 | Go to the thread in that row of the sidebar |
| Ctrl+S | Fold or unfold the sidebar; in a file editor, save the file |
| Ctrl+, | Settings |
| Ctrl+Alt+B | Show or hide the side panel |
| Ctrl+Shift+J | Open the browser surface |
| Ctrl+Shift+C | Open the changes surface |
| Ctrl+Shift+F | Open the file tree |
| Ctrl+Shift+K | Open the tasks surface |
| Ctrl+W | Close the active surface of the panel, never the window |
| Ctrl+J | Open or hide the drawer under the chat: terminal or project board |

While a terminal has the keyboard, its own shortcuts come first:

| Shortcut | What it does |
| --- | --- |
| Ctrl+N | New terminal |
| Ctrl+D | Split the terminal right |
| Ctrl+Shift+D | Split the terminal down |
| Ctrl+W | Close the terminal |
| Ctrl+Shift+F | Find in the terminal |
| Ctrl+Shift+H | Recent commands of the shell |
| Ctrl+Up, Ctrl+Down | Go to the previous or next command |

Pin, rename, archive, Regenerate title, the theme and a few Settings pages have
no default shortcut; you can give them one. Alt+1 to Alt+9 follow the
physical key, so they work on keyboard layouts where the top row types other
characters. In a plain browser tab, the browser keeps Ctrl+Shift+T for
itself.

## Change a shortcut

1. Open Settings, Input, Keyboard. Filter commands finds a command by its name, its
   id or its keys.
2. Click a shortcut, hold the modifiers and press the key. It applies at once
   on this machine.
3. If another command already has those keys, Boite asks first; Move it here
   takes them from that command.

- Hold Ctrl, Alt or Win (Cmd on a Mac) with the key. A key alone, or with
  Shift only, is typing and is refused. Function keys work alone.
- Escape cancels the recording.
- Back to the default resets one command, Remove the shortcut leaves it with
  no key, and Reset all resets everything.

### Edit the shortcuts file

Settings, Input shows the Shortcuts file card, with Open the file and Copy the
path. It maps command ids to keys, or to `null` to take a key away:

```json
{
  "new-thread": "mod+shift+n",
  "palette": "mod+p",
  "sidebar": null
}
```

`mod` is Ctrl on Windows and Linux and Cmd on macOS. Each command's id shows
in the Keyboard card. Boite applies a save at once, without a restart. Lines
it cannot read appear under Refused in the Shortcuts file card, and the others still
apply. A file that is not valid JSON applies nothing until you fix it.

## What you cannot change

- Ctrl+Q, which quits the desktop app when held.
- The zoom of the desktop app: Ctrl+=, Ctrl+- and Ctrl+0.
- A full-screen program in the terminal still receives its Ctrl-letter keys.

## Pointer behaviours worth knowing

- Edge scrollbars: scrollbars take no room. Each one fades in as the pointer
  nears the edge of its area and can still be dragged. It is on by default on
  a desktop, for mouse and pen only, and you can turn it off in Settings,
  Appearance, Terminal and scrollbars. Phones keep their own scrollbars, and high contrast mode keeps
  the native ones.
- A thread starts loading when you press its row, before you release the
  button, so it opens faster, most of all on a remote machine. A drag or a
  press you cancel loads nothing. On a slow or data-saving connection, a tap
  waits for its release.

## Going further

- [Conversations](conversations.md): threads, archiving and titles.
- [Context](context.md): queued messages and stopping a turn.
- [Terminal](terminal.md): the terminal under the chat.
- [Panel](panel.md): the surfaces beside the chat.
- Technical reference: [keybindings](internals/keybindings.md),
  [interactions](internals/interactions.md).
