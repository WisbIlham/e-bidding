/* eBid Baju — mock Bayarcash hosted payment flow (sandbox / demo only).
 * Flow: merchant page → pay/bayarcash.html → pay/bank.html (FPX) → pay/status.html → merchant returnUrl
 *       (returnUrl gets ?pay_intent=<id>&pay_status=success|failed|cancelled appended).
 * No real money moves and no card/bank data is stored or sent anywhere.
 * Load AFTER store.js, auction.js, ui.js. Global: window.EB.pay
 */
(function () {
  const EB = window.EB;
  const KEY = 'ebid_pay_intents';
  const MAX_KEEP = 60;

  const PLATFORM_MERCHANT = {
    name: 'eBid Baju (Demo)', registration: 'DEMO-000000-X',
    email: 'sandbox@ebidbaju.my', phone: '+60 3-0000 0000',
  };

  function readAll() {
    try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
  }
  function writeAll(all) {
    const ids = Object.keys(all).sort((a, b) => (all[b].createdAt || 0) - (all[a].createdAt || 0));
    ids.slice(MAX_KEEP).forEach(id => { delete all[id]; });
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
  }
  /** Read-modify-write one intent. fn(intent) mutates it. */
  function patch(id, fn) {
    const all = readAll();
    const it = all[id];
    if (!it) return null;
    fn(it);
    writeAll(all);
    return it;
  }

  const digits = n => { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10); return s.replace(/^0/, '1'); };
  const newId = () => 'PI' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const newRef = () => 'BC' + digits(10);

  /** "MYR 14,500.00" */
  const myr = n => 'MYR ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function tenantSlug(t) {
    if (!t) return EB.tenant.slug();
    return typeof t === 'string' ? t : t.slug;
  }

  /** Merchant shown on the payment page. fee → platform account; order → the shop's own Bayarcash account. */
  function merchantFor(kind, slug) {
    // Owner's rule (2026-11-12): the Bayarcash page always names the SHOP (its portal under our Bayarcash account),
    // for the RM10 fee too. PLATFORM_MERCHANT is only a fallback when the shop has no merchant name.
    const t = EB.tenant.bySlug(slug) || {};
    if (t.merchant && t.merchant.name) {
      return {
        name: t.merchant.name, registration: t.merchant.registration || 'DEMO-000000-X',
        email: t.merchant.email || ('demo@' + (t.domain || 'ebidbaju.my')), phone: t.merchant.phone || '+60 3-0000 0000',
      };
    }
    return { name: t.name || 'Merchant', registration: 'DEMO-000000-X', email: 'demo@' + (t.domain || 'ebidbaju.my'), phone: '+60 3-0000 0000' };
  }

  function pageUrl(page, intent, extra) {
    const u = new URL(EB.ui.ROOT + 'pay/' + page, location.href);
    u.searchParams.set('intent', intent.id);
    if (intent.shop) u.searchParams.set('shop', intent.shop);
    Object.entries(extra || {}).forEach(([k, v]) => { if (v != null) u.searchParams.set(k, v); });
    return u.href;
  }

  /** Merchant return URL with ?pay_intent=&pay_status= appended (other params kept). */
  function returnHref(intent, status) {
    const u = new URL(intent.returnUrl || (EB.ui.ROOT + 'shop.html'), location.href);
    u.searchParams.set('pay_intent', intent.id);
    u.searchParams.set('pay_status', status || intent.status);
    return u.href;
  }

  /**
   * start(opts) → intent (and navigates to the Bayarcash page unless opts.navigate === false)
   * opts: { kind:'fee'|'order', tenant (slug or object), itemId, orderId?, amount, description,
   *         customer:{name,email,phone}, channel:'fpx'|'duitnow'|'card', returnUrl, meta?, userId? }
   */
  function start(opts) {
    opts = opts || {};
    const kind = opts.kind === 'order' ? 'order' : 'fee';
    const shop = tenantSlug(opts.tenant);
    const user = (opts.userId ? EB.users.byId(opts.userId) : EB.auth.user()) || {};
    const s = EB.store.get();
    let amount = Number(opts.amount);
    if (!(amount > 0)) {
      if (kind === 'order') { const o = s.orders.find(x => x.id === opts.orderId); amount = o ? o.amount : 0; }
      else { const t = EB.tenant.bySlug(shop); amount = t ? t.settings.fee : 10; }
    }
    const c = opts.customer || {};
    const intent = {
      id: newId(),
      kind, shop, itemId: opts.itemId || null, orderId: opts.orderId || null,
      userId: opts.userId || EB.auth.userId() || null,
      orderNo: kind === 'order' ? (opts.orderId || 'EBD-INV-' + digits(5)) : 'EBD-FEE-' + digits(5),
      amount: Math.round(amount * 100) / 100,
      description: opts.description || (kind === 'fee' ? 'Participation fee' : 'Auction payment'),
      customer: { name: c.name || user.name || '', email: c.email || user.email || '', phone: c.phone || user.phone || '' },
      channel: ['fpx', 'duitnow', 'card'].includes(opts.channel) ? opts.channel : 'fpx',
      merchant: merchantFor(kind, shop),
      returnUrl: new URL(opts.returnUrl || location.href, location.href).href,
      meta: opts.meta || {},
      status: 'pending', createdAt: Date.now(),
      auth: null, bank: null, ref: null, completedAt: null, applied: false, effect: null,
    };
    const all = readAll();
    all[intent.id] = intent;
    writeAll(all);
    if (opts.navigate !== false) location.href = pageUrl('bayarcash.html', intent);
    return intent;
  }

  function get(id) { return id ? (readAll()[id] || null) : null; }

  /** Internal: the bank / channel step records its answer; status.html then calls complete(). */
  function authorize(id, res) {
    return patch(id, it => {
      if (it.status !== 'pending') return;
      it.auth = { status: res.status, bank: res.bank || null, at: Date.now() };
    });
  }

  /** Point the fee/order ref (and its inbox message) at the Bayarcash transaction ref. */
  function syncRef(kind, recId, oldRef, newRefVal) {
    if (!oldRef || oldRef === newRefVal) return;
    EB.store.update(s => {
      const list = kind === 'fee' ? s.fees : s.orders;
      const rec = list.find(x => x.id === recId);
      if (rec) rec.ref = newRefVal;
      s.inbox.forEach(m => { if (m.body && m.body.indexOf(oldRef) >= 0) m.body = m.body.split(oldRef).join(newRefVal); });
    });
  }

  function methodLabel(it, bank) {
    if (it.channel === 'duitnow') return 'DuitNow QR';
    if (it.channel === 'card') return 'Debit / Credit Card';
    return 'FPX - ' + (bank || 'Online Banking');
  }

  /**
   * complete(id, {status:'success'|'failed'|'cancelled', bank?, ref?}) → intent
   * Final once set: calling again never changes the result or applies the effect twice.
   */
  function complete(id, res) {
    res = res || {};
    let it = get(id);
    if (!it) return null;
    if (it.status !== 'pending') return it; // already final
    const status = ['success', 'failed', 'cancelled'].includes(res.status) ? res.status : 'failed';
    it = patch(id, x => {
      if (x.status !== 'pending') return;
      x.status = status;
      x.bank = res.bank || (x.auth && x.auth.bank) || null;
      x.ref = res.ref || x.ref || newRef();
      x.completedAt = Date.now();
    });
    if (it.status === 'success' && !it.applied) {
      // mark applied first so a second tab can never apply it again
      it = patch(id, x => { x.applied = true; });
      let effect = { ok: false };
      try {
        if (it.kind === 'fee') {
          const already = EB.auction.hasPaidFee(it.userId, it.itemId);
          const rec = already ? null : EB.auction.payFee(it.userId, it.itemId);
          if (rec) { syncRef('fee', rec.id, rec.ref, it.ref); effect = { ok: true, feeId: rec.id }; }
          else effect = { ok: already, note: already ? 'fee already recorded' : 'fee not recorded' };
        } else {
          const r = EB.auction.payOrder(it.orderId, (it.meta && it.meta.address) || null, methodLabel(it, it.bank));
          if (r && r.ok) { syncRef('order', r.order.id, r.order.ref, it.ref); effect = { ok: true, orderId: r.order.id }; }
          else effect = { ok: false, note: 'order is not unpaid' };
        }
      } catch (e) { console.error('[EB.pay]', e); effect = { ok: false, note: String(e && e.message || e) }; }
      it = patch(id, x => { x.effect = effect; });
    }
    return it;
  }

  /** Cancel from the payment page: mark cancelled, return the merchant URL to go to. */
  function cancel(id) {
    const it = complete(id, { status: 'cancelled' });
    return it ? returnHref(it, it.status) : null;
  }

  /** On a merchant return page: { id, intent, status } from ?pay_intent=&pay_status=, or null. */
  function result() {
    const p = new URLSearchParams(location.search);
    const id = p.get('pay_intent');
    if (!id) return null;
    const intent = get(id);
    const status = intent && intent.status !== 'pending' ? intent.status : (p.get('pay_status') || 'pending');
    return { id, intent, status };
  }

  /** Remove pay_intent / pay_status from the address bar (no reload). */
  function clearResult() {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('pay_intent');
      u.searchParams.delete('pay_status');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (e) { /* ignore */ }
  }

  EB.pay = {
    start, get, complete, result, clearResult, cancel,
    // used by the pay/*.html pages
    authorize, merchantFor, pageUrl, returnHref, myr, methodLabel, PLATFORM_MERCHANT,
  };
})();
