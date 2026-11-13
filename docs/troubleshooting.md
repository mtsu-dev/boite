# Troubleshooting

When something goes wrong, Boite keeps a log of its own problems on each
machine. This page shows where to read it, how to send an anonymized report,
and the known problems of each system.

## Read the log

Open Settings, Troubleshooting. Each machine keeps its own log. The page works
on the desktop and on a phone connected as the owner.

- Status: the Boite version and channel, the system, how long the core has
  run, the records of the last 24 hours and the log files with their sizes.
- Problems: warnings and errors of the last 24 hours, grouped by kind, errors
  first. Open a row to see its latest message and the threads it touched.
- Log: the records, newest at the bottom. Filter by Level, Source, Thread,
  text and Period. New records appear while the page is open. Load older goes
  further back.

The files themselves are in the `logs` folder of Boite's data folder, on the
machine that runs the agents. On Linux that is `~/.local/share/boite2/logs`,
or under `$XDG_DATA_HOME/boite2` when you set that variable.

If the page says Boite on a machine is older than these diagnostics, its log
still shows, but update that machine for the status, the export and the
report ([updates](updates.md)).

## Export a report

1. In Settings, Troubleshooting, Status, press Export anonymized logs.
2. The file holds the last 24 hours: environment, grouped problems, threads
   and the timeline.

The desktop app saves a copy in Downloads. A phone offers its share sheet
when it can, and a browser downloads the file. The machine that runs Boite
also keeps its ten newest exports in `logs/exports`.

An export is anonymized: project paths and names, your user and machine
names, emails and private addresses become placeholders. Thread ids stay, so
a developer can follow one conversation. A project keeps the same placeholder
across exports of one machine.

## Report a problem

1. In Settings, Troubleshooting, Problems, press Report a problem.
2. Fill the Title and What happened: what you did, what you expected and what
   you saw.
3. Leave Include anonymized logs on, or turn it off.
4. Read the Preview: it is the exact text of the issue.
5. Press Create the issue.

When the GitHub CLI is signed in on the machine that runs Boite, the issue is
created on the Boite repository and its link shows. Otherwise the issue opens
in your browser, and the page names the export file to drag into it.

Agents can read anonymized logs is on by default. An agent can then check
whether Boite itself failed and draft an issue about it. It reads the
anonymized view only, and only records about its own conversation and the
ones it started. Turn the switch off on the same page to stop it.

## Common problems on macOS

- Boite refuses to open the first time: the build is signed ad hoc. Allow it
  in System Settings, Privacy & Security, or run once
  `xattr -cr /Applications/Boite.app`.
- No desktop notification when a conversation finishes out of sight: native
  notifications are not available on macOS yet.

## Common problems on Linux

- The package does not start: Boite needs glibc 2.35 or newer (Ubuntu 22.04
  or later) and WebKitGTK 4.1.
- An AppImage does not start: install FUSE 2 (`libfuse2`) and make the file
  executable.
- An empty window on the NVIDIA proprietary driver: Boite already sets
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` for you. A value you set yourself wins.
- No built-in browser in the side panel: the Linux app offers your system
  browser instead.
- Dictation says it is unavailable: the Linux app cannot use the microphone.
  Open Boite in a browser connected to the same machine to dictate.
- No desktop notification when a conversation finishes out of sight: native
  notifications are not available on Linux yet.

## Common problems on every system

- An agent is not found: at startup Boite looks in the usual installation
  folders, but does not read your shell configuration or every Node version
  manager. An agent that only exists in an interactive shell may stay
  missing.
- On macOS and Linux, a process that leaves its group can outlive its
  conversation, and a hard crash of the app can leave its core running.
- The CPU cap, focus protection and audio muting work on Windows only. The
  memory guard works everywhere.

## Going further

- [Install](install.md): system requirements per platform.
- [Updates](updates.md): getting a fixed version.
- [Privacy](privacy.md): what leaves your machine, reports included.
- [Task manager](task-manager.md): processes and resources per machine.
- Technical reference: [diagnostics](internals/diagnostics.md),
  [platform readiness](internals/portability.md).
