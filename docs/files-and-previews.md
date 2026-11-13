# Files and previews

Files travel both ways in a conversation: you attach files to a message, and
the agent sends files, links, diagrams and small interactive pages back. This
page shows what each looks like and where its limits are.

## Attach files to a message

1. Press Attach files under the message box, or drop files on the
   conversation.
2. Remove any file you added by mistake before you send.
3. Send the message.

A file you upload weighs at most 5 MB. Some agents take no images: the
composer says so, and [supported agents](supported-agents.md) lists them.

## Files the agent sends

Ask the agent to attach a file, a report or a video for instance, and it
appears in its answer with a download button.

- Images, videos and sounds show in the conversation. A video never plays on
  its own and has seek and full screen controls.
- An image opens in a viewer with zoom, fit and download.
- An image over 5 MB shows its name and size first. Press Load image to see
  it.
- A PDF has an inline preview while Chat files and previews is on (below).
  Other files are a download.
- The file is a copy taken when the agent sent it. It stays downloadable after
  the agent edits or deletes the original, and after a restart.
- A paired phone downloads it too.

While a turn runs, each file shows where the agent sent it. Once the turn
ends, the files move under the last thing the agent wrote.

![An image and a video sent by the agent](images/chat-media-desktop.png)

## Links in answers

Settings, Conversations, In the conversation, Chat files and previews is on
by default. Each device keeps
its own choice. With it on, a file path in an answer becomes a link:

- Markdown links, bare web addresses, absolute paths, `file:///` links and
  paths written in inline code.
- A click opens a preview of the file from the conversation's machine.
- A relative path that is not found as written is looked up by its end, so
  `core.md` can open `.local/core.md`. When two files match, Boite names both
  instead of guessing.
- An image hosted on the web stays a link, so reading an answer contacts no
  site.

Turned off, file links stay plain text and PDFs lose their preview. Files the
agent sent stay downloadable.

### Open links in their own apps

Settings, Conversations, In the conversation, Open chat links in their apps
is off by default and exists
only in the desktop app. On, a click on a local file or folder opens it in its
default app, shortcuts and files outside the project included. Only links from
this computer open this way. On another machine or a phone, links keep the
preview.

## Pages drawn in an answer

An agent can draw a small page inside its answer: a chart, an animated
diagram, a simulator with sliders. Ask for one when a picture explains better
than text. The page takes the app's theme and colors, and nothing turns it off.

![A page with sliders, placed between two paragraphs](images/inline-view-placed-desktop.png)

- Pointing at a page shows Play again, View full size and Download over its
  corner. On a phone the same actions sit in a row under it.
- The page runs offline in a sandbox: it reaches no site, keeps nothing and
  cannot touch the app. A link in it opens in your system browser.
- A page that fails to load shows as a plain file card.

## Diagrams and formulas

Answers, plans and Markdown previews draw these blocks:

| The agent writes | You see |
| --- | --- |
| A `mermaid` fenced block | A diagram |
| `$$...$$`, `\[...\]` or a `math` block | A formula on its own line |
| `\(...\)` | A formula in the line |
| A `view` fenced block | A small page, as above |
| `$...$` | Text, so a price or `$PATH` stays as written |

- A diagram has a bar with a copy button, a switch between Diagram and Code,
  and Enlarge. On a touch screen the bar sits above the diagram.
- A diagram wider than the column shrinks to fit, then scrolls. A wide formula
  scrolls sideways.
- Copying a selection that holds a diagram or a formula copies its source.
- A diagram that cannot be read shows its code and the reason. A formula that
  cannot be read stays underlined, with the reason as a tooltip.

## Limits

- Links and images inside a diagram are never drawn.
- Mermaid features the renderer does not support show as an error with the
  code.
- Previews from a link stay inside the conversation's working directory.
- On a paired phone a link to a local file does not open. Ask the agent to
  attach the file instead.
- A drive mapped on your computer does not give another machine access to a
  path. To get a file from that machine, ask its agent to attach it.
- An experimental kit of ready-made controls exists for agents that write
  pages. It is a prototype and is not loaded into pages by default.

## Going further

- [The right panel](panel.md): edit and view project files beside the chat.
- [Conversations](conversations.md): messages, turns and their history.
- [Phone](phone.md): what a paired phone shows and downloads.
- Technical reference: [chat files](internals/chat-files.md),
  [diagrams and formulas](internals/diagrams-and-formulas.md),
  [view kit](internals/view-kit.md)
