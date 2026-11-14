# The agent's browser

When an agent needs a web page, it opens it in a browser on the machine that
runs its conversation. You watch the same tabs from the panel, on the desktop
or a phone, and you can click, type and sign in there yourself.

![The agent's browser shown live in the panel](images/agent-browser-live-desktop.png)

## What the agent can do

- Open pages, read them, click, type, fill forms and pick options in lists.
- Work in frames from other sites, such as a payment form or an embedded
  sign-in.
- Record a tab as a silent video. A recording still running when the turn
  ends is thrown away.
- List the calls a page makes to its servers. Passwords, tokens, cookies and
  keys in them are hidden before the agent sees them.
- Keep a script that worked on a site under a name, so the next agent with
  the same task runs it in one step. These scripts belong to the machine.
- Download files. They go to a quarantine folder, never into your project,
  until the agent saves one there. An agent is told never to run a downloaded
  program you did not ask for.

The agent drives the browser with its own commands; nothing needs to be
turned on.

## Which browser it uses

Boite uses a Chromium-based browser already installed on that machine: Chrome,
Edge, Chromium or Brave. Edge ships with Windows 10 and 11, so a Windows
machine always has one. Boite installs nothing. A machine without any says so
in the panel.

To use a specific browser, set `BOITE_BROWSER` to its executable in the
environment Boite starts with.

## Watch the agent's pages

1. Open the panel's Browser surface. When the agent opens a tab in the
   conversation on screen, the panel opens on it by itself, except on a phone.
2. On most clients a card says "This agent controls a browser on" and the
   machine's name. Press Show. Nothing is captured or sent before that.
3. Press Hide in the tab strip to cover the page again.

The desktop app on the agent's own machine shows the page at once, with no
card. On a phone, the header's Browser button opens it, and Chat or Back
returns to the conversation without closing any tab.

## Take over the page

- On a computer, click the page, then type. Drag to select, double-click a
  word, scroll with the wheel. Copy, cut and paste use your own clipboard.
- On a touch screen, tap to click and drag to scroll. Type in the field under
  the page. Double-tap a word, then press Copy to copy it.
- A list opens on your screen, and your pick reaches the page.
- Press **+** to open a tab of your own, then enter an address. The agent sees
  it and can use it. A tab's close button closes it, the agent's tabs
  included.
- Display sets the page size: Phone, Tablet or your own width and height. The
  agent sees the same size. Fit this screen goes back to your view's size.

Some sites still show a captcha. Solve it in the panel: clicks and drags reach
the page as you make them.

## Sign-ins and profiles

The agent's sign-ins live on the machine that runs the agent, not on the
device you watch from. Each browser profile keeps its own cookies and
sign-ins after a restart. A private tab keeps nothing once the last private
tab closes.

To sign the agent in to a site:

1. Show the agent's browser.
2. Open the site in a new tab and sign in there.

When an agent meets a sign-in page, it may ask you in the chat. The question
card's Open button opens the page in the conversation's browser.

Settings, Browser, Browser profiles lists the profiles:

- Add profile creates one. Open new tabs here picks the profile new tabs use.
- User-Agent, on a profile you created, appends a marker to the browser's
  identity or replaces it. It applies the next time that profile's browser
  starts. Default and Private keep the browser's own identity.
- Copy sign-ins to agents, in the Windows desktop app, sends a profile's
  cookies to the agent browser of a machine you pick. It is a copy at that
  moment: a later sign-in needs a new copy, and a site may still ask again.
- Deleting a profile closes its tabs and erases its data. Delete it in the
  desktop app on the computer that holds it.

### On Windows

The desktop app hosts the agent's tabs in its own browser, with the same
profiles as your own Browser tabs. A site you signed in to there is signed in
for the agent too. Agent tabs are muted. The macOS and Linux apps do not host
tabs: the agent uses its own browser on the machine.

## Limits

- A conversation has at most 8 tabs and a machine 24. A window a page opens
  past that is closed.
- A tab sleeps after 30 seconds unused, once no running turn has used it for
  5 minutes. The agent's next command or your next look wakes it.
- A paired phone can act in pages as you would, signed-in sites included, but
  cannot open or close tabs. Pair only devices you would trust with that.
- On Windows, a program on the same PC that finds the agent browser's port can
  drive it. Do not copy sign-ins into it on a PC other people have an account
  on.
- A download weighs at most 1 GiB. One the agent does not save is deleted an
  hour after it ends.
- The live view is a series of pictures, about twenty per second while the
  page moves on a good connection, not a video stream, and it has no sound.
- The agent's browser draws without the graphics card. A heavy 3D page runs
  slowly there.

## Going further

- [The right panel](panel.md): the other surfaces beside the chat.
- [Devices](devices.md): simulators, emulators and desktop windows.
- [Phone](phone.md): the agent's browser on a paired phone.
- [Accounts](accounts.md): signing in to the agents themselves.
- Technical reference: [the agent's browser](internals/browser.md)
