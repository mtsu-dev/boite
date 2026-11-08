<script lang="ts">
  /**
   * The one title of the composer's phone sheets (model, effort, permission,
   * the "+"): under the shared grabber (app.css `[data-mobile-sheet]`), centred,
   * at the sheet's reading size. A desktop popover hangs off its chip, which
   * already names it: the title is a phone's only.
   */
  let { title }: { title: string } = $props();
</script>

<div class="sheet-head" aria-hidden="true">{title}</div>

<style>
  .sheet-head { display: none; }
  @media (max-width: 720px) {
    .sheet-head { display: block; flex: none; padding: 0 var(--space-4) var(--space-2); color: var(--color-foreground); font-size: var(--text-base); font-weight: 600; line-height: 1.35; text-align: center; }
  }
</style>
