import { tick } from 'svelte';
import { Closing } from './closing.svelte';

export class AnchoredPopover extends Closing {
  constructor(
    private root: () => HTMLElement | undefined,
    private trigger: () => HTMLElement | undefined
  ) {
    super();
  }

  close = (restoreFocus = true): void => {
    this.hide();
    if (restoreFocus) this.trigger()?.focus({ preventScroll: true });
  };

  outside = (event: PointerEvent): void => {
    if (this.open && event.target instanceof Node && !this.root()?.contains(event.target)) this.hide();
  };

  /** Hand focus to the frame on a phone, so opening a list cannot summon a keyboard. */
  async focusOnOpen(surface: () => HTMLElement | undefined, target: (sheet: boolean) => HTMLElement | undefined): Promise<void> {
    await tick();
    if (!this.open) return;
    const frame = surface();
    const sheet = !!frame?.dataset.mobileSheet;
    const preferred = target(sheet);
    (sheet ? frame : preferred ?? frame)?.focus({ preventScroll: true });
  }
}
