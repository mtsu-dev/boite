/**
 * The eight tasks: what an agent is asked (`goal`, for the live mode), the
 * scripted run that does it through the CLI the way the help text teaches
 * (`script`, for the replay mode) and the server-side check of the result.
 */
import { invoiceAmount, invoiceId, SIGNIN, skuOf, type SiteState, type TaskId } from './site.ts';

/** A target named the way an agent reads it in a snapshot: its role and its label. */
export interface Target {
  role: string;
  name: string;
}

/** What a scripted run may do; every method is one or more real CLI calls. */
export interface Driver {
  /** `open <url>`, then `snapshot -i`. */
  open(path: string): Promise<void>;
  /** `click @eN`, the ref read from the last snapshot by label, then `snapshot -i`. */
  click(target: Target): Promise<void>;
  /** `fill @eN <text>`, then `snapshot -i`. */
  fill(target: Target, text: string): Promise<void>;
  /** `check @eN`, then `snapshot -i`. */
  check(target: Target): Promise<void>;
  /** `select @eN <value>`, then `snapshot -i`. */
  select(target: Target, value: string): Promise<void>;
  /** A full `snapshot`, which carries the page's text, returned to read a value. */
  read(): Promise<string>;
}

export interface Check {
  ok: boolean;
  detail: string;
}

export interface Task {
  id: TaskId;
  title: string;
  /** The page the task starts on. */
  path: string;
  /** The natural-language goal a live agent receives, with the start URL put in front. */
  goal: string;
  script(driver: Driver): Promise<void>;
  check(state: SiteState): Check;
}

const PAGE_TARGET = 47;
const SKU_TARGET = 217;
const VAT = 'FR12345678901';
const TODOS = ['Buy milk', 'Buy eggs', 'Buy bread'];

const button = (name: string): Target => ({ role: 'button', name });
const textbox = (name: string): Target => ({ role: 'textbox', name });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const digits = (text: string | null): string => (text ?? '').replace(/[^\d.]/g, '');

/** The amount on the line after the invoice's own id in a full snapshot. */
export function amountAfter(snapshot: string, id: string): string {
  const lines = snapshot.split('\n');
  const at = lines.findIndex((line) => line.includes(id));
  if (at === -1) throw new Error(`${id} is not in the snapshot`);
  for (const line of lines.slice(at, at + 8)) {
    const match = /\$\d[\d,]*\.\d\d/.exec(line);
    if (match) return match[0];
  }
  throw new Error(`no amount follows ${id} in the snapshot`);
}

export const TASKS: Task[] = [
  {
    id: 'signin',
    title: 'Sign-in form, a validation error, then success',
    path: '/signin',
    goal: `Sign in as ${SIGNIN.email}. The password is either "${SIGNIN.wrong}" or "${SIGNIN.password}": try "${SIGNIN.wrong}" first, and if it is refused use the other one. Stop once the page welcomes you.`,
    async script(d) {
      await d.open('/signin');
      await d.fill(textbox('Email'), SIGNIN.email);
      await d.fill(textbox('Password'), SIGNIN.wrong);
      await d.click(button('Sign in'));
      await d.fill(textbox('Email'), SIGNIN.email);
      await d.fill(textbox('Password'), SIGNIN.password);
      await d.click(button('Sign in'));
    },
    check: (s) => ({
      ok: s.signin.signedIn === SIGNIN.email && s.signin.failures >= 1,
      detail: `signedIn=${s.signin.signedIn ?? 'none'} failures=${s.signin.failures}`,
    }),
  },
  {
    id: 'search',
    title: 'Search, filter a result list, choose one',
    path: '/search',
    goal: 'In this shop, search for "lamp", narrow the results to the Desk category, then choose the brass desk lamp.',
    async script(d) {
      await d.open('/search');
      await d.fill({ role: 'searchbox', name: 'Search products' }, 'lamp');
      await d.click(button('Search'));
      await d.select({ role: 'combobox', name: 'Category' }, 'Desk');
      await d.click(button('Search'));
      await d.click(button('Choose Brass desk lamp'));
    },
    check: (s) => ({
      ok: s.search.chosen === 'brass-desk-lamp',
      detail: `chosen=${s.search.chosen ?? 'none'} searches=${s.search.searches}`,
    }),
  },
  {
    id: 'pages',
    title: 'Read a value on page 3 of a paginated table',
    path: '/invoices',
    goal: `Find the amount of invoice ${invoiceId(PAGE_TARGET)} in this invoice list, then submit that amount, exactly as shown, in the Answer field.`,
    async script(d) {
      await d.open('/invoices');
      await d.click({ role: 'link', name: 'Page 3' });
      const amount = amountAfter(await d.read(), invoiceId(PAGE_TARGET));
      await d.fill(textbox('Answer'), amount);
      await d.click(button('Submit answer'));
    },
    check: (s) => ({
      ok: digits(s.pages.answer) === digits(invoiceAmount(PAGE_TARGET)),
      detail: `answer=${s.pages.answer ?? 'none'} expected=${invoiceAmount(PAGE_TARGET)}`,
    }),
  },
  {
    id: 'modal',
    title: 'A modal that must be confirmed',
    path: '/drafts',
    goal: 'Delete the draft named "Q3 report", and only that one. Confirm the deletion when asked.',
    async script(d) {
      await d.open('/drafts');
      await d.click(button('Delete Q3 report'));
      await d.fill(textbox('Type DELETE to confirm'), 'DELETE');
      await d.click(button('Confirm delete'));
    },
    check: (s) => ({ ok: same(s.modal.deleted, ['q3']), detail: `deleted=${JSON.stringify(s.modal.deleted)}` }),
  },
  {
    id: 'checkout',
    title: 'A 3-step checkout form',
    path: '/checkout',
    goal: 'Place this order: ship to Ada Lovelace, 12 Analytical Row, London, by express delivery, paying with card 4242 4242 4242 4242 and accepting the terms of sale.',
    async script(d) {
      await d.open('/checkout');
      await d.fill(textbox('Full name'), 'Ada Lovelace');
      await d.fill(textbox('Street address'), '12 Analytical Row');
      await d.fill(textbox('City'), 'London');
      await d.click(button('Continue to delivery'));
      await d.click({ role: 'radio', name: 'Express, 1 day, $12' });
      await d.click(button('Continue to payment'));
      await d.fill(textbox('Card number'), '4242 4242 4242 4242');
      await d.check({ role: 'checkbox', name: 'I accept the terms of sale' });
      await d.click(button('Place order'));
    },
    check: (s) => ({
      ok: same(s.checkout.order, { name: 'Ada Lovelace', city: 'London', delivery: 'express', card: '4242', terms: true }),
      detail: `order=${JSON.stringify(s.checkout.order)}`,
    }),
  },
  {
    id: 'tabs',
    title: 'A field behind a tab and an accordion',
    path: '/settings',
    goal: `In these settings, save the VAT number ${VAT}.`,
    async script(d) {
      await d.open('/settings');
      await d.click({ role: 'tab', name: 'Billing' });
      await d.click(button('Tax details'));
      await d.fill(textbox('VAT number'), VAT);
      await d.click(button('Save VAT number'));
    },
    check: (s) => ({ ok: s.tabs.vat === VAT, detail: `vat=${s.tabs.vat ?? 'none'}` }),
  },
  {
    id: 'todo',
    title: 'A list that changes in place: add 3, remove 1',
    path: '/todo',
    goal: `Add these three items to the todo list: ${TODOS.map((t) => `"${t}"`).join(', ')}. Then remove "Buy eggs".`,
    async script(d) {
      await d.open('/todo');
      for (const item of TODOS) {
        await d.fill(textbox('New todo'), item);
        await d.click(button('Add'));
      }
      await d.click(button('Remove Buy eggs'));
    },
    check: (s) => ({ ok: same(s.todo.items, ['Buy milk', 'Buy bread']), detail: `items=${JSON.stringify(s.todo.items)}` }),
  },
  {
    id: 'long',
    title: 'Act on one row of a 320-row page',
    path: '/inventory',
    goal: `Restock ${skuOf(SKU_TARGET)} in this inventory, and no other row.`,
    async script(d) {
      await d.open('/inventory');
      await d.click(button(`Restock ${skuOf(SKU_TARGET)}`));
    },
    check: (s) => ({ ok: same(s.long.restocked, [skuOf(SKU_TARGET)]), detail: `restocked=${JSON.stringify(s.long.restocked)}` }),
  },
];
