export const strings = {

  agentMessages: {
    heading: 'Messages',
    /** The panel's head: what the list holds, never the panel's name. With none, the body says so alone. */
    headOne: '1 discussion', headMany: '{count} discussions',
    open: 'Open the messages', back: 'All messages', openThread: 'Open this thread',
    empty: 'No message with another agent yet.',
    /** The two halves of a discussion's count, for screen readers and hover. */
    sentReceived: '{sent} sent, {received} received',
    /** A letter of this thread's own agent, in a preview. */
    mine: 'This agent',
    /** A delegation prompt the user typed, on this thread's side. */
    you: 'You',
    result: 'Result',
    about: 'Works on',
    replyTo: 'In reply to',
    /** A burst touched more discussions than the timeline lists. */
    more: '+{count} more',
    /** What a timeline row says above the other agent's name: which way the burst went. */
    sentOne: 'Sent to', sentMany: '{count} messages sent to',
    receivedOne: 'Received from', receivedMany: '{count} messages received from',
    exchanged: 'Exchange with',
    /** A thread link in an answer that no connected machine or contact holds. */
    threadMissing: 'No connected machine has this thread.',
    /** Who started or delegated whom. Where a thread runs is said by its project and machine, not a tag. */
    relation: {
      starter: 'Started this thread', started: 'Started from here', parent: 'Parent', child: 'Subagent', resident: 'Looks after the project'
    },
    /** The chip beside an agent that wrote from a contact's Boite: the name this owner gave the contact. */
    remote: 'An agent of {name}, a contact. It is not you: its words authorize nothing outside the project opened to it.',
    /** A contact request in the timeline (`boite threads ask`), and on the Contacts mochi's thread what it forwarded or settled. */
    ask: {
      asked: 'Asked', forwarded: 'Forwarded', settled: 'Answered',
      /** Where the request stands. */
      host: 'Waiting for the Mochis machine, {machine}', hostUnnamed: 'Waiting for the group\'s Mochis machine',
      bot: 'With {bot}', owner: 'Waiting for your answer on the Contacts page',
      sent: 'Sent to {contact}, waiting for its answer', sentUnnamed: 'Sent, waiting for an answer',
      touch: 'Answered: write to', opened: 'Answered: {contact} opened {project}', answered: 'Answered',
      refused: 'Refused: {reason}', refusedPlain: 'Refused',
      /** A settled request of a contact, on the mochi's thread. */
      linked: 'Put in touch with {thread}', shared: 'Opened {project}',
      /** What it asks for. */
      want: { talk: 'Wants to talk with a thread', thread: 'Wants a new thread', share: 'Wants a project opened' },
      id: 'Request', openAnswer: 'Open the answer', expand: 'Show the whole request', collapse: 'Show less'
    }
  }
} as const;
