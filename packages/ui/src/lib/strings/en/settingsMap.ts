export const strings = {
  /** The nine pages of Settings (lib/settings-tabs.ts), one per question a person asks. */
  settingsMap: {
    pages: {
      appearance: 'Appearance',
      input: 'Input',
      conversations: 'Conversations',
      ai: 'AI accounts',
      agents: 'Agents',
      safeguards: 'Safeguards',
      devices: 'Devices',
      version: 'Version',
      help: 'Troubleshooting'
    },
    /** Behind the "i" beside a page's title: what the page answers. */
    about: {
      appearance: 'What Boite looks like.',
      input: 'How you talk to Boite: the keyboard and your voice.',
      conversations: 'How threads are listed and how agents answer.',
      ai: 'Which AIs you use, and how much is left.',
      agents: 'What agents know and how they run.',
      safeguards: 'What agents are allowed to do.',
      devices: 'Which devices connect to which machines.',
      version: 'Stable or ahead.',
      help: 'What is wrong, and what to send when you ask for help.'
    },
    /** The line under a page's title: where most of its cards apply. */
    scope: {
      device: 'This device',
      machine: 'This machine: {machine}',
      group: 'All your machines'
    },
    thisDevice: 'This device',
    tour: 'Getting started',
    tourHint: 'The tour of the first launch, again',
    /** Words the search also answers to, by card. Never shown. */
    keywords: {
      theme: 'dark light colors palette mode',
      buttons: 'toolbar hide show customize',
      details: 'cursor scrollbar',
      keyboard: 'shortcuts hotkeys keybindings',
      voice: 'dictation microphone speech whisper',
      notifications: 'alerts sound push',
      'agent-replies': 'questions answers titles checklist',
      archived: 'archive deleted restore retention history',
      worktrees: 'git branches folders',
      providers: 'sign in login account model claude codex subscription',
      'local-acp': 'custom agent command',
      secrets: 'api keys tokens passwords',
      quotas: 'quota limits remaining alerts',
      'limit-resume': 'resume continue quota',
      'subscription-proxy': 'gateway proxy',
      usage: 'tokens cost spend report',
      brain: 'instructions skills memory rules',
      hooks: 'scripts',
      plugins: 'extensions add-ons',
      'agents-alone': 'mochis bots coordination reach permission',
      'auto-compact': 'compaction context tokens summary',
      execution: 'warm process idle',
      quiet: 'focus mute audio windows',
      windows: 'screen capture allow',
      'window-exclusions': 'screen capture block never',
      limits: 'cpu memory ram cap',
      'browser-profiles': 'cookies sign-ins user-agent',
      privacy: 'telemetry analytics data',
      policy: 'admin managed locked',
      'main-machine': 'default first open',
      app: 'start at login autostart tray background gpu',
      group: 'pair invite join',
      machines: 'computers servers rename remove',
      phone: 'mobile tailscale https network lan remote outside',
      origins: 'cors allowed origins browser',
      updates: 'update release nightly channel stable',
      'agent-updates': 'cli versions',
      experiments: 'beta unfinished features',
      'diagnostics-status': 'health export logs',
      'diagnostics-problems': 'issue bug report',
      'diagnostics-log': 'logs errors',
      'diagnostics-agents': 'logs access',
      tasks: 'orphans processes kill',
      'task-manager': 'processes kill stop',
      core: 'version port pid data folder endpoint',
      tour: 'onboarding tutorial welcome'
    }
  }
};
