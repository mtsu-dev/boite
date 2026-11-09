/**
 * Where a composer chip's popover opens from (lib/floating.ts `anchor`): the
 * chip itself, unless the popover, opened up from it, would lie over the
 * answer buttons of a decision pending in the same card (Deny and Allow once,
 * Skip and Answer). Then it opens from the decision's card instead, above the
 * whole decision, so both answers stay in sight and in reach while it is open.
 * A phone opens these popovers as a sheet, which this does not move.
 *
 * The test reads the popover's whole content height, not its placed one: a
 * popover capped above the decision is shorter, and judging by that height
 * would send it back to the chip on the next placement.
 */
export function clearOfDecision(chip: HTMLElement | null | undefined, popover: HTMLElement | null | undefined, options: { align?: 'start' | 'end'; cap?: number } = {}): HTMLElement | null {
  if (!chip) return null;
  const decision = chip.closest('.composer')?.querySelector<HTMLElement>('.decision-card');
  if (!decision || !popover) return chip;
  const answers = [...decision.querySelectorAll<HTMLElement>('.decision-actions')].map((node) => node.getBoundingClientRect()).find((box) => box.width > 0 && box.height > 0);
  if (!answers) return chip;
  const from = chip.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = Math.min(popover.scrollHeight, options.cap ?? 360);
  const left = options.align === 'end' ? from.right - width : from.left;
  const top = from.top - 6 - height;
  const covers = left < answers.right && left + width > answers.left && top < answers.bottom && from.top > answers.top;
  return covers ? decision : chip;
}
