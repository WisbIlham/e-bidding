/* eBid Baju — auction rules engine.
 * Rules adapted from JPJeBid: tier min price + min increment, increment x2 in the last 30 min,
 * participation fee (RM10) on first bid per item, no cancel, win limit per bidder per shop.
 * Changed: open live auction (everyone sees highest bid + history).
 * Global: window.EB.auction
 */
(function () {
  const EB = window.EB;
  const S = EB.store;

  const tenantOf = (s, item) => s.tenants.find(t => t.slug === item.tenant);
  const tierOf = (s, item) => { const t = tenantOf(s, item); return t.tiers.find(x => x.id === item.tier) || t.tiers[0]; };

  function status(item, now) {
    now = now || Date.now();
    if (now < item.startAt) return 'upcoming';
    if (now >= item.endAt) return 'ended';
    return 'live';
  }

  function bidsFor(itemId, s) {
    s = s || S.get();
    return s.bids.filter(b => b.itemId === itemId).sort((a, b) => b.amount - a.amount || a.at - b.at);
  }

  function highest(itemId, s) { return bidsFor(itemId, s)[0] || null; }

  function isLastWindow(item, s, now) {
    s = s || S.get(); now = now || Date.now();
    const t = tenantOf(s, item);
    if (!t.settings.lastWindowOn) return false;
    const left = item.endAt - now;
    return left > 0 && left <= t.settings.lastWindowMin * 60000;
  }

  function increment(item, s) {
    s = s || S.get();
    const t = tenantOf(s, item);
    const base = tierOf(s, item).increment;
    return isLastWindow(item, s) ? base * (t.settings.lastWindowMultiplier || 2) : base;
  }

  function minNextBid(item, s) {
    s = s || S.get();
    const h = highest(item.id, s);
    return h ? h.amount + increment(item, s) : item.startPrice;
  }

  function hasPaidFee(userId, itemId, s) {
    s = s || S.get();
    return !!s.fees.find(f => f.userId === userId && f.itemId === itemId);
  }

  /** Items in this shop the user is leading (live) or has won (not passed). */
  function winningCount(userId, tenantSlug, s) {
    s = s || S.get();
    let n = 0;
    s.items.filter(i => i.tenant === tenantSlug).forEach(i => {
      if (i.result) {
        const o = s.orders.find(o => o.itemId === i.id && o.userId === userId && o.status !== 'passed');
        if (o) n++;
      } else if (status(i) === 'live') {
        const h = highest(i.id, s);
        if (h && h.userId === userId) n++;
      }
    });
    return n;
  }

  /** canBid → { ok, reason, code } */
  function canBid(userId, item, amount, s) {
    s = s || S.get();
    const t = tenantOf(s, item);
    if (!userId) return { ok: false, code: 'login', reason: 'Sila log masuk untuk membida.' };
    const st = status(item);
    if (st === 'upcoming') return { ok: false, code: 'upcoming', reason: 'Lelongan belum bermula.' };
    if (st === 'ended') return { ok: false, code: 'ended', reason: 'Lelongan telah tamat.' };
    const h = highest(item.id, s);
    if (h && h.userId === userId) return { ok: false, code: 'leading', reason: 'Anda sudah pembida tertinggi.' };
    const min = minNextBid(item, s);
    if (amount != null && !(amount >= min)) return { ok: false, code: 'low', reason: 'Bidaan minima ialah ' + EB.money(min) + '.' };
    if (amount != null && amount > min * 20) return { ok: false, code: 'high', reason: 'Amaun terlalu tinggi. Sila semak semula.' };
    const lim = t.settings.winLimit;
    if (lim && winningCount(userId, t.slug, s) >= lim) {
      return { ok: false, code: 'limit', reason: 'Had kelayakan menang dicapai (' + lim + ' item bagi kedai ini).' };
    }
    if (!hasPaidFee(userId, item.id, s)) return { ok: false, code: 'fee', reason: 'Yuran penyertaan ' + EB.money(t.settings.fee) + ' perlu dibayar untuk bidaan pertama.' };
    return { ok: true };
  }

  function pushInbox(s, msg) {
    s.inbox.push(Object.assign({ id: S.uid('msg'), at: Date.now(), read: false, itemId: null }, msg));
  }

  /** payFee(userId, itemId) → fee record (mock Bayarcash FPX) */
  function payFee(userId, itemId) {
    let rec = null;
    S.update(s => {
      if (s.fees.find(f => f.userId === userId && f.itemId === itemId)) return;
      const item = s.items.find(i => i.id === itemId);
      const t = tenantOf(s, item);
      rec = { id: S.uid('fee'), userId, itemId, tenant: item.tenant, amount: t.settings.fee, at: Date.now(), ref: 'BC' + S.rand(100000, 999999) };
      s.fees.push(rec);
      pushInbox(s, { userId, tenant: item.tenant, type: 'fee', itemId, title: 'Yuran penyertaan diterima', body: 'Bayaran ' + EB.money(rec.amount) + ' (Ruj: ' + rec.ref + ') untuk "' + item.title + '" berjaya. Anda boleh membida item ini sehingga tamat.' });
    });
    return rec;
  }

  /** placeBid → { ok, reason, bid } */
  function placeBid(userId, itemId, amount) {
    let result = null;
    S.update(s => {
      const item = s.items.find(i => i.id === itemId);
      if (!item) { result = { ok: false, reason: 'Item tidak dijumpai.' }; return; }
      const chk = canBid(userId, item, amount, s);
      if (!chk.ok) { result = chk; return; }
      const prev = highest(itemId, s);
      const bid = { id: S.uid('bid'), itemId, tenant: item.tenant, userId, amount: Math.round(amount * 100) / 100, at: Date.now() };
      s.bids.push(bid);
      if (prev && prev.userId !== userId && !EB.users.isBot(prev.userId)) {
        pushInbox(s, { userId: prev.userId, tenant: item.tenant, type: 'outbid', itemId, title: 'Bidaan anda telah dilepasi', body: 'Bidaan baharu ' + EB.money(bid.amount) + ' untuk "' + item.title + '". Bida semula sebelum tamat.' });
      }
      if (!EB.users.isBot(userId)) {
        pushInbox(s, { userId, tenant: item.tenant, type: 'bid', itemId, title: 'Bidaan diterima', body: 'Bidaan ' + EB.money(bid.amount) + ' untuk "' + item.title + '" telah direkodkan. Bidaan tidak boleh dibatalkan.', read: true });
      }
      result = { ok: true, bid };
    });
    return result;
  }

  function makeOrder(s, item, bid, note) {
    const t = tenantOf(s, item);
    const now = Date.now();
    const o = {
      id: 'INV-' + item.id.toUpperCase() + '-' + S.rand(1000, 9999),
      itemId: item.id, tenant: item.tenant, userId: bid.userId, amount: bid.amount,
      status: 'unpaid', createdAt: now, dueAt: now + t.settings.payDeadlineHours * 3600000,
      paidAt: null, address: null, note: note || '',
    };
    if (EB.users.isBot(bid.userId) && !note && Math.random() < 0.7) { o.status = 'paid'; o.paidAt = now; o.address = 'Alamat pembeli (demo)'; }
    s.orders.push(o);
    return o;
  }

  /** Close every ended item that has no result yet. Called by the engine. */
  function closeDue(s) {
    const now = Date.now();
    let changed = false;
    s.items.forEach(item => {
      if (item.result || now < item.endAt) return;
      changed = true;
      const all = bidsFor(item.id, s);
      const win = all[0];
      if (!win) { item.result = { winnerId: null, amount: 0, closedAt: now }; return; }
      item.result = { winnerId: win.userId, amount: win.amount, closedAt: now };
      const o = makeOrder(s, item, win);
      const t = tenantOf(s, item);
      if (!EB.users.isBot(win.userId)) {
        pushInbox(s, { userId: win.userId, tenant: item.tenant, type: 'won', itemId: item.id, title: 'Tahniah! Anda memenangi bidaan', body: 'Anda menang "' + item.title + '" dengan ' + EB.money(win.amount) + '. Sila bayar dalam ' + t.settings.payDeadlineHours + ' jam (Invois ' + o.id + ').' });
      }
      const losers = [...new Set(all.map(b => b.userId))].filter(u => u !== win.userId && !EB.users.isBot(u));
      losers.forEach(u => pushInbox(s, { userId: u, tenant: item.tenant, type: 'lost', itemId: item.id, title: 'Bidaan tidak berjaya', body: '"' + item.title + '" telah dimenangi pada ' + EB.money(win.amount) + '. Yuran penyertaan tidak dikembalikan.' }));
    });
    return changed;
  }

  /** Admin: winner did not pay → offer to the next highest distinct bidder. */
  function passToNext(orderId) {
    let res = null;
    S.update(s => {
      const o = s.orders.find(x => x.id === orderId);
      if (!o || o.status !== 'unpaid') { res = { ok: false, reason: 'Invois tidak sah.' }; return; }
      o.status = 'passed';
      const item = s.items.find(i => i.id === o.itemId);
      const excluded = s.orders.filter(x => x.itemId === item.id).map(x => x.userId);
      const next = bidsFor(item.id, s).find(b => !excluded.includes(b.userId));
      if (!o.userId.startsWith('b_')) {
        pushInbox(s, { userId: o.userId, tenant: item.tenant, type: 'expired', itemId: item.id, title: 'Invois luput', body: 'Bayaran untuk "' + item.title + '" tidak diterima dalam tempoh. Item ditawarkan kepada pembida seterusnya.' });
      }
      if (!next) { item.result = Object.assign(item.result || {}, { winnerId: null, amount: 0 }); res = { ok: true, next: null }; return; }
      const n = makeOrder(s, item, next, 'Tawaran kedua');
      item.result = Object.assign(item.result || {}, { winnerId: next.userId, amount: next.amount });
      if (!EB.users.isBot(next.userId)) {
        pushInbox(s, { userId: next.userId, tenant: item.tenant, type: 'won', itemId: item.id, title: 'Tawaran kedua: anda boleh membeli item ini', body: 'Pemenang asal tidak membayar. "' + item.title + '" kini ditawarkan kepada anda pada ' + EB.money(next.amount) + ' (Invois ' + n.id + ').' });
      }
      res = { ok: true, next: n };
    });
    return res;
  }

  function payOrder(orderId, address, method) {
    let res = null;
    S.update(s => {
      const o = s.orders.find(x => x.id === orderId);
      if (!o || o.status !== 'unpaid') { res = { ok: false }; return; }
      o.status = 'paid'; o.paidAt = Date.now(); o.address = address; o.method = method || 'FPX';
      o.ref = 'BC' + S.rand(100000, 999999);
      const item = s.items.find(i => i.id === o.itemId);
      const t = s.tenants.find(x => x.slug === o.tenant);
      const pickup = /^Ambil semasa majlis/i.test(address || '') || o.fulfilment === 'pickup';
      const next = pickup
        ? ((t && t.settings.fulfilment && t.settings.fulfilment.pickupNote) || 'Item boleh diambil semasa majlis.')
        : 'Item akan dipos dalam 3 hari bekerja.';
      pushInbox(s, { userId: o.userId, tenant: o.tenant, type: 'paid', itemId: o.itemId, title: 'Pembayaran berjaya', body: 'Bayaran ' + EB.money(o.total || o.amount) + ' untuk "' + item.title + '" diterima (Ruj: ' + o.ref + '). ' + next });
      res = { ok: true, order: o };
    });
    return res;
  }

  /* ---------- admin item CRUD ---------- */
  function createItem(fields) {
    const id = S.uid('it');
    S.update(s => {
      const t = s.tenants.find(x => x.slug === fields.tenant);
      const tier = t.tiers.find(x => x.id === fields.tier) || t.tiers[0];
      s.items.push(Object.assign({
        id, color: '#cbd5e1', desc: '', condition: 'Baru', size: 'M', category: 'Baju Kurung',
        startPrice: tier.minPrice, botCeiling: Math.round(tier.minPrice * 2.5),
        result: null, endingNotified: false, createdAt: Date.now(),
      }, fields, { id }));
    });
    return id;
  }

  function updateItem(id, patch) { S.update(s => { const i = s.items.find(x => x.id === id); if (i) Object.assign(i, patch); }); }

  function deleteItem(id) {
    let ok = false;
    S.update(s => {
      if (s.bids.some(b => b.itemId === id)) return;
      s.items = s.items.filter(i => i.id !== id); ok = true;
    });
    return ok;
  }

  /* ---------- engine: bots + closing (one leader tab runs it) ---------- */
  const TAB_ID = S.uid('tab');
  const LEADER_KEY = 'ebid_leader';
  let lastHuman = {}; // itemId -> time a human took the lead (bots react)

  function amLeader() {
    let cur = null;
    try { cur = JSON.parse(localStorage.getItem(LEADER_KEY) || 'null'); } catch (e) { /* ignore */ }
    const now = Date.now();
    if (!cur || cur.id === TAB_ID || now - cur.ts > 3500) {
      try { localStorage.setItem(LEADER_KEY, JSON.stringify({ id: TAB_ID, ts: now })); } catch (e) { /* ignore */ }
      return true;
    }
    return false;
  }

  function botTick() {
    const s = S.get();
    const now = Date.now();
    const bots = s.users.filter(u => u.role === 'bot').map(u => u.id);
    const moves = [];
    s.items.forEach(item => {
      if (status(item, now) !== 'live') return;
      const left = item.endAt - now;
      const h = highest(item.id, s);
      const humanLead = h && !EB.users.isBot(h.userId);
      if (humanLead && !lastHuman[item.id]) lastHuman[item.id] = now;
      if (!humanLead) delete lastHuman[item.id];
      let p = left < 60000 ? 0.18 : left < 5 * 60000 ? 0.05 : left < 30 * 60000 ? 0.02 : 0.002;
      if (humanLead && now - lastHuman[item.id] > 4000) p += 0.12; // bots fight back
      if (Math.random() >= p) return;
      const next = minNextBid(item, s);
      if (next > item.botCeiling) return;
      const pool = bots.filter(b => !h || b !== h.userId);
      const userId = pool[S.rand(0, pool.length - 1)];
      const amt = next + increment(item, s) * (Math.random() < 0.7 ? 0 : S.rand(1, 2));
      moves.push({ userId, itemId: item.id, amount: Math.min(amt, item.botCeiling) });
    });
    moves.forEach(m => {
      if (!EB.users.isBot(m.userId)) return;
      // bots skip the fee + limit checks
      S.update(s2 => {
        const item = s2.items.find(i => i.id === m.itemId);
        const min = minNextBid(item, s2);
        if (m.amount < min || status(item) !== 'live') return;
        const prev = highest(item.id, s2);
        s2.bids.push({ id: S.uid('bid'), itemId: item.id, tenant: item.tenant, userId: m.userId, amount: m.amount, at: Date.now() });
        if (prev && !EB.users.isBot(prev.userId)) {
          pushInbox(s2, { userId: prev.userId, tenant: item.tenant, type: 'outbid', itemId: item.id, title: 'Bidaan anda telah dilepasi', body: 'Bidaan baharu ' + EB.money(m.amount) + ' untuk "' + item.title + '". Bida semula sebelum tamat.' });
        }
      });
    });
  }

  function endingTick() {
    const s = S.get();
    const now = Date.now();
    const due = s.items.filter(i => !i.endingNotified && status(i, now) === 'live' && i.endAt - now < 2 * 60000);
    if (!due.length) return;
    S.update(s2 => {
      due.forEach(d => {
        const item = s2.items.find(i => i.id === d.id);
        item.endingNotified = true;
        const humans = [...new Set(s2.bids.filter(b => b.itemId === item.id).map(b => b.userId))].filter(u => !EB.users.isBot(u));
        humans.forEach(u => pushInbox(s2, { userId: u, tenant: item.tenant, type: 'ending', itemId: item.id, title: 'Lelongan hampir tamat', body: '"' + item.title + '" tamat dalam kurang 2 minit.' }));
      });
    });
  }

  let engineTimer = null;
  function startEngine() {
    if (engineTimer) return;
    const tick = () => {
      if (!amLeader()) return;
      try {
        const s = S.get();
        if (s.items.some(i => !i.result && Date.now() >= i.endAt)) S.update(s2 => { closeDue(s2); });
        endingTick();
        botTick();
      } catch (e) { console.error('[eBid engine]', e); }
    };
    tick();
    engineTimer = setInterval(tick, 1000);
  }

  EB.auction = {
    status, bidsFor, highest, isLastWindow, increment, minNextBid, hasPaidFee, winningCount,
    canBid, payFee, placeBid, passToNext, payOrder, createItem, updateItem, deleteItem,
    startEngine, tierOf: item => tierOf(S.get(), item), tenantOf: item => tenantOf(S.get(), item),
  };
})();
