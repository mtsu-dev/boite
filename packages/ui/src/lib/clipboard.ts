/** Copies a selection when the Clipboard API is unavailable, including on Safari over HTTP. */
export function copyByCommand(text: string, within?: HTMLElement): boolean {
  const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement('textarea');
  field.className = 'clipboard-copy-field';
  field.value = text;
  // The field can be selected without opening the phone's keyboard.
  field.readOnly = true;
  field.setAttribute('aria-hidden', 'true');
  const target = within ?? before?.closest('dialog[open]') ?? document.body;
  target.append(field);
  try {
    field.focus({ preventScroll: true });
    field.setSelectionRange(0, text.length);
    return document.execCommand?.('copy') ?? false;
  } catch {
    return false;
  } finally {
    field.remove();
    before?.focus({ preventScroll: true });
  }
}

/**
 * Copies `text`. A page served over plain HTTP has no clipboard API: the field
 * holding it is selected and copied the older way, and stays selected to copy
 * by hand. True once something reached the clipboard.
 */
export async function copyText(text: string, field?: HTMLInputElement | HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    field?.focus();
    field?.select();
    return !!field && !!document.execCommand?.('copy');
  }
}
