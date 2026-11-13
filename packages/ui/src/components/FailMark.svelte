<script lang="ts">
  /**
   * A failure's mark wherever a status slot shows one (rows, cards, Activity, the palette, the rail): a red disc with
   * a "!", so it never reads as the user's amber dot even without colour. The words live in the owner's tooltip.
   */
  let { size = 12 }: { size?: number } = $props();
</script>

<span class="fail" style:--fail={`${size}px`} aria-hidden="true"></span>

<style>
  .fail { box-sizing: border-box; display: inline-grid; place-items: center; flex: none; width: var(--fail); height: var(--fail); border-radius: var(--radius-full); background: var(--color-danger); }
  .fail::after { content: '!'; color: var(--color-on-danger); font-size: calc(var(--fail) * 0.75); font-weight: 800; line-height: 1; }
</style>
