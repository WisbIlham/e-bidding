/* eBid Baju — state store (localStorage) + cross-tab sync (BroadcastChannel) + tenant + auth.
 * Global: window.EB.store, EB.tenant, EB.auth, EB.users
 */
(function () {
  const EB = (window.EB = window.EB || {});
  const D = window.EB_DATA;
  const KEY = 'ebid_state_v' + D.version;
  const SESSION_KEY = 'ebid_session';
  const SHOP_KEY = 'ebid_last_shop';

  let channel = null;
  try { channel = new BroadcastChannel('ebid-baju'); } catch (e) { /* old browser */ }

  const listeners = [];
  let cache = null;

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function safeDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  /* ---------- initial state ---------- */
  function buildInitial() {
    const now = Date.now();
    const bots = D.users.filter(u => u.role === 'bot').map(u => u.id);
    const tenants = JSON.parse(JSON.stringify(D.tenants));
    const items = [];
    const bids = [];
    const fees = [];

    D.items.forEach(src => {
      const t = tenants.find(x => x.slug === src.tenant);
      const tier = t.tiers.find(x => x.id === src.tier) || t.tiers[0];
      const item = {
        id: src.id, tenant: src.tenant, title: src.title, category: src.category, size: src.size,
        condition: src.condition, tier: src.tier, color: src.color, desc: src.desc,
        images: src.images || null,
        video: src.video || null,
        story: src.story ? JSON.parse(JSON.stringify(src.story)) : null,
        startPrice: Math.max(src.startPrice || 0, tier.minPrice),
        startAt: now + src.startMin * 60000,
        endAt: now + src.endMin * 60000,
        // bots stop bidding above this, so a real user can still win
        botCeiling: Math.round(tier.minPrice * (1.8 + Math.random() * 1.6)),
        result: null, endingNotified: false, createdAt: now - 3 * 86400000,
      };
      items.push(item);

      const n = (src.seed && src.seed.n) || 0;
      if (!n) return;
      const by = (src.seed && src.seed.by) || {};
      const from = item.startAt;
      const to = Math.min(now, item.endAt) - 20000;
      let amount = item.startPrice;
      let last = null;
      for (let i = 0; i < n; i++) {
        const fromEnd = String(i - n); // -n .. -1
        let userId = by[fromEnd];
        if (!userId) {
          const pool = bots.filter(b => b !== last);
          userId = pool[rand(0, pool.length - 1)];
        }
        if (i > 0) amount += tier.increment * rand(1, 3);
        const at = Math.round(from + ((to - from) * (i + 1)) / (n + 1));
        bids.push({ id: uid('bid'), itemId: item.id, tenant: item.tenant, userId, amount, at });
        if (!userId.startsWith('b_') && !fees.find(f => f.userId === userId && f.itemId === item.id)) {
          fees.push({ id: uid('fee'), userId, itemId: item.id, tenant: item.tenant, amount: t.settings.fee, at: at - 60000, ref: 'BC' + rand(100000, 999999) });
        }
        last = userId;
      }
      // keep the bot ceiling above the seeded price
      item.botCeiling = Math.max(item.botCeiling, amount + tier.increment * 6);
    });

    // some older platform fee history for the super-admin revenue chart
    const feeHistory = [];
    tenants.forEach(t => {
      // only days after the shop joined the platform (PAS KB joined today, so it has no history)
      const joined = t.joinedAt ? new Date(t.joinedAt + 'T00:00:00').getTime() : 0;
      for (let d = 1; d <= 14; d++) {
        if (now - d * 86400000 < joined) continue;
        const count = rand(3, t.plan === 'Pro' ? 22 : 12);
        const dt = new Date(now - d * 86400000);
        const day = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
        feeHistory.push({ tenant: t.slug, day, count, amount: count * t.settings.fee });
      }
    });

    return {
      createdAt: now,
      tenants,
      users: JSON.parse(JSON.stringify(D.users)),
      items, bids, fees, feeHistory,
      favourites: { u_aina: [], u_hafiz: [], u_meiling: [] },
      inbox: [
        { id: uid('msg'), userId: 'u_aina', tenant: 'paskb', type: 'info', title: 'Akaun anda telah disahkan', body: 'Selamat datang ke Bidaan Istimewa PAS Kawasan Kota Bharu. Anda boleh mula membida.', itemId: null, at: now - 86400000, read: true },
      ],
      orders: [],
      log: [],
    };
  }

  /* ---------- load / save ---------- */
  function load() {
    const raw = safeGet(KEY);
    if (raw) {
      try { cache = JSON.parse(raw); return cache; } catch (e) { /* fallthrough */ }
    }
    cache = buildInitial();
    safeSet(KEY, JSON.stringify(cache));
    return cache;
  }

  function get() {
    // always re-read so other tabs' writes are seen
    const raw = safeGet(KEY);
    if (raw) { try { cache = JSON.parse(raw); } catch (e) { /* keep cache */ } }
    return cache || load();
  }

  function notify(source) {
    listeners.forEach(fn => { try { fn(cache, source); } catch (e) { console.error(e); } });
  }

  /** update(fn): fn(state) mutates state in place (or returns a new one). Saves + broadcasts. */
  function update(fn) {
    const s = get();
    const out = fn(s);
    cache = out || s;
    safeSet(KEY, JSON.stringify(cache));
    if (channel) channel.postMessage({ type: 'change', at: Date.now() });
    notify('local');
    return cache;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  function reset() {
    safeDel(KEY);
    cache = null;
    load();
    if (channel) channel.postMessage({ type: 'reset' });
    notify('reset');
  }

  if (channel) channel.onmessage = () => { get(); notify('remote'); };
  window.addEventListener('storage', e => {
    if (e.key === KEY) { get(); notify('remote'); }
    if (e.key === SESSION_KEY) notify('auth');
  });

  EB.store = { get, update, subscribe, reset, uid, rand, KEY };

  /* ---------- users ---------- */
  EB.users = {
    all: () => get().users,
    byId: id => get().users.find(u => u.id === id) || { id, name: 'Pengguna', role: 'bidder' },
    bidders: () => get().users.filter(u => u.role === 'bidder'),
    isBot: id => String(id).startsWith('b_'),
  };

  /* ---------- tenant (multi-tenant via ?shop=) ---------- */
  function currentSlug() {
    const p = new URLSearchParams(location.search).get('shop');
    const s = get();
    if (p && s.tenants.find(t => t.slug === p)) { safeSet(SHOP_KEY, p); return p; }
    const last = safeGet(SHOP_KEY);
    if (last && s.tenants.find(t => t.slug === last)) return last;
    return s.tenants[0].slug;
  }

  EB.tenant = {
    slug: currentSlug,
    current: () => get().tenants.find(t => t.slug === currentSlug()),
    bySlug: slug => get().tenants.find(t => t.slug === slug),
    all: () => get().tenants,
    tier: (tenant, tierId) => (tenant.tiers.find(x => x.id === tierId) || tenant.tiers[0]),
    /** save(slug, patch) — shallow merge; nested settings/colors merged too */
    save(slug, patch) {
      update(s => {
        const t = s.tenants.find(x => x.slug === slug);
        if (!t) return;
        Object.keys(patch).forEach(k => {
          if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && t[k] && typeof t[k] === 'object') {
            Object.assign(t[k], patch[k]);
          } else {
            t[k] = patch[k];
          }
        });
      });
    },
    create(data) {
      update(s => { s.tenants.push(data); });
    },
    applyTheme(t) {
      t = t || EB.tenant.current();
      const r = document.documentElement.style;
      r.setProperty('--brand', t.colors.brand);
      r.setProperty('--brand-2', t.colors.brand2);
      r.setProperty('--accent', t.colors.accent);
      r.setProperty('--brand-ink', t.colors.ink || '#fff');
    },
  };

  /* ---------- auth (mock) ---------- */
  EB.auth = {
    userId: () => safeGet(SESSION_KEY),
    user: () => { const id = safeGet(SESSION_KEY); return id ? EB.users.byId(id) : null; },
    login(id) { safeSet(SESSION_KEY, id); notify('auth'); },
    logout() { safeDel(SESSION_KEY); notify('auth'); },
  };
})();
