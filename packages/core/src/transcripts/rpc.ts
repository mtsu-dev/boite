import { transcriptPolicyValid } from '@boite/contracts';
import type { Core } from '../core.ts';
import { refused } from '../errors.ts';

export function registerTranscriptMethods(core: Core): void {
  core.router.register('transcripts.preview', params => {
    if (!transcriptPolicyValid(params?.policy)) throw refused('policy must give idleCompactDays, deletedCompactDays, deletedEraseDays and imagesEraseDays, each null or a whole number of days', { field: 'policy' });
    return core.transcripts.preview(params.policy);
  });
  core.router.register('transcripts.progress', () => core.transcripts.progress());
  core.router.register('transcripts.compactUnlinked', params => {
    if (!Number.isInteger(params?.days) || params.days < 0) throw refused('days must be a whole number of days, 0 or more', { field: 'days' });
    return core.transcripts.compactUnlinked(params.days);
  });
  core.router.register('transcripts.list', params => core.transcripts.list(params ?? {}));
  core.router.register('transcripts.failures', params => core.transcripts.failures(params ?? {}));
  core.router.register('transcripts.read', params => {
    if (typeof params?.conversation !== 'string' || params.conversation.length === 0) throw refused('conversation must be the id of an archived conversation; transcripts.list gives them', { field: 'conversation' });
    return core.transcripts.read(params);
  });
}
