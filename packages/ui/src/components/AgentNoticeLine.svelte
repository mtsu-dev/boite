<script lang="ts">
  import { TriangleAlert } from '@lucide/svelte';
  import type { AgentNotice } from '@boite/contracts';
  import { count } from '../lib/format';
  import { fill, strings } from '../lib/strings';
  import Notice from './Notice.svelte';

  /**
   * The agent warned that something it saves or reads went wrong, and its turn
   * went on: one line in the user's language that says what happened and what
   * it means, the agent's own report behind the "i".
   */
  let { notice, detail }: { notice: AgentNotice; detail: string } = $props();

  const t = $derived(strings.chat.notice);
  const line = $derived.by(() => {
    switch (notice.kind) {
      case 'writes_lost': {
        const cause = notice.cause === 'disk_full' ? t.diskFull : notice.cause === 'quota' ? t.diskQuota : t.writeFailed;
        return fill(notice.transcript ? t.writesLost : t.writesLostSettings, { cause });
      }
      case 'attachments_missing':
        return fill(t.attachmentsMissing, { missing: count(notice.missing), sent: count(notice.sent) });
      case 'instructions_large':
        return fill(notice.files === 1 ? t.instructionsLargeOne : t.instructionsLarge, { chars: count(notice.chars), limit: count(notice.limit) });
      case 'mirror_failed':
        return t.mirrorFailed;
    }
  });
</script>

<Notice icon={TriangleAlert} tone="caution" testid="notice-part" kind={notice.kind} detail={line} info={detail.trim() ? detail : undefined} />
