---
name: hello-threads
description: Find the conversations the user worked on last, to pick up where they left off.
---

# Recent conversations

When the user asks what they were working on, or refers to "the other
conversation" without naming it, run:

```sh
boite hello-threads
```

It prints the titles and ids of the five conversations that changed last,
newest first. Add `--json` to read `id`, `title` and `updatedAt` (milliseconds
since 1970) as JSON. Pass an id to `boite threads read <id>` to read one.
