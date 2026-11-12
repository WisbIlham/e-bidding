/* Shared helpers for the hall-auction pages: polling api.php, money/time format, escaping. */
(function () {
  const API = (document.querySelector('meta[name="api"]') || {}).content || 'api.php';

  const money = n => 'RM' + Number(n || 0).toLocaleString('en-MY', { maximumFractionDigits: 0 });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = t => new Date(t * 1000).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  /* Poll the public state. onState(state, changed) runs on first load and on every change.
   * onConn(ok) reports connection health. Pauses while the tab is hidden. */
  function watch(onState, onConn, every = 2000) {
    let version = -1, state = null, timer = null, fails = 0;
    async function tick() {
      clearTimeout(timer);
      try {
        const r = await fetch(API + '?v=' + version + '&_=' + Date.now(), { cache: 'no-store' });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'ralat');
        fails = 0; onConn && onConn(true);
        if (!j.same) { const changed = state !== null; state = j.state; version = j.state.version; onState(state, changed); }
      } catch (e) { fails++; onConn && onConn(false, fails); }
      timer = setTimeout(tick, document.hidden ? 8000 : (fails ? Math.min(10000, every * (fails + 1)) : every));
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    tick();
    return { refresh: tick };
  }

  window.Live = { API, money, esc, time, watch };
})();
