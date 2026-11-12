/* eBid Baju — shared UI: header/footer (tenant-branded), toasts, modals, countdowns, helpers.
 * Global: window.EB.ui, EB.money, EB.init
 * NEVER use alert/confirm/prompt — use EB.ui.modal / EB.ui.toast.
 */
(function () {
  const EB = window.EB;

  // Root URL of the site (works from /admin/ and /super/ too)
  const me = document.currentScript && document.currentScript.src;
  const ROOT = me ? me.replace(/assets\/ui\.js.*$/, '') : '';

  const money = n => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  EB.money = money;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** link('item.html', {id:'ba1'}) → absolute URL keeping ?shop= */
  function link(path, params) {
    const u = new URL(ROOT + path, location.href);
    const shop = EB.tenant.slug();
    if (!params || params.shop === undefined) u.searchParams.set('shop', shop);
    Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) u.searchParams.set(k, v); });
    return u.pathname + u.search + u.hash;
  }

  const qs = name => new URLSearchParams(location.search).get(name);

  /** "x hari hh:mm:ss" like JPJeBid, or "hh:mm:ss" under 1 day */
  function countdown(ms) {
    if (ms <= 0) return 'Tamat';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const p = n => String(n).padStart(2, '0');
    return (d ? d + ' hari ' : '') + p(h) + ':' + p(m) + ':' + p(sec);
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 10) return 'baru tadi';
    if (s < 60) return s + ' saat lalu';
    if (s < 3600) return Math.floor(s / 60) + ' minit lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    return Math.floor(s / 86400) + ' hari lalu';
  }

  const fmtDate = ts => new Date(ts).toLocaleString('ms-MY', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  /** Mask bidder names in public bid history: "Farah_88" → "Fa***88" */
  function maskName(name) {
    name = String(name || '');
    if (name.length <= 3) return name[0] + '**';
    return name.slice(0, 2) + '***' + name.slice(-2);
  }

  /* ---------- item image ----------
   * Real photos first (item.photo / item.images). Otherwise a flat catalogue swatch:
   * the garment colour, the category in serif and the size, like a lot card waiting for its photo. */
  function itemImage(item, idx) {
    idx = idx || 0;
    const real = (item.photo ? [item.photo] : []).concat(item.images || []);
    if (real.length) {
      const src = real[idx % real.length];
      return /^(data:|https?:|blob:)/.test(src) ? src : ROOT + src;
    }
    const c = item.color || '#c9ccc5';
    const x = s => String(s || '').replace(/[&<>"]/g, '');
    const inset = [24, 40, 56, 72][idx % 4]; // each placeholder view gets a different frame, so thumbnails differ
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500">
<rect width="400" height="500" fill="#eceee9"/>
<rect width="400" height="500" fill="${c}" opacity=".55"/>
<rect x="${inset}" y="${inset}" width="${400 - inset * 2}" height="${500 - inset * 2}" fill="none" stroke="#171816" stroke-opacity=".18"/>
<text x="200" y="250" font-family="Barlow Semi Condensed, Barlow, Arial, sans-serif" font-size="36" font-weight="400" fill="#171816" fill-opacity=".72" text-anchor="middle">${x(item.category)}</text>
<text x="200" y="286" font-family="Barlow, Arial, sans-serif" font-size="15" fill="#171816" fill-opacity=".55" text-anchor="middle">Saiz ${x(item.size)}</text>
<text x="${inset + 20}" y="${500 - inset - 24}" font-family="Barlow, Arial, sans-serif" font-size="13" fill="#171816" fill-opacity=".5">Gambar contoh</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ---------- badges ---------- */
  function statusBadge(st) {
    const map = {
      live: ['Langsung', 'status-live'], upcoming: ['Akan datang', 'status-upcoming'], ended: ['Tamat', 'status-ended'],
      leading: ['Tertinggi', 'status-ok'], outbid: ['Dilepasi', 'status-bad'], won: ['Menang', 'status-ok'],
      lost: ['Tidak berjaya', 'status-ended'], unpaid: ['Belum bayar', 'status-warn'], paid: ['Dibayar', 'status-ok'],
      passed: ['Dipindah', 'status-ended'], suspended: ['Digantung', 'status-bad'], active: ['Aktif', 'status-ok'],
    };
    const [label, cls] = map[st] || [st, ''];
    return `<span class="status ${cls}">${label}</span>`;
  }

  /** Catalogue lot number, stable per shop: "LOT 001" */
  function lotNo(item) {
    const list = EB.store.get().items.filter(i => i.tenant === item.tenant);
    const i = list.findIndex(x => x.id === item.id);
    return 'LOT ' + String(i < 0 ? 0 : i + 1).padStart(3, '0');
  }

  /* ---------- toast ---------- */
  function toast(msg, type) {
    let box = document.getElementById('eb-toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'eb-toasts';
      box.className = 'eb-toasts fixed z-[100] left-4 right-4 sm:left-auto flex flex-col gap-2 items-stretch sm:items-end pointer-events-none';
      document.body.appendChild(box);
    }
    const colors = { success: 'border-l-4 border-l-[var(--ok)]', error: 'border-l-4 border-l-[var(--live)]', warn: 'border-l-4 border-l-[var(--warn)]', info: '' };
    const el = document.createElement('div');
    el.className = `eb-toast pointer-events-auto ${colors[type] || colors.info} bg-[var(--ink)] text-white text-sm rounded shadow-lg px-4 py-3 sm:max-w-sm`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; }, 3600);
    setTimeout(() => el.remove(), 4000);
  }

  /* ---------- modal ----------
   * modal({ title, body: html, actions: [{label, primary, danger, onClick(close)}], onOpen(el) }) → close()
   */
  function modal(opts) {
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-[rgba(23,24,22,.55)] p-0 sm:p-4';
    wrap.innerHTML = `
      <div class="eb-modal bg-white w-full ${opts.size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-md'} rounded-t-xl sm:rounded-xl shadow-2xl max-h-[92vh] overflow-auto" role="dialog" aria-modal="true">
        <div class="flex items-start justify-between gap-4 px-5 pt-5">
          <h3 class="font-serif text-[22px] font-normal text-[var(--ink)] leading-snug">${esc(opts.title || '')}</h3>
          <button data-x class="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded text-[var(--muted)] hover:bg-[var(--tile)] hover:text-[var(--ink)]" aria-label="Tutup"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg></button>
        </div>
        <div class="px-5 py-4 text-[15px] text-[var(--ink-2)]" data-body>${opts.body || ''}</div>
        <div class="eb-modal-actions sticky bottom-0 bg-[var(--surface)] px-5 flex gap-2 justify-end border-t border-[var(--line)] pt-4" data-actions></div>
      </div>`;
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.querySelector('[data-x]').onclick = close;
    const act = wrap.querySelector('[data-actions]');
    (opts.actions || [{ label: 'Tutup' }]).forEach(a => {
      const b = document.createElement('button');
      b.className = (a.primary ? 'btn btn-brand' : a.danger ? 'btn btn-danger' : 'btn btn-outline') + ' flex-1 sm:flex-none';
      b.textContent = a.label;
      b.onclick = () => { if (a.onClick) { if (a.onClick(close, wrap) !== false) close(); } else close(); };
      act.appendChild(b);
    });
    document.body.appendChild(wrap);
    if (opts.onOpen) opts.onOpen(wrap);
    return close;
  }

  /* ---------- live countdowns: <span data-countdown-end="ts"></span> ---------- */
  function tickCountdowns() {
    const now = Date.now();
    document.querySelectorAll('[data-countdown-end]').forEach(el => {
      const end = Number(el.getAttribute('data-countdown-end'));
      const left = end - now;
      el.textContent = countdown(left);
      el.classList.toggle('is-soon', left > 0 && left < 5 * 60000);
    });
    document.querySelectorAll('[data-countdown-start]').forEach(el => {
      el.textContent = countdown(Number(el.getAttribute('data-countdown-start')) - now);
    });
  }

  /* ---------- header / footer ---------- */
  function unreadCount() {
    const u = EB.auth.userId();
    if (!u) return 0;
    return EB.store.get().inbox.filter(m => m.userId === u && !m.read && m.tenant === EB.tenant.slug()).length;
  }

  // Logo marks removed at the owner's request (2026-11-12): headers show the shop name only.
  function logoMark(t, size) {
    return '';
    const st = size ? `style="width:${size}px;height:${size}px"` : '';
    return t.logoUrl ? `<img src="${esc(t.logoUrl)}" ${st} class="logo-mark object-cover" alt="">`
      : `<span class="logo-mark" ${st}>${esc(t.logoText)}</span>`;
  }

  function logoBlock(t, sub) {
    return `<a href="${link('shop.html')}" class="flex items-center gap-3 min-w-0 min-h-[44px]">
      ${logoMark(t)}
      <span class="min-w-0"><span class="block font-semibold text-[16px] leading-tight truncate">${esc(t.name)}</span>
      <span class="block text-[12px] opacity-80 leading-tight truncate">${esc(sub || 'Sistem Bidaan Dalam Talian')}</span></span></a>`;
  }

  function dropdown(label, items, active) {
    return `<details class="eb-dd relative">
      <summary class="nav-link ${active ? 'nav-active' : ''}">${label}<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 3.5l3 3 3-3"/></svg></summary>
      <div class="eb-dd-menu">${items.map(i => `<a href="${i.href}">${i.label}</a>`).join('')}</div>
    </details>`;
  }

  /** Bidder header: menu structure mirrors JPJeBid (Peti masuk | Bidaan | Sejarah | Kegemaran | Akaun) */
  function renderHeader(active) {
    const el = document.getElementById('eb-header');
    if (!el) return;
    const t = EB.tenant.current();
    const user = EB.auth.user();
    const unread = unreadCount();
    const on = k => (active === k ? 'nav-active' : '');
    const badge = n => n ? `<span id="eb-unread" class="ml-1 min-w-[18px] rounded-sm bg-[var(--accent)] px-1 text-center text-[12px] font-semibold leading-[18px] tabular-nums text-[var(--ink)]">${n}</span>` : '';
    const nav = `
      <a href="${link('shop.html')}" class="nav-link ${on('shop')}">Utama</a>
      <a href="${link('inbox.html')}" class="nav-link ${on('inbox')}">Peti masuk${badge(unread)}</a>
      ${dropdown('Bidaan', [{ label: 'Cari item', href: link('shop.html') + '#cari' }, { label: 'Bidaan semasa saya', href: link('my-bids.html') }], active === 'bids')}
      ${dropdown('Sejarah', [{ label: 'Sejarah bidaan saya', href: link('history.html') + '#sejarah' }, { label: 'Senarai pemenang', href: link('history.html') + '#pemenang' }], active === 'history')}
      <a href="${link('favourites.html')}" class="nav-link ${on('fav')}">Kegemaran</a>
      ${dropdown('Akaun', [{ label: 'Profil', href: link('profile.html') }, { label: 'Tukar katalaluan', href: link('profile.html') + '#katalaluan' }], active === 'account')}`;
    el.innerHTML = `
      <header class="site-header">
        <div class="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          ${logoBlock(t)}
          <div class="ml-auto hidden md:flex items-center gap-3 text-[13px]">
            ${user ? `<span class="opacity-85">Selamat datang, <b class="font-semibold">${esc(user.name)}</b></span>
              <button data-logout class="btn btn-sm btn-outline">Log keluar</button>`
              : `<a href="${link('login.html')}" class="btn btn-sm btn-brand">Log masuk</a>`}
          </div>
          <button data-burger class="ml-auto md:hidden btn btn-sm btn-outline" aria-label="Buka menu${unread ? ', ' + unread + ' mesej belum dibaca' : ''}" aria-expanded="false">Menu<span data-unread-m class="${unread ? '' : 'hidden '}min-w-[18px] rounded-sm bg-[var(--accent)] px-1 text-center text-[12px] font-semibold leading-[18px] tabular-nums text-[var(--ink)]">${unread || ''}</span></button>
        </div>
        <nav data-nav class="hidden md:block border-t border-[var(--line)]">
          <div class="max-w-6xl mx-auto px-2 md:px-3 flex flex-col md:flex-row md:items-center py-1 md:py-0">
            ${nav}
            <div class="md:hidden border-t border-[var(--line)] mt-1 px-3 py-3 text-[13px]">
              ${user ? `Log masuk sebagai <b>${esc(user.name)}</b> · <button data-logout class="underline min-h-[44px] px-1">Log keluar</button>`
                : `<a href="${link('login.html')}" class="underline font-semibold inline-flex items-center min-h-[44px]">Log masuk / Daftar</a>`}
            </div>
          </div>
        </nav>
      </header>`;
    const burger = el.querySelector('[data-burger]');
    burger.onclick = () => { const n = el.querySelector('[data-nav]'); n.classList.toggle('hidden'); burger.setAttribute('aria-expanded', String(!n.classList.contains('hidden'))); };
    el.querySelectorAll('[data-logout]').forEach(b => b.onclick = () => { EB.auth.logout(); toast('Anda telah log keluar.'); location.href = link('shop.html'); });
    el.querySelectorAll('details.eb-dd').forEach(d => d.addEventListener('toggle', () => {
      if (d.open) el.querySelectorAll('details.eb-dd').forEach(o => { if (o !== d) o.open = false; });
    }));
    document.addEventListener('click', e => { if (!el.contains(e.target)) el.querySelectorAll('details.eb-dd[open]').forEach(d => d.open = false); });
  }

  /** Shop-admin header (admin/*.html): ink bar; the shop's own mark keeps the identity */
  function renderAdminHeader(active) {
    const el = document.getElementById('eb-header');
    if (!el) return;
    const t = EB.tenant.current();
    const tabs = [['index', 'Papan pemuka', 'admin/index.html'], ['items', 'Item lelongan', 'admin/items.html'], ['winners', 'Pemenang & bayaran', 'admin/winners.html'], ['settings', 'Tetapan & jenama', 'admin/settings.html']];
    el.innerHTML = `
      <header class="bg-[var(--ink)] text-white">
        <div class="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3 flex-wrap">
          ${logoMark(t, 34)}
          <div class="min-w-0"><div class="font-semibold leading-tight truncate">${esc(t.name)}</div>
          <div class="text-[12px] text-white/55 leading-tight">Panel admin · <span class="font-mono">${esc(t.domain)}</span></div></div>
          <div class="ml-auto flex items-center gap-2 text-[13px]">
            ${EB.tenant.all().length > 1 ? `<label class="sr-only" for="eb-shop-switch">Tukar kedai</label><select id="eb-shop-switch" data-shop class="h-10 md:h-8 rounded bg-white/10 px-2 text-white border border-white/15">${EB.tenant.all().map(x => `<option class="text-black" value="${x.slug}" ${x.slug === t.slug ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}
            <a href="${link('shop.html')}" class="btn btn-sm border border-white/20 text-white hover:bg-white/10">Lihat kedai</a>
          </div>
        </div>
        <nav class="max-w-6xl mx-auto px-4 md:px-6 flex gap-6 overflow-x-auto no-scrollbar text-[14px]">
          ${tabs.map(([k, l, p]) => `<a href="${link(p)}" class="whitespace-nowrap py-3 border-b-2 ${active === k ? 'border-white text-white' : 'border-transparent text-white/60 hover:text-white'}">${l}</a>`).join('')}
        </nav>
      </header>`;
    if (el.querySelector('[data-shop]')) el.querySelector('[data-shop]').onchange = e => { location.href = link(location.pathname.replace(ROOT.replace(location.origin, ''), '').replace(/^\//, ''), { shop: e.target.value }); };
  }

  /** Platform super-admin header (super/*.html) */
  function renderSuperHeader() {
    const el = document.getElementById('eb-header');
    if (!el) return;
    el.innerHTML = `
      <header class="bg-[var(--ink)] text-white">
        <div class="max-w-6xl mx-auto px-4 md:px-6 py-3 flex items-center gap-3">
          
          <div><div class="font-semibold leading-tight">${esc(window.EB_DATA.platform.name)}</div>
          <div class="text-[12px] text-white/55">Super admin platform</div></div>
          <a href="${ROOT}index.html" class="ml-auto btn btn-sm border border-white/20 text-white hover:bg-white/10">Laman platform</a>
        </div>
      </header>`;
  }

  function renderFooter() {
    const el = document.getElementById('eb-footer');
    if (!el) return;
    const t = EB.tenant.current();
    el.innerHTML = `
      <footer class="mt-20 border-t border-[var(--line)] bg-[var(--surface)]">
        <div class="max-w-6xl mx-auto px-4 md:px-6 py-6 text-[13px] text-[var(--muted)] flex flex-col md:flex-row gap-4 md:items-center">
          <div>© 2026 ${esc(t.name)} · Dikuasakan oleh <a class="eb-foot-link underline underline-offset-2" href="${ROOT}index.html">${esc(window.EB_DATA.platform.name)}</a></div>
          <div class="md:ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <span class="eyebrow">Demo</span>
            ${EB.tenant.all().length > 1 ? `<label class="sr-only" for="eb-foot-shop">Tukar kedai</label><select id="eb-foot-shop" data-shop class="input !min-h-[32px] !w-auto !py-1 text-[13px]">${EB.tenant.all().map(x => `<option value="${x.slug}" ${x.slug === t.slug ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}
            <a class="eb-foot-link underline underline-offset-2 hover:text-[var(--ink)]" href="${link('admin/index.html')}">Admin kedai</a>
            <a class="eb-foot-link underline underline-offset-2 hover:text-[var(--ink)]" href="${ROOT}super/index.html">Super admin</a>
            <button data-reset class="eb-foot-link underline underline-offset-2 text-[var(--live)]">Reset data demo</button>
          </div>
        </div>
      </footer>`;
    if (el.querySelector('[data-shop]')) el.querySelector('[data-shop]').onchange = e => { location.href = link('shop.html', { shop: e.target.value }); };
    el.querySelector('[data-reset]').onclick = () => modal({
      title: 'Reset data demo?',
      body: 'Semua bidaan, bayaran dan mesej dalam browser ini akan dipadam, dan data contoh dimuat semula.',
      actions: [{ label: 'Batal' }, { label: 'Reset data', danger: true, onClick: () => { EB.store.reset(); location.reload(); } }],
    });
  }

  /** Re-render only the unread badge when state changes */
  function refreshUnread() {
    const n = unreadCount();
    const m = document.querySelector('#eb-header [data-unread-m]');
    if (m) { m.textContent = n || ''; m.classList.toggle('hidden', !n); }
    const b = document.getElementById('eb-unread');
    if (b) { if (n) b.textContent = n; else b.remove(); }
    else if (n) {
      const a = document.querySelector('#eb-header a[href*="inbox.html"]');
      if (a) a.insertAdjacentHTML('beforeend', `<span id="eb-unread" class="ml-1 min-w-[18px] rounded-sm bg-[var(--accent)] px-1 text-center text-[12px] font-semibold leading-[18px] tabular-nums text-[var(--ink)]">${n}</span>`);
    }
  }

  /* ---------- live bids (visible realtime activity) ---------- */
  /** Connection pill: realtime across devices (server.js) or this browser only. */
  function liveStatusHtml() {
    const rt = EB.store.isRealtime && EB.store.isRealtime();
    const st = rt ? EB.store.status() : 'local';
    if (st === 'live') return '<span class="status status-live">Langsung · semua peranti</span>';
    if (st === 'offline') return '<span class="status status-warn">Menyambung semula…</span>';
    return '<span class="status status-ended">Paparan browser ini sahaja</span>';
  }

  const feedSeen = {};
  /**
   * liveFeed(el, { itemId?, limit=6, title='Bidaan langsung' }): newest bids for the current shop
   * (or one item), newest first; new rows flash. Safe to call on every render.
   */
  function liveFeed(el, opts) {
    if (!el) return;
    opts = opts || {};
    const s = EB.store.get();
    const slug = EB.tenant.slug();
    const me = EB.auth.userId();
    const bids = s.bids.filter(b => b.tenant === slug && (!opts.itemId || b.itemId === opts.itemId))
      .sort((a, b) => b.at - a.at).slice(0, opts.limit || 6);
    const key = el.id || 'feed';
    const seen = feedSeen[key] || (feedSeen[key] = new Set(bids.map(b => b.id)));
    const sig = bids.map(b => b.id).join(',') + '|' + liveStatusHtml() + '|' + Math.floor(Date.now() / 30000);
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    const oneLot = !opts.itemId && s.items.filter(i => i.tenant === slug).length <= 1;
    const rows = bids.map(b => {
      const item = s.items.find(i => i.id === b.itemId) || {};
      const who = b.userId === me ? 'Anda' : maskName(EB.users.byId(b.userId).name);
      const fresh = !seen.has(b.id);
      seen.add(b.id);
      return `<li class="flex items-baseline justify-between gap-4 py-3 ${fresh ? 'flash' : ''}">
        <div class="min-w-0"><div class="truncate ${b.userId === me ? 'font-medium' : ''}">${esc(who)}</div>
          ${opts.itemId || oneLot ? '' : `<div class="meta truncate">${esc(item.title || '')}</div>`}</div>
        <div class="text-right shrink-0"><div class="num text-[18px] whitespace-nowrap">${money(b.amount)}</div><div class="meta whitespace-nowrap">${timeAgo(b.at)}</div></div></li>`;
    }).join('');
    el.innerHTML = `
      <div class="flex flex-wrap items-baseline justify-between gap-3">
        <h2 class="font-serif text-[28px] md:text-[36px] leading-tight">${esc(opts.title || 'Bidaan langsung')}</h2>
        ${liveStatusHtml()}
      </div>
      ${bids.length ? `<ul class="mt-4 divide-y divide-[var(--line)] border-y border-[var(--line)]">${rows}</ul>`
        : `<p class="tile mt-4 p-5 text-[var(--muted)]">Belum ada bidaan. Bidaan baharu akan muncul di sini serta-merta.</p>`}`;
  }

  /** Toast when someone else bids (shop + item pages), max one every 4s. */
  let lastBidId = null, lastBidToast = 0;
  function watchBids(active) {
    if (active !== 'shop' && active !== 'bids') return;
    const newest = () => EB.store.get().bids.filter(b => b.tenant === EB.tenant.slug()).sort((a, b) => b.at - a.at)[0];
    const n0 = newest(); lastBidId = n0 ? n0.id : null;
    EB.store.subscribe(() => {
      const n = newest();
      if (!n || n.id === lastBidId) return;
      lastBidId = n.id;
      if (n.userId === EB.auth.userId() || Date.now() - lastBidToast < 4000) return;
      lastBidToast = Date.now();
      toast('Bidaan baharu ' + money(n.amount) + ' oleh ' + maskName(EB.users.byId(n.userId).name), 'info');
    });
  }

  /**
   * EB.init({ area: 'bidder'|'admin'|'super'|'platform', active: 'shop'|'inbox'|... , engine: true })
   * Applies the tenant theme, renders header/footer, starts countdowns + bot engine.
   */
  EB.init = function (opts) {
    opts = opts || {};
    const area = opts.area || 'bidder';
    if (area !== 'super' && area !== 'platform') EB.tenant.applyTheme();
    if (area === 'bidder') renderHeader(opts.active);
    if (area === 'admin') renderAdminHeader(opts.active);
    if (area === 'super') renderSuperHeader();
    if (area === 'bidder' || area === 'admin') renderFooter();
    tickCountdowns();
    setInterval(tickCountdowns, 1000);
    if (opts.engine !== false) EB.auction.startEngine();
    if (area === 'bidder') watchBids(opts.active);
    EB.store.subscribe((state, source) => {
      if (area !== 'bidder') return;
      if (source === 'auth') renderHeader(opts.active); else refreshUnread();
    });
    if (area === 'bidder' || area === 'admin') document.title = (opts.title ? opts.title + ' · ' : '') + EB.tenant.current().name;
  };

  EB.ui = {
    ROOT, link, qs, esc, money, countdown, timeAgo, fmtDate, maskName, itemImage, statusBadge, lotNo, logoMark,
    toast, modal, tickCountdowns, liveFeed, liveStatusHtml, renderHeader, renderAdminHeader, renderSuperHeader, renderFooter,
  };
})();
