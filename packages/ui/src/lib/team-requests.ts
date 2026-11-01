import type { TeamAsk } from '@boite/contracts';
import { fill, strings } from './strings';

/** The team a bot's card is about: the one it proposes, or the one it names. */
export function teamOfAsk(team: TeamAsk): string {
  return team.kind === 'create' ? team.name : team.teamName;
}

/** What a bot's team card asks, as its dock row and its own heading name it. */
export function teamHeading(team: TeamAsk): string {
  return fill(strings.teamRequest.headings[team.kind], { team: teamOfAsk(team) });
}
