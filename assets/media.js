/* eBid Baju — item video helper. Global: EB.media
 * item.video = { kind: 'youtube' | 'url' | 'upload', src, title? }
 *   youtube: src = any YouTube URL (watch, youtu.be, shorts, embed) or the 11-char id
 *   url:     src = a direct .mp4/.webm/.mov URL (or a site-relative path like assets/video/x.mp4)
 *   upload:  src = an IndexedDB key; the file stays in THIS browser only (demo). Real build: S3/R2.
 * Load after store.js + ui.js.
 */
(function () {
  const EB = window.EB;
  const DB = 'ebid_media', STORE = 'videos';
  const MAX_UPLOAD_MB = 200;
  const urlCache = {};

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('Browser ini tidak menyokong storan video.'));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idb(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Parse a pasted link → { kind, src } or null */
  function parse(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    const yt = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/) || (/^[\w-]{11}$/.test(s) ? [0, s] : null);
    if (yt) return { kind: 'youtube', src: yt[1] };
    if (/^(https?:\/\/|\/|assets\/)/.test(s) && /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(s)) return { kind: 'url', src: s };
    return null;
  }

  /** Validate + store an uploaded File. Resolves to { kind: 'upload', src: key, title, size, type } */
  async function saveUpload(file, itemId) {
    if (!file) throw new Error('Tiada fail dipilih.');
    if (!/^video\//.test(file.type)) throw new Error('Fail ini bukan video. Guna MP4, WebM atau MOV.');
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error('Video melebihi ' + MAX_UPLOAD_MB + ' MB. Sila pendekkan atau mampatkan video.');
    const key = 'vid_' + (itemId || 'item') + '_' + Date.now().toString(36);
    await idb('readwrite', st => st.put(file, key));
    return { kind: 'upload', src: key, title: file.name, size: file.size, type: file.type };
  }

  async function removeUpload(key) { try { await idb('readwrite', st => st.delete(key)); } catch (e) { /* ignore */ } delete urlCache[key]; }

  /** Resolve a playable source: { kind: 'youtube', embed } | { kind: 'file', src } | null */
  async function resolve(video) {
    if (!video || !video.src) return null;
    if (video.kind === 'youtube') return { kind: 'youtube', embed: 'https://www.youtube-nocookie.com/embed/' + video.src + '?rel=0&modestbranding=1&playsinline=1', thumb: 'https://i.ytimg.com/vi/' + video.src + '/hqdefault.jpg' };
    if (video.kind === 'url') return { kind: 'file', src: /^(https?:|\/)/.test(video.src) ? video.src : EB.ui.ROOT + video.src };
    if (video.kind === 'upload') {
      if (urlCache[video.src]) return { kind: 'file', src: urlCache[video.src] };
      const blob = await idb('readonly', st => st.get(video.src)).catch(() => null);
      if (!blob) return null; // uploaded in another browser: not available here
      urlCache[video.src] = URL.createObjectURL(blob);
      return { kind: 'file', src: urlCache[video.src] };
    }
    return null;
  }

  /** Render a responsive player into `el` (16:9 for YouTube, natural ratio for files). Returns true if shown. */
  async function mount(el, video, opts) {
    opts = opts || {};
    const r = await resolve(video);
    if (!r) { el.innerHTML = opts.emptyHtml || ''; return false; }
    const title = EB.ui.esc(video.title || 'Video lot');
    if (r.kind === 'youtube') {
      el.innerHTML = `<div style="position:relative;aspect-ratio:16/9;width:100%;background:#000;border-radius:inherit;overflow:hidden">
        <iframe src="${r.embed}" title="${title}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`;
    } else {
      el.innerHTML = `<video src="${r.src}" controls playsinline preload="metadata" ${opts.poster ? `poster="${EB.ui.esc(opts.poster)}"` : ''}
        style="display:block;width:100%;max-height:${opts.maxHeight || '70vh'};background:#000;border-radius:inherit" aria-label="${title}"></video>`;
    }
    return true;
  }

  EB.media = { parse, saveUpload, removeUpload, resolve, mount, MAX_UPLOAD_MB };
})();
