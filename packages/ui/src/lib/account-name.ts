import type { Account } from '@boite/contracts';

/**
 * The name an account reads under in a menu. The core labels the CLI login it
 * adopted "Default" (`packages/core/src/accounts.ts`), which names no one: the
 * address the provider reported for it says whose login runs the turn.
 */
export function accountName(account: Pick<Account, 'label' | 'identity'>): string {
  return account.label === 'Default' && account.identity ? account.identity : account.label;
}
