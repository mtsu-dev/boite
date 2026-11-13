# Subagents

A subagent is a child conversation that your agent starts to take one part of
a task. It works on its own and its answer comes back to the conversation that
started it. Delegation is on in every conversation, with nothing to set up.

## Hand out work

1. Ask the agent to split the work, for example "have a second agent review
   the parser changes while you write the tests".
2. The agent starts each child itself. For each one it picks a model and a
   reasoning level, from any agent you have installed: a Claude conversation
   can start a Codex reviewer.
3. Your chat shows one "Started N subagents" row per launch, with the
   completed, failed and stopped counts and the elapsed time. Click it to see
   each child's model, task, status and result in the right panel.
4. When a child finishes, its final answer reaches the parent on its own.

Without a model choice, a child runs on the conversation's own agent, account,
model and reasoning level. It never inherits a fast speed tier unless the agent
asks for one. A child on another agent uses your account there: the default
signed-in one.

Every child is an ordinary Boite conversation, with its own permissions and
usage. It starts in the parent's project, folder and permission mode.

## Follow the children

- The Subagents tab lists the conversation's workflow runs, then its
  subagents, then the agents the provider started itself. Open it from the
  side panel, the title's menu or the palette's "Show the subagents".
- The button above the message box counts the active subagents and running
  workflows. Click it to open the overview.
- Click a child to open its conversation. Its header reads "parent title /
  child title"; the parent's title takes you back.
- In the sidebar, the parent's row carries a chip such as "2 sub-agents at
  work".

## When a child needs you

When a child asks a question or waits on a permission, the parent reads Needs
you. The parent shows the question, "Asked by" the child's title, with its
options and an Open button. A permission is approved in the child's
conversation only, so press Open. Text you type in the parent's message box is
a message to the parent, never an answer to the child.

## Steer a child

- Ask the main agent to send the child an instruction. Claude reads it at its
  next tool call; Codex, Muse Code, pi and Grok can take it while they work.
  Other agents get it on their next turn.
- Or open the child's conversation and write to it like any thread.
- A child whose background work ended without waking it reads Interrupted.
  Press Resume on its row to ask it to check how that work ended and finish.

## Model profiles

The gear in the Subagents tab opens its settings:

| Setting | What it does |
| --- | --- |
| Let this conversation start subagents | Turn it off to stop delegation in this conversation |
| Let the agent choose the model | On by default. Off, children use this conversation's model or the suggested models |
| Suggested models | Press Add a model to give a model and reasoning level a name, such as `reviewer`. The agent sees them by that name |
| Pause subagents | Holds the team until you press Resume subagents |

Stop all, in the tab's header, pauses the team and cancels the children that
run or wait to start. Stopping or archiving the parent does the same. The agent
can lift a pause it set itself; after your Stop it can resume only once you
write to it again, and it can never lift your Pause.

## Context modes

A child can start without part of your setup, for a small chore or a review
that must not know your house rules. Ask the agent for the mode you want.

| Mode | What the child gets |
| --- | --- |
| Full (default) | Everything: instruction files such as `AGENTS.md`, Boite and brain guides, MCP servers, hooks, every tool |
| Light | No instruction files, guides or MCP servers. Your hooks still run. Only the file and shell tools |
| Neutral | None of your instruction files, guides, MCP servers or hooks. Every tool |

A child can also get rules of its own, up to 4,000 characters, that come
before anything else it is told. A child with a mode shows a badge in its
header and on its row; its tooltip lists what was left out. Only Claude can
leave out instruction files, MCP servers, hooks or tools; other agents refuse
such a mode rather than start with them anyway.

## Their own worktree

Children share the parent's folder by default, so tell the agent which files
each one owns. A child can instead get its own Git worktree on a new branch.
When it ends with no commit and no change, Boite removes the worktree and its
branch. Otherwise both stay, and the result names the branch to merge. Boite
does not merge for you. Uncommitted edits in your folder are not in the
worktree.

## Limits

- One level only: a child cannot start subagents of its own.
- A brief is limited to 12,000 characters. The parent's conversation is not
  copied into the child.
- A child's answer returns capped at 4,000 characters; the rest stays readable
  by the agent. Tool output stays in the child's conversation.
- No limit on the number of children. Each conversation runs one turn at a
  time.
- A finished child is archived as done. It comes back when you or its parent
  write to it.
- Boite replaces the subagents built into Claude Code, Codex, OpenCode and
  Grok. Muse Code keeps its own. Agents a provider starts itself appear under
  "Started by the provider"; ask the main agent to steer or stop them.
- Agents launched from a shell appear under "Started from a command". On Linux
  and macOS, one launched inside another shell can be missing.
- A paired phone can follow the children and stop them.
- A mochi has its own Allow subagents switch, in its settings.
- A child can run on another machine of your group only while that machine's
  Threads from the other machines switch is on.

## Going further

- [Workflows](workflows.md): checked plans of many steps over child threads.
- [Council](council.md): several models review one request.
- [Coordination](coordination.md): conversations that message each other.
- [Permissions](permissions.md) and [Models](models.md).
- Technical reference: [delegation](internals/delegation.md),
  [context modes](internals/context-modes.md).
