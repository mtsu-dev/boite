<script lang="ts">
  import { providerLogoOf } from '../lib/provider-logos';

  /**
   * The provider's own mark in its own colours, or its initial in
   * `currentColor` when nothing is drawn for that id. The tile around it
   * carries the name.
   */
  let {
    providerId,
    size = 18,
    mono = false
  }: {
    providerId: string;
    size?: number;
    /**
     * The mark's shape in `currentColor` alone: a list's quiet rows draw it in
     * the muted tier, so only live rows keep the brand's hue. A mark on a tile
     * keeps its cut-out; a raster mark becomes its alpha in that colour.
     */
    mono?: boolean;
  } = $props();
  const uid = $props.id();

  let logo = $derived(providerLogoOf(providerId));
  let initial = $derived((providerId.trim()[0] ?? '?').toUpperCase());
</script>

{#if logo}
  <svg
    class="logo"
    width={size}
    height={size}
    viewBox={logo.viewBox}
    aria-hidden="true"
    focusable="false"
    data-logo={providerId}
    data-mono={mono || undefined}
  >
    {#if mono}
      {@const [, , width, height] = logo.viewBox.split(' ').map(Number)}
      <!-- The shape as a mask over one rect: a raster mark by its alpha, a tile with its paths cut out, bare paths as they are. -->
      <mask id="{uid}-mono" style:mask-type={logo.kind === 'image' ? 'alpha' : 'luminance'}>
        {#if logo.kind === 'image'}
          <image href={logo.href} width={logo.width} height={logo.height} />
        {:else}
          {#if logo.tile}<rect width={logo.tile.width} height={logo.tile.height} rx={logo.tile.rx} fill="white" />{/if}
          {#each logo.paths as path, index (index)}
            <path d={path.d} fill={logo.tile ? 'black' : 'white'} fill-rule={path.evenOdd ? 'evenodd' : undefined} />
          {/each}
        {/if}
      </mask>
      <rect class="mono" {width} {height} fill="currentColor" mask="url(#{uid}-mono)" />
    {:else if logo.kind === 'image'}
      <image href={logo.href} width={logo.width} height={logo.height} />
    {:else}
      {#if logo.tile}
        <rect width={logo.tile.width} height={logo.tile.height} rx={logo.tile.rx} fill={logo.tile.fill} />
      {/if}
      {#each logo.paths as path, index (index)}
        {#if typeof path.fill === 'string'}
          <path d={path.d} fill={path.fill} fill-rule={path.evenOdd ? 'evenodd' : undefined} />
        {:else}
          <!-- The theme decides between the two, in CSS, so a switch repaints
               the mark without touching the component. -->
          <path
            class="themed"
            d={path.d}
            fill-rule={path.evenOdd ? 'evenodd' : undefined}
            style:--fill-dark={path.fill.dark}
            style:--fill-light={path.fill.light}
          />
        {/if}
      {/each}
    {/if}
  </svg>
{:else}
  <span
    class="initial"
    aria-hidden="true"
    data-initial={providerId}
    data-mono={mono || undefined}
    style="width: {size}px; height: {size}px; font-size: {Math.round(size * 0.72)}px"
  >
    <span class="ui-label">{initial}</span>
  </span>
{/if}

<style>
  .logo {
    display: block;
    flex: none;
  }

  .themed {
    fill: var(--fill-dark);
  }

  :global(:root[data-theme='light']) .themed {
    fill: var(--fill-light);
  }

  .initial {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    font-weight: 600;
    line-height: 1;
  }
</style>
