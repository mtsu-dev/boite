export const strings = {
  /** A card a bot draws to propose a team, a new member or its own leaving (`boite team propose|invite|leave`). */
  teamRequest: {
    headings: { create: 'Proposed team: {team}', invite: 'New member for {team}', leave: 'Leaving {team}' },
    apply: { create: 'Create the team', invite: 'Add to the team', leave: 'Remove from the team' },
    refuse: 'Refuse',
    guestHint: 'Only the computer running Boite can change teams.',
    applied: { create: 'Team created', invite: 'Member added', leave: 'Member removed' },
    refused: 'Refused',
    closed: 'Closed without an answer',
  }
} as const;
