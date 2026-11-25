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
