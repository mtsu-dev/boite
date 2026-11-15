# First steps

The first time Boite opens, a short tour sets it up with you. This page walks
through the tour, the language and appearance settings, connecting an AI,
opening a project and sending your first message.

## The tour

On a computer the tour has seven screens. Each choice applies at once and
stays editable in Settings afterwards.

| Screen | What it shows | What you choose |
| --- | --- | --- |
| Welcome | One conversation per task, agents working in the background | Language and theme |
| First, which one are you? | Two plain answers | A preset of settings (below) |
| Conversation | Switching agent, dictating, reviewing changes | Optional local dictation download |
| Usage | A subscription limit and when it resets | Nothing |
| Reach | Following a conversation from your phone | Nothing |
| Quiet | Agents that do not take over the screen or speakers | Notifications, close to tray, focus guard, mute |
| Privacy | Anonymous usage counters | Basic counters, more data, or off |

- The privacy screen has no Next button: picking one of its rows closes the
  tour. [Privacy](privacy.md) explains each choice.
- Escape or the cross leaves the tour. Leaving early counts as seen, and
  nothing you already chose is lost.
- A paired device sees six screens, without the privacy one. A phone sees two:
  Welcome and Reach.
- The tour opens once per device. To see it again, use Settings, General,
  Getting started, Replay the tour, or Show the tour again in the command
  palette.

### The preset question

The second screen asks whether you are a developer. Your answer sets a few
existing settings; each one can be changed later on its own.

| | "I'm not a developer!" | "I'm a developer, give me the works." |
| --- | --- | --- |
| The app opens on | Drafts, in `Documents/Boite` | The last project |
| The side panel opens on | Files | Changes |
| Buttons | Essentials: no terminal, no process trace | Everything |
| Permission mode | Ask, set once | Left as it is |

Settings, Appearance, Workspace holds where the app opens and the panel's
first surface. Settings, Appearance, Buttons shows or hides each optional
button. On a computer, right-click a button for Hide this button.

## Language and appearance

1. Open Settings, Appearance.
2. At the top, pick the language: System, English or Français. System follows
   your operating system, and any other language falls back to English.
3. Pick the theme: System, Dark or Light. The same page has the Text font,
   the Code font, the Interface size and the Chat width.

The language is saved on this device only, and changes everywhere at once,
with no reload. Dates and numbers follow the language, in your machine's
region. App update errors stay in English.

## Connect an AI

Boite runs an agent you already pay for. An agent already signed in on this
computer is picked up on its own.

1. With nothing connected, the model chip under the message box reads Connect
   an AI. Press it.
2. Pick your agent. Claude and Codex come first; the rest are under Other
   agents.
3. When Boite can download the agent, press Install followed by its name. It
   says the download size first. Otherwise, press Open the installer page,
   run the installer and press Check again.
4. Sign in on the page your browser opens. If Boite shows a code, enter it on
   that page. If the page gives you a code, paste it in Boite.
5. Press Use followed by the agent's name. The text you were typing stays.

On a phone the chip reads No AI connected: connect the agent from the
computer that runs Boite. [Supported agents](supported-agents.md) lists every
agent and [accounts](accounts.md) covers several accounts.

## Open a project

A project is the folder an agent works in.

- On a computer, press Add a project in the sidebar, or open the project menu
  at the top of a new conversation and choose Open a folder.
- Under the message box, Work in a folder of mine opens the same folder
  dialog.
- On a phone, add a project from the project picker.

## Send your first message

1. Start a new conversation. It opens in your last project or in Drafts,
   depending on your preset.
2. Pick the agent and model under the message box.
3. Type what you want and press Send.

A conversation started in Drafts gets its own folder in `Documents/Boite`,
named after the day and the first words of its title, for example
`2026-09-23 Plan the trip to Lisbon`. What the agent writes stays there. The
folder keeps its name when the title changes later. Drafts is not a Git
repository, so the worktree switch does not show there.

On Windows, Boite follows your Documents folder when OneDrive or you moved it.
On Linux it uses the documents folder your desktop configured.

### Incognito

To leave nothing behind, turn on Incognito at the right of a draft's header
before the first send. Leaving the conversation erases it and its folder. What
the agent's own program writes outside that folder, such as its session files
in your home folder, stays.

## Going further

- [Install](install.md): downloads and system requirements.
- [Accounts](accounts.md): sign-ins and several accounts per agent.
- [Conversations](conversations.md), [models](models.md) and
  [permissions](permissions.md): working in a conversation.
- [Voice](voice.md): dictation.
- [Phone](phone.md): pairing a phone.
- Technical reference: [the tour](internals/onboarding.md),
  [language](internals/language.md), [drafts](internals/drafts.md).
