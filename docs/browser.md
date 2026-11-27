# The agent's browser

When an agent needs a web page, it opens it in a browser on the machine that
runs its conversation. You watch the same tabs from the panel, on the desktop
or a phone, and you can click, type and sign in there yourself.

![The agent's browser shown live in the panel](images/agent-browser-live-desktop.png)

## What the agent can do

- Open pages, read them, click, type, fill forms and pick options in lists.
  It reads a page as a list of numbered elements. An element keeps its
  number while it stays on the page, and reading the same page again shows
  the agent only what changed, so a long page costs it less each time. Each
  click or keystroke shows it the page that results, so it needs no extra
  step to look.
- Close a cookie banner or a dialog that covers a button before clicking the
  button, the way a person would.
- Get past a site's bot check, such as Cloudflare's "Just a moment" page,
  the way you would: it waits for the check and ticks its box once. It
  solves no puzzle and pays no service; when a check stays, the agent tells
  you, and you can take over the page in the panel.
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
in the panel. Google Chrome comes first when it is installed: sites that check
for bots trust a regular Chrome release more than Chromium or Chrome for
Testing. The browser draws on the machine's graphics card when it can, as
Chrome with a window does.

To use a specific browser, set `BOITE_BROWSER` to its executable in the
environment Boite starts with. On Windows it applies to the profiles whose
Engine is Chrome.

## Watch the agent's pages

For the conversation you're viewing, **Boite browser in the background**
appears above the conversation list while the agent has tabs open. Select it
to see the active tab. The agent can also show a tab when it has something
to share or needs you to act on the page.

You can also open the panel's Browser surface and press Show. Press Hide to
cover a remote page again. On the agent's own desktop app, the page appears
as soon as you open the Browser surface. On a phone, Back returns to the
conversation and leaves the tabs open.

## Take over the page

- On a computer, click the page, then type. Drag to select, double-click a
  word, scroll with the wheel. Copy, cut and paste use your own clipboard.
- On a touch screen, tap to click and drag to scroll. Use the keyboard button
  to show or hide the typing controls. Double-tap a word, then press Copy.
- A list opens on your screen, and your pick reaches the page.
- Press **+** to open a tab of your own, then enter an address. The agent sees
  it and can use it. A tab's close button closes it, the agent's tabs
  included.
- The preview fits your screen. Use Display to change the shared page size
  to Phone, Tablet or your own dimensions. The agent sees that page size too.

Some sites still show a captcha. Solve it in the panel: clicks and drags reach
the page as you make them. The panel reports when the page is still loading,
the server returns an HTTP error or a script fails to load.

## Sign-ins and profiles

The agent's sign-ins live on the machine that runs the agent, not on the
device you watch from. Each browser profile keeps its own cookies and
sign-ins after a restart. A private tab keeps nothing once the last private
tab closes.

The cookies pill in the tab bar names the active profile. From an owner
client, choose another profile in that pill to reload the address in the
same tab with that profile's cookies. Paired devices can see the profile
used by the tab.

To sign the agent in to a site:

1. Show the agent's browser.
2. Open the site in a new tab and sign in there.

When an agent meets a sign-in page, it may ask you in the chat. The question
card's Open button opens the page in the conversation's browser.

Settings, Browser, Browser profiles lists the profiles:

- Add profile creates one. Open new tabs here picks the profile new tabs use.
- Engine, on every profile, Default included, picks the browser the agents
  use in it: App window or Chrome. See [On Windows](#on-windows).
- User-Agent, on a profile you created that runs in Chrome, appends a marker
  to the browser's identity or replaces it. It applies the next time that
  profile's browser starts. Default and Private keep the browser's own
  identity. App window keeps a saved User-Agent but does not apply it.
- Copy sign-ins to agents, in the Windows desktop app, sends a profile's
  cookies to the agent browser of a machine you pick. It is a copy at that
  moment: a later sign-in needs a new copy, and a site may still ask again.
- Deleting a profile closes its tabs and erases its data. Delete it in the
  desktop app on the computer that holds it.

### On Windows

The desktop app hosts the agent's tabs in its own browser, with the same
profiles as your own Browser tabs. A site you signed in to there is signed in
for the agent too. Agent tabs are muted.

A profile's Engine decides where its agent tabs run:

- App window, the default, runs them in the desktop app's own browser. The
  panel shows them smoothly.
- Chrome runs them in the browser described in
  [Which browser it uses](#which-browser-it-uses). More sites that check for
  bots let it through, and the panel shows it as a series of pictures.

Sign-ins follow the profile from one engine to the other. Only you choose the
engine, in Settings: an agent can neither change it nor get around it.

The macOS and Linux apps, and a machine without the desktop app, do not host
tabs: the agent always uses Chrome there.

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
