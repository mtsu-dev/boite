/**
 * The fixture site of the browser-agent bench: eight small apps of the kind an
 * agent is asked to drive, served by Bun.serve on a free loopback port. Every
 * app keeps its state here, on the server, so a checker reads what the agent
 * achieved without trusting the agent's own account of it. `reset` puts one
 * app back to its start before each run.
 */

export const TASK_IDS = ['signin', 'search', 'pages', 'modal', 'checkout', 'tabs', 'todo', 'long'] as const;
export type TaskId = (typeof TASK_IDS)[number];

export interface SiteState {
  signin: { failures: number; signedIn: string | null };
  search: { searches: number; chosen: string | null };
  pages: { answer: string | null };
  modal: { deleted: string[] };
  checkout: {
    shipping: { name: string; address: string; city: string } | null;
    delivery: string | null;
    order: { name: string; city: string; delivery: string; card: string; terms: boolean } | null;
  };
  tabs: { vat: string | null };
  todo: { items: string[] };
  long: { restocked: string[] };
}

const START: { [K in TaskId]: () => SiteState[K] } = {
  signin: () => ({ failures: 0, signedIn: null }),
  search: () => ({ searches: 0, chosen: null }),
  pages: () => ({ answer: null }),
  modal: () => ({ deleted: [] }),
  checkout: () => ({ shipping: null, delivery: null, order: null }),
  tabs: () => ({ vat: null }),
  todo: () => ({ items: [] }),
  long: () => ({ restocked: [] }),
};

export const SIGNIN = { email: 'ada@example.com', wrong: 'hunter2', password: 'correct-horse' };

export const PRODUCTS: { id: string; name: string; category: string; price: number }[] = [
  ['brass-desk-lamp', 'Brass desk lamp', 'Desk', 89],
  ['clamp-desk-lamp', 'Clamp desk lamp', 'Desk', 34],
  ['arc-floor-lamp', 'Arc floor lamp', 'Floor', 159],
  ['tripod-floor-lamp', 'Tripod floor lamp', 'Floor', 120],
  ['brass-wall-lamp', 'Brass wall lamp', 'Wall', 72],
  ['swing-arm-wall-lamp', 'Swing arm wall lamp', 'Wall', 64],
  ['solar-garden-lamp', 'Solar garden lamp', 'Outdoor', 25],
  ['lantern-lamp', 'Lantern lamp', 'Outdoor', 42],
  ['oak-desk', 'Oak desk', 'Desk', 420],
  ['desk-organiser', 'Desk organiser', 'Desk', 19],
  ['floor-cushion', 'Floor cushion', 'Floor', 39],
  ['wall-clock', 'Wall clock', 'Wall', 45],
  ['garden-bench', 'Garden bench', 'Outdoor', 210],
  ['brass-bookend', 'Brass bookend', 'Desk', 28],
].map(([id, name, category, price]) => ({ id: id as string, name: name as string, category: category as string, price: price as number }));
export const CATEGORIES = ['All', 'Desk', 'Floor', 'Wall', 'Outdoor'];

/** 100 invoices, 20 a page; amounts are a fixed function of the number, so every run reads the same one. */
export const INVOICES_PER_PAGE = 20;
export const invoiceAmount = (n: number): string => `$${(((n * 7919) % 90000) / 100 + 100).toFixed(2)}`;
export const invoiceId = (n: number): string => `INV-${String(n).padStart(4, '0')}`;

export const DRAFTS = [
  { id: 'q2', name: 'Q2 report' },
  { id: 'q3', name: 'Q3 report' },
  { id: 'q4', name: 'Q4 plan' },
];

export const INVENTORY_ROWS = 320;
export const skuOf = (n: number): string => `SKU-${String(n).padStart(4, '0')}`;

const escape = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title: string, body: string): Response =>
  new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title></head><body>${body}</body></html>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
const redirect = (to: string): Response => new Response(null, { status: 303, headers: { location: to } });
const json = (value: unknown): Response => Response.json(value, { headers: { 'cache-control': 'no-store' } });
const missing = (): Response => new Response('not found', { status: 404 });

function signinForm(error: string | null): Response {
  return page(
    'Sign in',
    `<h1>Sign in to Ledger</h1>${error === null ? '' : `<h2>${escape(error)}</h2>`}
<form method="post" action="/signin">
<p><label>Email <input name="email" type="email"></label></p>
<p><label>Password <input name="password" type="password"></label></p>
<p><button>Sign in</button></p></form><p><a href="/signin/forgot">Forgot your password?</a></p>`,
  );
}

function searchPage(q: string, category: string): Response {
  const wanted = q.trim().toLowerCase();
  const hits = wanted === '' ? [] : PRODUCTS.filter((p) => p.name.toLowerCase().includes(wanted) && (category === 'All' || p.category === category));
  const options = CATEGORIES.map((c) => `<option${c === category ? ' selected' : ''}>${c}</option>`).join('');
  const results = wanted === ''
    ? '<p>Type what you are looking for.</p>'
    : `<h2>${hits.length} results for ${escape(q)}</h2><ul>${hits
        .map((p) => `<li>${escape(p.name)}, ${p.category}, $${p.price} <form method="post" action="/search/choose" style="display:inline"><input type="hidden" name="id" value="${p.id}"><button>Choose ${escape(p.name)}</button></form></li>`)
        .join('')}</ul>`;
  return page(
    'Shop search',
    `<h1>Shop</h1><form method="get" action="/search">
<input type="search" name="q" aria-label="Search products" value="${escape(q)}">
<label for="category">Category</label> <select id="category" name="category">${options}</select>
<button>Search</button></form>${results}`,
  );
}

function invoicesPage(n: number): Response {
  const pages = Math.ceil(100 / INVOICES_PER_PAGE);
  const current = Math.min(Math.max(1, n), pages);
  const first = (current - 1) * INVOICES_PER_PAGE + 1;
  const rows = Array.from({ length: INVOICES_PER_PAGE }, (_, i) => first + i)
    .map((k) => `<tr><td>${invoiceId(k)}</td><td>${invoiceAmount(k)}</td><td>${k % 3 === 0 ? 'Paid' : 'Open'}</td></tr>`)
    .join('');
  const links = Array.from({ length: pages }, (_, i) => i + 1)
    .map((k) => (k === current ? `<span aria-current="page">Page ${k}</span>` : `<a href="/invoices?page=${k}">Page ${k}</a>`))
    .join(' ');
  const previous = current > 1 ? `<a href="/invoices?page=${current - 1}">Previous page</a>` : '';
  const next = current < pages ? `<a href="/invoices?page=${current + 1}">Next page</a>` : '';
  return page(
    `Invoices, page ${current}`,
    `<h1>Invoices</h1><table><thead><tr><th>Invoice</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
<nav>${previous} ${links} ${next}</nav>
<form method="post" action="/invoices/answer"><label>Answer <input name="answer"></label> <button>Submit answer</button></form>`,
  );
}

function draftsPage(state: SiteState['modal']): Response {
  const left = DRAFTS.filter((d) => !state.deleted.includes(d.id));
  return page(
    'Drafts',
    `<h1>Drafts</h1><ul id="list">${left.map((d) => `<li data-id="${d.id}">${escape(d.name)} <button data-delete="${d.id}" data-name="${escape(d.name)}">Delete ${escape(d.name)}</button></li>`).join('')}</ul>
<div id="notice"></div>
<dialog id="confirm"><h2 id="confirm-title"></h2><p><label>Type DELETE to confirm <input id="word" autocomplete="off"></label></p>
<button id="cancel">Cancel</button> <button id="go" disabled>Confirm delete</button></dialog>
<script>
let target = null;
const dialog = document.getElementById('confirm'), word = document.getElementById('word'), go = document.getElementById('go');
document.getElementById('list').addEventListener('click', e => {
  const b = e.target.closest('[data-delete]'); if (!b) return;
  target = { id: b.dataset.delete, name: b.dataset.name };
  document.getElementById('confirm-title').textContent = 'Delete ' + target.name + '?';
  word.value = ''; go.disabled = true; dialog.showModal();
});
word.addEventListener('input', () => { go.disabled = word.value !== 'DELETE'; });
document.getElementById('cancel').addEventListener('click', () => dialog.close());
go.addEventListener('click', async () => {
  const r = await fetch('/drafts/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: target.id, confirm: word.value }) });
  dialog.close();
  if (!r.ok) { document.getElementById('notice').innerHTML = '<h2>Could not delete</h2>'; return; }
  document.querySelector('li[data-id="' + target.id + '"]').remove();
  document.getElementById('notice').innerHTML = '<h2></h2>';
  document.querySelector('#notice h2').textContent = target.name + ' deleted';
});
</script>`,
  );
}

function checkoutStep(step: number, error: string | null): Response {
  const head = `<h1>Checkout, step ${step} of 3</h1>${error === null ? '' : `<h2>${escape(error)}</h2>`}`;
  if (step === 1) {
    return page('Checkout: shipping', `${head}<form method="post" action="/checkout/1">
<p><label>Full name <input name="name"></label></p><p><label>Street address <input name="address"></label></p>
<p><label>City <input name="city"></label></p><p><button>Continue to delivery</button></p></form>`);
  }
  if (step === 2) {
    return page('Checkout: delivery', `${head}<form method="post" action="/checkout/2"><fieldset><legend>Delivery</legend>
<p><label><input type="radio" name="delivery" value="standard" checked> Standard, 5 days, free</label></p>
<p><label><input type="radio" name="delivery" value="express"> Express, 1 day, $12</label></p></fieldset>
<p><button>Continue to payment</button></p></form>`);
  }
  return page('Checkout: payment', `${head}<form method="post" action="/checkout/3">
<p><label>Card number <input name="card" inputmode="numeric"></label></p>
<p><label><input type="checkbox" name="terms" value="yes"> I accept the terms of sale</label></p>
<p><button>Place order</button></p></form>`);
}

function settingsPage(): Response {
  return page(
    'Settings',
    `<h1>Settings</h1>
<div role="tablist" aria-label="Settings sections">
<button role="tab" id="tab-profile" aria-selected="true" aria-controls="panel-profile">Profile</button>
<button role="tab" id="tab-notifications" aria-selected="false" aria-controls="panel-notifications">Notifications</button>
<button role="tab" id="tab-billing" aria-selected="false" aria-controls="panel-billing">Billing</button></div>
<section role="tabpanel" id="panel-profile"><p><label>Display name <input value="Ada"></label></p><button>Save profile</button></section>
<section role="tabpanel" id="panel-notifications" hidden><p><label><input type="checkbox" checked> Email me a weekly summary</label></p></section>
<section role="tabpanel" id="panel-billing" hidden>
<details><summary>Payment method</summary><p>Visa ending 4242</p><button>Replace card</button></details>
<details><summary>Billing address</summary><p><label>Billing city <input value="London"></label></p></details>
<details><summary>Tax details</summary><p><label>VAT number <input id="vat"></label></p><button id="save-vat">Save VAT number</button></details>
</section><div id="notice"></div>
<script>
for (const tab of document.querySelectorAll('[role=tab]')) tab.addEventListener('click', () => {
  for (const other of document.querySelectorAll('[role=tab]')) {
    other.setAttribute('aria-selected', String(other === tab));
    document.getElementById(other.getAttribute('aria-controls')).hidden = other !== tab;
  }
});
document.getElementById('save-vat').addEventListener('click', async () => {
  const r = await fetch('/settings/vat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vat: document.getElementById('vat').value }) });
  document.getElementById('notice').innerHTML = r.ok ? '<h2>VAT number saved</h2>' : '<h2>The VAT number was refused</h2>';
});
</script>`,
  );
}

function todoPage(): Response {
  return page(
    'Todo',
    `<h1>Todo</h1><form id="add"><label>New todo <input id="text" autocomplete="off"></label> <button>Add</button></form>
<h2 id="count"></h2><ul id="items"></ul>
<script>
const render = items => {
  document.getElementById('count').textContent = items.length + (items.length === 1 ? ' item left' : ' items left');
  const list = document.getElementById('items'); list.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li'); li.append(item + ' ');
    const b = document.createElement('button'); b.textContent = 'Remove ' + item;
    b.addEventListener('click', () => send('/todo/remove', item)); li.append(b); list.append(li);
  }
};
const send = async (path, text) => render(await (await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })).json());
document.getElementById('add').addEventListener('submit', e => {
  e.preventDefault(); const field = document.getElementById('text'); const text = field.value.trim(); field.value = '';
  if (text) send('/todo/add', text);
});
fetch('/todo/items').then(r => r.json()).then(render);
</script>`,
  );
}

function inventoryPage(state: SiteState['long']): Response {
  const rows = Array.from({ length: INVENTORY_ROWS }, (_, i) => i + 1)
    .map((n) => {
      const sku = skuOf(n);
      const done = state.restocked.includes(sku);
      return `<tr><td>${sku}</td><td>${(n * 37) % 50}</td><td><button data-sku="${sku}"${done ? ' disabled' : ''}>${done ? 'Restocked' : 'Restock'} ${sku}</button></td></tr>`;
    })
    .join('');
  return page(
    'Inventory',
    `<h1>Inventory</h1><table><thead><tr><th>SKU</th><th>Stock</th><th>Action</th></tr></thead><tbody id="rows">${rows}</tbody></table>
<script>
document.getElementById('rows').addEventListener('click', async e => {
  const b = e.target.closest('button[data-sku]'); if (!b || b.disabled) return;
  const r = await fetch('/inventory/restock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sku: b.dataset.sku }) });
  if (r.ok) { b.textContent = 'Restocked ' + b.dataset.sku; b.disabled = true; }
});
</script>`,
  );
}

async function form(request: Request): Promise<Record<string, string>> {
  const data = await request.formData();
  const out: Record<string, string> = {};
  for (const [key, value] of data) if (typeof value === 'string') out[key] = value;
  return out;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface FixtureSite {
  url: string;
  state: SiteState;
  reset(task: TaskId): void;
  stop(): void;
}

export function startSite(): FixtureSite {
  const state = Object.fromEntries(TASK_IDS.map((id) => [id, START[id]()])) as unknown as SiteState;

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      const post = request.method === 'POST';

      if (path === '/') {
        return page('Fixture site', `<h1>Fixture site</h1><ul>${['signin', 'search', 'invoices', 'drafts', 'checkout', 'settings', 'todo', 'inventory'].map((p) => `<li><a href="/${p}">${p}</a></li>`).join('')}</ul>`);
      }

      if (path === '/signin' && !post) return signinForm(null);
      if (path === '/signin' && post) {
        const f = await form(request);
        if (f.email === SIGNIN.email && f.password === SIGNIN.password) {
          state.signin.signedIn = f.email;
          return redirect('/signin/welcome');
        }
        state.signin.failures += 1;
        return signinForm('Wrong email or password');
      }
      if (path === '/signin/welcome') {
        return state.signin.signedIn === null ? redirect('/signin') : page('Welcome', '<h1>Welcome back, Ada</h1><p><a href="/signin">Sign out</a></p>');
      }

      if (path === '/search' && !post) {
        const q = url.searchParams.get('q') ?? '';
        if (q !== '') state.search.searches += 1;
        const category = url.searchParams.get('category') ?? 'All';
        return searchPage(q, CATEGORIES.includes(category) ? category : 'All');
      }
      if (path === '/search/choose' && post) {
        const chosen = (await form(request)).id;
        const product = PRODUCTS.find((p) => p.id === chosen);
        if (product === undefined) return missing();
        state.search.chosen = product.id;
        return redirect(`/search/chosen?id=${product.id}`);
      }
      if (path === '/search/chosen') {
        const product = PRODUCTS.find((p) => p.id === url.searchParams.get('id'));
        return page('Chosen', `<h1>You chose ${escape(product?.name ?? 'nothing')}</h1>`);
      }

      if (path === '/invoices' && !post) return invoicesPage(Number(url.searchParams.get('page') ?? 1) || 1);
      if (path === '/invoices/answer' && post) {
        state.pages.answer = (await form(request)).answer ?? '';
        return page('Answer received', '<h1>Answer received</h1>');
      }

      if (path === '/drafts') return draftsPage(state.modal);
      if (path === '/drafts/delete' && post) {
        const b = await body(request);
        if (b.confirm !== 'DELETE' || !DRAFTS.some((d) => d.id === b.id)) return new Response('refused', { status: 400 });
        if (!state.modal.deleted.includes(b.id as string)) state.modal.deleted.push(b.id as string);
        return json({ ok: true });
      }

      if (path === '/checkout' || path === '/checkout/1') {
        if (!post) return checkoutStep(1, null);
        const f = await form(request);
        if (!f.name || !f.address || !f.city) return checkoutStep(1, 'Fill in every field');
        state.checkout.shipping = { name: f.name, address: f.address, city: f.city };
        return redirect('/checkout/2');
      }
      if (path === '/checkout/2') {
        if (state.checkout.shipping === null) return redirect('/checkout/1');
        if (!post) return checkoutStep(2, null);
        state.checkout.delivery = (await form(request)).delivery ?? 'standard';
        return redirect('/checkout/3');
      }
      if (path === '/checkout/3') {
        if (state.checkout.shipping === null || state.checkout.delivery === null) return redirect('/checkout/1');
        if (!post) return checkoutStep(3, null);
        const f = await form(request);
        const card = (f.card ?? '').replace(/\D/g, '');
        if (card.length < 12) return checkoutStep(3, 'Enter a card number');
        if (f.terms !== 'yes') return checkoutStep(3, 'Accept the terms of sale');
        state.checkout.order = { name: state.checkout.shipping.name, city: state.checkout.shipping.city, delivery: state.checkout.delivery, card: card.slice(-4), terms: true };
        return redirect('/checkout/done');
      }
      if (path === '/checkout/done') return page('Order placed', '<h1>Order placed</h1><p>Thank you.</p>');

      if (path === '/settings') return settingsPage();
      if (path === '/settings/vat' && post) {
        const vat = String((await body(request)).vat ?? '').trim();
        if (!/^[A-Z]{2}[0-9A-Z]{8,12}$/.test(vat)) return new Response('refused', { status: 400 });
        state.tabs.vat = vat;
        return json({ ok: true });
      }

      if (path === '/todo') return todoPage();
      if (path === '/todo/items') return json(state.todo.items);
      if (path === '/todo/add' && post) {
        const text = String((await body(request)).text ?? '').trim();
        if (text !== '') state.todo.items.push(text);
        return json(state.todo.items);
      }
      if (path === '/todo/remove' && post) {
        const text = String((await body(request)).text ?? '');
        state.todo.items = state.todo.items.filter((item) => item !== text);
        return json(state.todo.items);
      }

      if (path === '/inventory') return inventoryPage(state.long);
      if (path === '/inventory/restock' && post) {
        const sku = String((await body(request)).sku ?? '');
        if (!/^SKU-\d{4}$/.test(sku)) return new Response('refused', { status: 400 });
        if (!state.long.restocked.includes(sku)) state.long.restocked.push(sku);
        return json({ ok: true });
      }

      return missing();
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    state,
    reset(task: TaskId): void {
      (state as unknown as Record<TaskId, unknown>)[task] = START[task]();
    },
    stop(): void {
      void server.stop(true);
    },
  };
}
