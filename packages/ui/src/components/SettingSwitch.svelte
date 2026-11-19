<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  let attributes: Omit<HTMLInputAttributes, 'role' | 'type'> = $props();
</script>

<input {...attributes} type="checkbox" role="switch" />
