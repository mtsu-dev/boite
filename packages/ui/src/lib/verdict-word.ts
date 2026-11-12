import { strings } from './strings';

/**
 * The verdict alone, "Allowed" or "Denied", as the receipt line of a decided
 * ask words it (`allowedReceipt`): a call that carries the decision shows it
 * beside its shield, so both read the same.
 */
export function verdictWord(decision: 'allow' | 'deny'): string {
  const receipt = decision === 'allow' ? strings.chat.allowedReceipt : strings.chat.deniedReceipt;
  return (receipt.split('{subject}')[0] ?? '').replace(/[\s:]+$/u, '');
}
