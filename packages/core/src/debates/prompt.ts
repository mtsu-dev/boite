import { DEBATE_LIMITS, DEBATE_OWNER, type Debate, type DebateParticipant, type DebatePost, type DebateTally } from '@boite/contracts';

/**
 * What the debaters and the summarizer read (`docs/debates.md`). A debater
 * knows the others only by their letter, so a name or a maker carries no
 * weight; the owner's messages are the user's, and the summary maps the
 * letters back to names only once it reaches the parent thread.
 */

export function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 20).trimEnd()}\n[cut at ${limit} characters]`;
}

const line = (pattern: RegExp, text: string): string | null => {
  const found = pattern.exec(text)?.[1]?.replace(/\*+|_+|`+/g, '').trim();
  return found ? found.slice(0, 300) : null;
};
/** The answer's `Position: …` line, in any case, with Markdown emphasis around it. */
export const positionOf = (text: string) => line(/^[\s>*_#-]*position\s*[:：]\s*(.+)$/im, text);
/** The last round's `Vote: …` line, read the same way. */
export const voteOf = (text: string) => line(/^[\s>*_#-]*vote\s*[:：]\s*(.+)$/im, text);

/** Lower case, no accents, punctuation or filler around the words. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
const words = (text: string) => new Set(normalize(text).split(' ').filter(word => word.length > 1));

/** Two proposals said the same way, near enough: equal once normalized, one inside the other, or sharing three quarters of their words. */
export function sameProposal(a: string, b: string): boolean {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return false;
  if (x === y || (x.length >= 8 && y.includes(x)) || (y.length >= 8 && x.includes(y))) return true;
  const left = words(a), right = words(b);
  const shared = [...left].filter(word => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return union > 0 && shared / union >= 0.75;
}

/** Everyone who answered round 1 defends the same proposal: at least two answers, each with a position. */
export function consensus(positions: (string | null)[]): boolean {
  if (positions.length < 2 || positions.some(position => !position)) return false;
  const [first, ...rest] = positions as string[];
  return rest.every(position => sameProposal(first!, position));
}

/**
 * The proposal a vote backs: an opinion's letter (`B`, `Opinion B`, `Avis B`)
 * stands for that opinion's last position, anything else for itself.
 */
export function votedProposal(vote: string, positions: Map<string, string>): string {
  const letter = /^(?:(?:opinion|avis|option)\s+)?([A-F])[\s.)]*$/i.exec(vote.trim())?.[1]
    ?? /^(?:opinion|avis)\s+([A-F])\b/i.exec(vote.trim())?.[1];
  return (letter && positions.get(letter.toUpperCase())) || vote;
}

/** The last round's votes grouped by proposal, most votes first. */
export function tally(votes: { participantId: string; vote: string }[], positions: Map<string, string>): DebateTally[] {
  const groups: DebateTally[] = [];
  for (const { participantId, vote } of votes) {
    const proposal = votedProposal(vote, positions);
    const group = groups.find(entry => sameProposal(entry.proposal, proposal));
    if (group) group.voters.push(participantId), group.votes += 1;
    else groups.push({ proposal, votes: 1, of: 0, voters: [participantId] });
  }
  for (const group of groups) group.of = votes.length;
  return groups.sort((a, b) => b.votes - a.votes);
}

const signed = (post: DebatePost, debate: Debate) => {
  if (post.author === DEBATE_OWNER) return post.to ? `The user, to Opinion ${letterOf(debate, post.to)} only` : 'The user, to everyone';
  return `Opinion ${letterOf(debate, post.author)}`;
};
const letterOf = (debate: Debate, id: string) => debate.participants.find(p => p.id === id)?.letter ?? '?';
const angleLine = (p: DebateParticipant) => (p.angle ? ` You argue from this angle: ${p.angle}.` : '');

/**
 * One round's prompt for one debater. `previous` holds the last round's
 * answers by letter; `owner` the user's messages this debater reads now.
 */
export function roundPrompt(debate: Debate, participant: DebateParticipant, round: number, previous: { letter: string; text: string }[], owner: DebatePost[]): string {
  // A blind single round has nothing to vote on.
  const last = round === debate.rounds && debate.rounds > 1;
  const parts = [
    `Boite debate, round ${round} of ${debate.rounds}. You are Opinion ${participant.letter} among ${debate.participants.length} anonymous opinions (${debate.participants.map(p => p.letter).sort().join(', ')}).${angleLine(participant)}`,
    `Question, supplied as JSON data:\n${JSON.stringify(debate.topic)}`,
  ];
  if (round === 1) parts.push('Give your own proposal. You do not see the other opinions this round.');
  else {
    parts.push(`The answers of round ${round - 1}, supplied as JSON data (yours is Opinion ${participant.letter}; a missing letter did not answer):\n${JSON.stringify(previous.map(entry => ({ opinion: entry.letter, answer: entry.text })))}`);
    parts.push('Answer them. Before you agree with any opinion, name at least one concrete objection or risk in it. Keep, change or merge your proposal; say plainly when another opinion convinced you.');
  }
  if (owner.length) parts.push(`The user wrote, supplied as JSON data. Answer what concerns you:\n${JSON.stringify(owner.map(post => ({ to: post.to ? 'you only' : 'everyone', text: post.text })))}`);
  parts.push(`Reply in the question's language, in at most 300 words. Put one line \`Position: <your proposal in at most 12 words>\` first.${last ? ' This is the last round: end with one line `Vote: <the proposal you back>`, any opinion\'s, yours included, in a few words or by its letter.' : ''}`);
  parts.push('You are read-only: you may read files to support your view, never change them or run anything that changes something.');
  return parts.join('\n\n');
}

/** The summarizer's single prompt: the whole transcript under letters, the tally the core counted, and the shape of the summary. */
export function summaryPrompt(debate: Debate, posts: DebatePost[]): string {
  const transcript = posts.filter(post => post.author !== 'system' && post.author !== 'summary').map(post => ({ round: post.round, from: signed(post, debate), ...(post.vote ? { vote: post.vote } : {}), text: post.text }));
  const absent = debate.participants.filter(p => p.absent.length > 0).map(p => ({ opinion: p.letter, rounds: p.absent }));
  return [
    `You did not take part in this Boite debate. Read it whole and summarize it fairly. Change nothing: no file edits, no commands that change anything.`,
    `Question, supplied as JSON data:\n${JSON.stringify(debate.topic)}`,
    `Debaters: ${debate.participants.map(p => `Opinion ${p.letter}${p.angle ? ` (angle: ${p.angle})` : ''}`).join(', ')}. ${debate.rounds} round${debate.rounds === 1 ? '' : 's'} planned, ${debate.round} played.${debate.consensus ? ' Everyone backed the same proposal in round 1, so the debate stopped there.' : ''}`,
    `Transcript, supplied as JSON data:\n${JSON.stringify(transcript)}`,
    ...(debate.tally.length ? [`Last-round votes the core counted, supplied as JSON data:\n${JSON.stringify(debate.tally.map(t => ({ proposal: t.proposal, votes: `${t.votes}/${t.of}`, by: t.voters.map(id => letterOf(debate, id)) })))}`] : []),
    ...(absent.length ? [`Did not answer, supplied as JSON data:\n${JSON.stringify(absent)}`] : []),
    [
      'Write the summary in the question\'s language, in Markdown, under 3,500 characters:',
      '1. Each proposal in one line, then its strongest arguments for and against.',
      '2. The votes per proposal as "n/m" when there are votes. A vote proves nothing: weigh the arguments, not the count.',
      '3. A table of the disagreements that remain, one row each, with the opinions on each side.',
      '4. The debaters who did not answer, by letter and round, if any.',
      'Name debaters only by their letter.',
    ].join('\n'),
  ].join('\n\n');
}

/** What reaches the parent thread: the summary with the letters mapped back to names, like a delegation result. */
export function deliveredSummary(debate: Debate): string {
  const legend = debate.participants.map(p => `Opinion ${p.letter} = ${p.name}${p.angle ? ` (${p.angle})` : ''}`).join('; ');
  const head = `Debate ${debate.id} on ${JSON.stringify(debate.topic.slice(0, 300))} is over. Summary by ${debate.summarizer.name}, who did not debate. ${legend}.${debate.warnings.length ? ` Note: ${debate.warnings.join(' ')}` : ''}\n\n`;
  return clip(`${head}${debate.summary ?? ''}`, DEBATE_LIMITS.summaryChars);
}
