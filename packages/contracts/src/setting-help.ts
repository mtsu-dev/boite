/**
 * What each setting does, as its Settings page explains it in English
 * (`settingHelp` in packages/ui/src/lib/setting-requests.ts), for
 * `boite state settings`. Every core setting an agent reads has an entry; an
 * experiment its page explains only by its name has none. Written by
 * packages/ui/src/lib/setting-help.test.ts with UPDATE_SETTING_HELP=1, which
 * fails when this copy and the app part.
 */
export const SETTING_HELP: Readonly<Record<string, string>> = {
  "asyncQuestions": "Agents keep working while their question waits for you.",
  "shortAnswers": "Agents work quietly and reply with the result in a few sentences. Asks every agent, on every message, to work silently and write only when done or when it needs you: the result first in a few plain sentences, without preamble or recap. Facts, numbers and commands stay. Also turns off Claude's own progress reminder when a Claude process starts.",
  "toolSummaries": "Each batch of tool calls gets a one-line label instead of a count. Claude labels each batch of tool calls in one line instead of counting them. Each label is one request to its small model, Haiku, billed to the thread's account. Applies when a Claude process starts.",
  "titleModel": "Names a thread after its first answer. Automatic uses the thread's own agent on its small model.",
  "autoGoals": "A long prompt starts a reviewed goal on itself, with its checklist and a card on the project board. Remove the goal from the goal bar to drop it. Applies to this machine. Not ready for everyday use.",
  "threadDoneRetentionDays": "Counted from Mark done, an automatic archive after a PR merge or a plugin's archive. 3 days by default; 0 disables deletion. Manual archives are kept. Deleted conversations remain recoverable for the configured deletion retention.",
  "threadDeletionRetentionDays": "Counted from deletion. 0 keeps conversations indefinitely. Shortening the delay also applies to conversations already deleted.",
  "transcriptStorage": "What this machine keeps of a conversation as it ages. Delete: a deleted conversation is compacted at once and erased after 7 days. Classic: a deleted conversation is compacted after 7 days and kept for audits, its images erased after 30 days. Storage: everything stays, compacted after 30 days without activity. Custom sets each delay. A compacted conversation keeps every message, the reasoning, every tool call and every error; long tool outputs are shortened. Usage and costs are kept in every mode.",
  "worktreeStorage": "In each project: Inside each project, under .boite/worktrees. One shared folder: Each project gets its own subfolder. Projects with the same name stay separate. New worktrees only. Existing ones stay where they are.",
  "focusGuard": "A window an agent opens stays behind the one you are using.",
  "muteAgents": "Sounds agents play stay silent.",
  "agentCpuCapPercent": "For all agents together. 0 means no cap. Windows only.",
  "agentMemoryBudgetPercent": "For all agents together, from 10 to 90%. The default is 60%.",
  "threadMemoryCapMb": "For one conversation and its processes. 0 takes half the agents' budget, which it cannot exceed.",
  "memoryReserveMb": "Kept free for your other apps. 0 uses 10% of RAM, at least 3072 MB. Below 12288 MB of RAM, it uses 25%.",
  "memoryProtection": "Over a memory limit, the largest process tree an agent started is stopped. Over a limit, Boite stops the largest process tree an agent started, never the agent itself. Off also lifts the Windows memory caps.",
  "reapOrphans": "A process an agent leaves behind stops ten seconds after the turn. Ten seconds after a turn, a process whose parent has exited is stopped. Windows only.",
  "autoUpdateHarnesses": "Agents update themselves, even with nobody connected. An agent updates with nobody connected: a running thread pauses after its tool call and goes on once the update is done.",
  "autoInstallUpdates": "Updates install while Boite waits in the tray with nothing running. A release found by the check every six hours downloads and installs with no question, only while the window is in the tray and no conversation, queued message or process runs. Boite comes back in the tray. Otherwise it tries again at the next check. Agents keep their own switch on the Providers page.",
  "listenOnLan": "A phone on the same network can reach this computer. Lets a phone on the same network reach this computer, from the next start of Boite. A --host or --lan flag wins over it.",
  "publicUrl": "The HTTPS origin of your reverse proxy, which must forward the page and /rpc to this core. Links to add a device use it.",
  "browserOrigins": "Machines of the group, and the addresses they are served at, are allowed on their own. Add here only a page served by something outside the group. One exact http(s) origin per line.",
  "warmProcessMinutes": "How long an agent stays loaded after a turn. 0 stops it right away.",
  "autoCompact": "Conversations compact at your own token limit and at the idle moments you pick. Set an independent token limit and choose idle moments for compaction. Each compaction counts as usage.",
  "compactionByType": "Each type inherits the common settings until customized. Customizing copies the common compaction policy. Turn this off to restore inheritance.",
  "compactionSummary": "Applies to Claude compaction for this scope. Leave empty for the native prompt. Explicit /compact instructions take precedence.",
  "autoResumeLimitedThreads": "A thread stopped by a usage limit resumes once the limit resets. A thread stopped by a subscription usage limit resumes by itself a minute after the limit resets, once per limit window. Stop, a new message or a changed model cancels it.",
  "cacheKeepalive": "A conversation waiting on its agents pings them so its cached prompt stays cheap. While a conversation waits on its agents or workflows, Boite sends a one-word turn shortly before the provider drops its cached prompt, so their result is read at the cached price. Each ping counts as usage. A ping that misses the cache ends the pings.",
  "backgroundCompaction": "Automatic compactions run on a copy of the conversation while the agent keeps working, and the thread moves to it when it is ready. Applies to this machine. Not ready for everyday use.",
  "deviceStream": "The Device panel plays an Android phone plugged into this machine as live video through scrcpy, and sends touches, keys, text and the clipboard through it. Applies to this machine. Not ready for everyday use.",
  "groupThreads": "Agents on the other machines of the group may start threads on this machine, in its projects, on their own agent (boite thread new --machine), and add its folders as projects (boite projects add --machine). Off by default.",
  "groupBots": "A mochi of another machine of the group may look after the projects of this machine its owner entrusted to it: list, read and steer their threads and answer their questions. Never tool permissions, deleting threads or this machine's settings. Turning it off cuts them off at once. Off by default.",
  "agentBotCreation": "Create mochis without asking: A mochi created this way has full access to this machine.",
  "coordinationReach": "This project: An agent lists, reads and writes to the conversations of its own project only. This machine: An agent lists, reads and writes to the conversations of every project on this machine. All my machines: An agent lists, reads and writes to the conversations of every project, here and on the machines you trust.",
  "contacts": "A Home page beside Threads where you link your Boite with another owner's through Tailscale. A built-in mochi, the Operator, carries every request between your agents and theirs. Applies to this machine. Not ready for everyday use.",
  "experiment.draft-backdrop": "An animated scene in the manner of an early 2000s console behind the empty new thread screen. Pick it under Appearance. Respects reduced motion.",
  "experiment.contacts": "A Home page beside Threads where you link your Boite with another owner's through Tailscale. A built-in mochi, the Operator, carries every request between your agents and theirs. Applies to this machine. Not ready for everyday use.",
  "experiment.teams": "Mochis that work together in a shared chat, listed above them on the Mochis page: a post wakes the mochis it names, and each answers in the group or privately. Your mochis post with boite team. Not ready for everyday use.",
  "experiment.auto-goal": "A long prompt starts a reviewed goal on itself, with its checklist and a card on the project board. Remove the goal from the goal bar to drop it. Applies to this machine. Not ready for everyday use.",
  "experiment.session-import": "Open a Claude Code or Codex session started outside Boite as a thread, from the command palette. Not ready for everyday use.",
  "experiment.background-compaction": "Automatic compactions run on a copy of the conversation while the agent keeps working, and the thread moves to it when it is ready. Applies to this machine. Not ready for everyday use.",
  "experiment.device-stream": "The Device panel plays an Android phone plugged into this machine as live video through scrcpy, and sends touches, keys, text and the clipboard through it. Applies to this machine. Not ready for everyday use.",
};
