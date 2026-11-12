# Secrets

Secret Drop lets an agent ask you for a key, a token or a password without
the value ever appearing in the chat or reaching the agent. You type it on a
masked card, and Boite hands it to one file or one command.

## Give an agent a key

1. The agent asks for a secret by name, with the reason it needs it. A card
   appears above the message box: Secret requested by the agent.
2. Type or paste the value in the field. It is Never shown to the agent.
3. Press Send, or Decline to refuse.
4. The conversation shows a receipt, such as "API_KEY sent for one use". The
   value itself never enters the history.

The card waits ten minutes by default, up to an hour when the agent asks for
longer. Stop, the end of the turn or the timeout close an unanswered card.

## Where the value goes

The agent can use the value once, in one of three ways:

- as an environment variable for one command;
- on the standard input of one command;
- written as `NAME=value` in an env file inside the conversation's folder.
  The file must be untracked by git and ignored, unless the agent asks
  otherwise. Other lines of the file stay as they were.

Command output comes back with the value masked.

## How long it lasts

Boite keeps the value in memory only, never on disk, in the system's
password vault or in the logs. It erases it at the first of these:

- its first use, even if that use fails;
- 10 minutes after you send it;
- the end of the turn that asked for it;
- archiving or removing the conversation, or removing its project;
- Boite stopping or restarting.

Each request opens a new card: an agent that needs the key again asks again.

## No project secrets

Boite keeps nothing for the project. There is no key store and no option to
keep a value. Keys kept by an earlier version of Boite are erased when Boite
starts, without being read.

## From a phone or another device

A paired phone or browser can answer the card. The value travels only over
the local machine, Tailscale or HTTPS. A phone on plain HTTP can decline but
cannot send a value: answer from the PC or over HTTPS.

## What masking does not cover

Boite replaces the value with `•••• (NAME)` in the conversation's text,
reasoning, tool output, terminal, logs and diagnostic exports, as long as
Boite runs. Masking works only inside Boite, and it has gaps:

- A value shorter than eight bytes is not masked.
- A value split across two chunks of streamed output can show while it
  streams, or when an output limit cuts it.
- The command that receives the value is not sandboxed. It can print it,
  store it or send it elsewhere.
- An agent can read a file the secret was written to. That value then reaches
  the agent's model provider.
- Boite does not erase the env file it wrote to. Delete it yourself when you
  no longer need it.
- Memory-only storage does not protect against swap, crash dumps or a
  compromised machine.

## Going further

- [Permissions](permissions.md): what the agent may do without asking.
- [Phone](phone.md): pair a phone and open Boite over HTTPS.
- [Privacy](privacy.md): what leaves your machine.
- Technical reference: [secrets](internals/secrets.md).
