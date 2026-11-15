# Terminal

Each conversation has its own shells in a drawer under the chat, opened in the
conversation's working directory. Use them to run a command yourself while the
agent works, or to finish a sign-in that asks questions in a terminal.

## Open and close the terminal

1. Press `Ctrl+J`, or the terminal button in the conversation header. Press it
   again to hide the drawer and go back to the message box.
2. Drag the drawer's top edge to set its height. Each device keeps its own.
3. Hiding the drawer stops nothing. The cross ends the shell that has the
   keyboard, and a tab's cross ends every shell of that tab.

The shell keeps running when you switch conversations, reload the app or open
a second window: the screen comes back with its recent output. Archiving the
conversation closes its shells. Stopping a turn ends what the agent started,
never your shell.

## Tabs and splits

- New terminal opens a shell in a new tab. Split right and Split down put a
  shell beside or under the active one. Drag the line between two panes to
  resize them.
- A tab holds up to four shells, and a conversation runs at most 16.
- Tabs are named Terminal 1, Terminal 2 and so on, and show the folder their
  shells are in.
- On a phone-width screen each shell is its own tab. The split comes back on a
  wider screen.

## Which shell runs

| System | Shell |
| --- | --- |
| Windows | PowerShell 7 if installed, else Windows PowerShell, else `cmd.exe` |
| macOS and Linux | Your `$SHELL`, else `/bin/bash`, else `/bin/sh` |

To pick another one, set `BOITE_TERMINAL_SHELL` in the environment Boite
starts with. In bash and PowerShell, Boite adds a few lines at start to mark
each prompt; nothing is written into your own files.

## Work in the shell

- With bash or PowerShell, each command gets a dot left of its prompt: green
  when it succeeded, red when it failed (the tooltip gives the exit code), and
  pulsing while it runs.
- Find in the terminal (`Ctrl+Shift+F`) highlights matches. Enter goes up the
  scrollback, Shift+Enter down.
- Recent commands (`Ctrl+Shift+H`) lists the shell's history with a search.
  Enter runs it, Shift+Enter puts it at the prompt.
- `Ctrl+Up` and `Ctrl+Down` jump to the previous and next prompt.
- A right click copies the selection, or pastes when nothing is selected.
  Shift and right click shows the browser's menu. Alt and click moves the
  cursor to the pointer.
- Links in the output open in your browser on a click.

## Keys

While a shell has the keyboard, these act on the drawer instead of reaching
the shell:

| Key | Action |
| --- | --- |
| `Ctrl+N` | New terminal in a new tab |
| `Ctrl+D` | Split right |
| `Ctrl+Shift+D` | Split down |
| `Ctrl+W` | Close the shell |

Because `Ctrl+D` splits, type `exit` to end a shell. Other Ctrl-letter keys
such as `Ctrl+K`, `Ctrl+S` and `Ctrl+F` reach the shell, and the up arrow and
`Ctrl+R` stay the shell's own history. On Windows and Linux, `Ctrl+C` copies
a selection or interrupts when nothing is selected, and `Ctrl+V` pastes.
Settings, Keyboard, Terminal changes these keys.

## Settings

In Settings, Appearance, for this device:

- Terminal cursor: Bar (the default), Block or Underline.
- Draw terminals on the GPU: on by default. Turn it off if a terminal draws
  badly; it applies to terminals opened next.

## Sign in from a terminal

Some agents sign in through a menu in a terminal rather than a web page. Boite
opens that sign-in in the same kind of shell.

1. Press Sign in for that agent in Settings, Providers.
2. Answer its questions in the terminal.
3. Press Close the terminal once you are signed in.

[Accounts](accounts.md) explains the sign-in of each agent.

## Limits

- A paired phone has no terminal: a shell on the machine gives more access
  than a phone holds.
- On Windows, mouse clicks do not reach full-screen programs such as vim or
  htop. Their screen and colors work.
- On Linux and macOS, a program that leaves its process group can keep
  running after its shell closes.
- After five minutes hidden, a screen is rebuilt from the last 256 KiB of
  output when it shows again, so older scrollback is gone.
- zsh, fish, cmd, sh and the macOS login bash run without the prompt dots.

## Going further

- [Shortcuts](shortcuts.md): every key of the app.
- [Accounts](accounts.md): signing in to each agent.
- [The right panel](panel.md): files, changes and tools beside the chat.
- [Phone](phone.md): what a paired phone can and cannot do.
- Technical reference: [terminal](internals/terminal.md)
