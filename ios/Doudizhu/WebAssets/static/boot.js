/* 端侧启动：同一套页面，先起 Pyodide 引擎，再把 WebSocket/fetch 接到本机。 */
(() => {
  'use strict';

  const VERSION = '20261102d';
  const APP_JS = `/static/app.js?v=${VERSION}`;
  let pyodide = null;
  let bridge = null;
  let activeSocket = null;
  let syncing = false;

  window.__MANOR_LOCAL__ = true;
  window.__MANOR_IOS__ = true;

  function splash(text) {
    let el = document.getElementById('local-splash');
    if (!el) {
      el = document.createElement('div');
      el.id = 'local-splash';
      el.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99999',
        'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
        'gap:16px', 'background:#fdf6e6', 'color:#3b3026',
        'font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif',
        'font-size:16px', 'font-weight:600',
      ].join(';');
      el.innerHTML = '<div style="width:46px;height:46px;border-radius:50%;border:4px solid rgba(79,125,87,.2);border-top-color:#4f7d57;animation:manor-spin 1s linear infinite"></div><div id="local-splash-text"></div>';
      const style = document.createElement('style');
      style.textContent = '@keyframes manor-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
      document.body.appendChild(el);
    }
    const t = document.getElementById('local-splash-text');
    if (t) t.textContent = text || '';
  }

  function hideSplash() {
    const el = document.getElementById('local-splash');
    if (el) el.remove();
  }

  function localUiPolish() {
    document.documentElement.classList.add('manor-local');
    if (document.getElementById('manor-local-style')) return;
    const style = document.createElement('style');
    style.id = 'manor-local-style';
    style.textContent = [
      '.manor-local .lan-card{display:none!important}',
      '.manor-local .ios-download{display:none!important}',
      '.manor-local .conn{display:none!important}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('脚本加载失败: ' + src));
      document.body.appendChild(s);
    });
  }

  async function syncData() {
    if (!pyodide || syncing) return;
    syncing = true;
    try {
      await new Promise((resolve) => pyodide.FS.syncfs(false, () => resolve()));
    } catch (e) {
      /* 静默，下一次重试 */
    } finally {
      syncing = false;
    }
  }

  function installWebSocketShim() {
    class LocalWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        this.url = String(url || '');
        this.readyState = LocalWebSocket.CONNECTING;
        this.binaryType = 'blob';
        this.onopen = null;
        this.onmessage = null;
        this.onerror = null;
        this.onclose = null;
        activeSocket = this;
        setTimeout(() => {
          try {
            this.readyState = LocalWebSocket.OPEN;
            if (bridge) bridge.connect();
            if (this.onopen) this.onopen({ type: 'open' });
          } catch (err) {
            if (this.onerror) this.onerror({ type: 'error', error: err });
            this.close();
          }
        }, 0);
      }

      send(data) {
        if (this.readyState !== LocalWebSocket.OPEN || !bridge) return;
        const text = String(data);
        let message = null;
        try { message = JSON.parse(text); } catch (err) { message = null; }
        if (message && message.type === 'login') scheduleAutoSync(1800);
        if (window.__manorPeerMode) {
          if (message && message.type === 'login') {
            try {
              const profileText = bridge.ensure_profile(String(message.id || ''));
              if (profileText && profileText !== '{}') {
                message.profile = JSON.parse(profileText);
              }
            } catch (err) {
              console.warn('profile snapshot failed', err);
            }
            nearbyPost({ action: 'send', text: JSON.stringify(message) });
          } else {
            nearbyPost({ action: 'send', text });
          }
          return;
        }
        try {
          bridge.handle(text);
        } catch (err) {
          if (this.onerror) this.onerror({ type: 'error', error: err });
        }
      }

      close() {
        if (this.readyState === LocalWebSocket.CLOSED) return;
        this.readyState = LocalWebSocket.CLOSED;
        if (this.onclose) this.onclose({ type: 'close' });
      }

      addEventListener(type, fn) {
        if (type === 'open') this.onopen = fn;
        if (type === 'message') this.onmessage = fn;
        if (type === 'close') this.onclose = fn;
        if (type === 'error') this.onerror = fn;
      }

      removeEventListener() {}
    }

    window.WebSocket = LocalWebSocket;
  }

  function installFetchShim() {
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const raw = typeof input === 'string' ? input : (input && input.url) || '';
      const url = new URL(raw, location.href);
      if (!url.pathname.startsWith('/api/')) {
        return realFetch(input, init);
      }
      try {
        const envelope = JSON.parse(bridge.api(url.pathname + url.search));
        const body = envelope.content_type === 'image/svg+xml'
          ? envelope.body
          : JSON.stringify(envelope.body);
        return new Response(body, {
          status: envelope.status || 200,
          headers: { 'Content-Type': envelope.content_type || 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    };
  }

  function nearbyHandler() {
    return window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.manorNearby;
  }

  function nearbyPost(payload) {
    const handler = nearbyHandler();
    if (!handler) return false;
    try {
      handler.postMessage(payload);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  function deliverToUI(text) {
    if (activeSocket && activeSocket.readyState === 1 && activeSocket.onmessage) {
      try { activeSocket.onmessage({ data: text }); } catch (err) { console.error(err); }
    }
  }

  function applyGuestState(text) {
    try {
      const msg = JSON.parse(text);
      if (msg && msg.type === 'state' && msg.me && bridge) {
        try { bridge.apply_profile(JSON.stringify(msg.me)); } catch (err) {}
      }
    } catch (err) {}
    deliverToUI(text);
  }

  window.manorNearbyEvent = function (event) {
    if (!event || typeof event !== 'object') return;
    const status = document.getElementById('nearby-status');
    const actions = document.getElementById('nearby-actions');
    const hosts = document.getElementById('nearby-hosts');
    const setStatus = (text) => { if (status) status.textContent = text; };
    if (event.type === 'hosting') {
      setStatus(`牌桌已开：${event.name}，等家人加入…`);
      if (actions) actions.classList.add('hidden');
    } else if (event.type === 'browsing') {
      setStatus('正在找附近牌桌…');
    } else if (event.type === 'connecting') {
      setStatus(`正在连 ${event.host}…`);
    } else if (event.type === 'hosts') {
      if (!hosts) return;
      const list = Array.isArray(event.hosts) ? event.hosts : [];
      hosts.innerHTML = list.length
        ? list.map((h) => `<button type="button" class="nearby-host" data-nearby-host="${String(h.id).replace(/"/g, '&quot;')}">${h.name}<small>加入</small></button>`).join('')
        : '<div class="nearby-empty">还没找到，确认另一台 iPad 已经点了“开一桌”</div>';
      hosts.querySelectorAll('[data-nearby-host]').forEach((btn) => btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-nearby-host');
        if (id) {
          nearbyPost({ action: 'join', host: id });
          setStatus(`正在连 ${id}…`);
        }
      }));
      setStatus(list.length ? '选一张牌桌加入' : '正在找附近牌桌…');
    } else if (event.type === 'joined') {
      window.__manorPeerMode = true;
      setStatus(`已加入 ${event.host} 的牌桌，现在登录/进桌`);
      if (actions) actions.classList.add('hidden');
      if (hosts) hosts.innerHTML = '';
    } else if (event.type === 'peerjoined') {
      setStatus(`家人 ${event.name} 已加入，等他准备`);
    } else if (event.type === 'peerleft') {
      setStatus(`家人 ${event.name} 离开了`);
    } else if (event.type === 'disconnected') {
      window.__manorPeerMode = false;
      setStatus('联机断开了，重新找牌桌或继续本机单机');
      if (actions) actions.classList.remove('hidden');
    } else if (event.type === 'peerdata') {
      try {
        if (bridge && event.text) bridge.host_receive(String(event.from || ''), String(event.text));
      } catch (err) { console.error(err); }
    } else if (event.type === 'data') {
      applyGuestState(String(event.text || ''));
    } else if (event.type === 'error') {
      setStatus(event.message || '联机失败');
      if (actions) actions.classList.remove('hidden');
    } else if (event.type === 'stopped') {
      window.__manorPeerMode = false;
      setStatus('已离开联机');
      if (actions) actions.classList.remove('hidden');
    }
  };

  function setupNearby() {
    if (!nearbyHandler()) return;
    if (document.getElementById('nearby-card')) return;
    const hero = document.querySelector('.entry-hero');
    if (!hero) return;
    if (!document.getElementById('nearby-style')) {
      const style = document.createElement('style');
      style.id = 'nearby-style';
      style.textContent = [
        '.nearby-card{display:flex;flex-direction:column;gap:8px;margin-top:12px;padding:12px 14px;border:2px solid rgba(92,110,74,.35);border-radius:18px;background:rgba(255,250,240,.78);box-shadow:0 6px 0 rgba(58,78,48,.09),0 12px 26px rgba(47,62,38,.12);max-width:100%}',
        '.nearby-head{display:flex;align-items:baseline;gap:8px}.nearby-head b{font-size:14px;color:#384f38}.nearby-head small{font-size:11px;color:#748167}',
        '.nearby-status{font-size:12px;line-height:1.5;color:#7d6a55}',
        '.nearby-actions{display:flex;gap:8px;flex-wrap:wrap}.nearby-btn{padding:8px 14px;border-radius:999px;border:1.5px solid rgba(79,125,87,.35);background:rgba(220,235,212,.55);color:#2f523d;font-size:12.5px;font-weight:800}.nearby-btn.primary{background:#4f7d57;color:#fff;border-color:#4f7d57}.nearby-btn:active{transform:translateY(1px)}',
        '.nearby-hosts{display:flex;flex-direction:column;gap:6px}.nearby-host{display:flex;justify-content:space-between;align-items:center;padding:8px 11px;border-radius:12px;border:1px solid rgba(110,83,59,.18);background:rgba(255,250,240,.7);font-size:13px;font-weight:700;color:#3b3026;text-align:left}.nearby-host small{font-size:11px;font-weight:700;color:#4f7d57}.nearby-empty{font-size:11.5px;color:#a8977f}',
        '.manor-local .nearby-card{display:flex!important}',
      ].join('\n');
      document.head.appendChild(style);
    }
    const card = document.createElement('div');
    card.id = 'nearby-card';
    card.className = 'nearby-card';
    card.innerHTML = [
      '<div class="nearby-head"><b>同房间联机</b><small>蓝牙/点对点 · 不用电脑服</small></div>',
      '<div class="nearby-status" id="nearby-status">两台 iPad 各开一台：一台开桌，另一台找桌</div>',
      '<div class="nearby-actions" id="nearby-actions">',
      '<button type="button" class="nearby-btn primary" data-nearby-host-start>开一桌</button>',
      '<button type="button" class="nearby-btn" data-nearby-browse>找牌桌</button>',
      '</div>',
      '<div class="nearby-hosts" id="nearby-hosts"></div>',
    ].join('');
    const anchor = hero.querySelector('.ios-card, .lan-card');
    if (anchor && anchor.parentNode === hero) anchor.insertAdjacentElement('afterend', card);
    else hero.appendChild(card);
    const currentName = () => {
      const el = document.getElementById('player-id');
      const value = el && el.value ? String(el.value).trim() : '';
      return value || '家人';
    };
    card.querySelector('[data-nearby-host-start]').addEventListener('click', () => {
      if (window.__manorPeerMode) return;
      nearbyPost({ action: 'host', name: currentName() });
      if (document.getElementById('nearby-status')) document.getElementById('nearby-status').textContent = '正在开桌…';
    });
    card.querySelector('[data-nearby-browse]').addEventListener('click', () => {
      if (window.__manorPeerMode) return;
      nearbyPost({ action: 'browse', name: currentName() });
      if (document.getElementById('nearby-status')) document.getElementById('nearby-status').textContent = '正在找附近牌桌…';
    });
  }

  function otaHandler() {
    return window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.manorOta;
  }

  function otaPost(payload) {
    const handler = otaHandler();
    if (!handler) return false;
    try {
      handler.postMessage(payload);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  window.manorOtaEvent = function (event) {
    if (!event || typeof event !== 'object') return;
    const status = document.getElementById('ota-status');
    const version = document.getElementById('ota-version');
    const input = document.getElementById('ota-source-input');
    const setStatus = (text) => { if (status) status.textContent = text; };
    if (event.type === 'status') {
      if (version) {
        const active = event.activeVersion ? ` · 已更新 ${event.activeVersion}` : '';
        version.textContent = `v${event.effectiveVersion || '未知'}${active}`;
      }
      if (input && document.activeElement !== input && event.baseURL) {
        input.value = event.baseURL;
      }
      if (event.checking) setStatus('正在检查更新…');
      else if (event.lastError) setStatus(`更新源暂时连不上：${event.lastError}（单机不受影响）`);
      else if (event.lastChecked) setStatus(`上次检查：${event.lastChecked}`);
    } else if (event.type === 'checking') {
      setStatus('正在检查更新…');
    } else if (event.type === 'downloading') {
      const pct = event.totalBytes > 0 ? Math.round((event.doneBytes / event.totalBytes) * 100) : 0;
      setStatus(`正在下载离线包 ${pct}%${event.total ? `（${event.done}/${event.total}）` : ''}…`);
    } else if (event.type === 'latest') {
      setStatus('已经是最新离线包');
    } else if (event.type === 'ready') {
      setStatus(`新离线包 ${event.version} 已装好，下次打开自动生效`);
    } else if (event.type === 'needsShell') {
      setStatus(`新包需要 0.5.0 以上的安装包（${event.minShell}），先更新一次 IPA`);
    } else if (event.type === 'sourceSaved') {
      setStatus('服务器地址已保存');
      const panel = document.getElementById('ota-source');
      if (panel) panel.classList.add('hidden');
    } else if (event.type === 'error') {
      setStatus(`${event.message || '更新失败'}（单机不受影响）`);
    }
  };

  function syncHandler() {
    return window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.manorSync;
  }

  function syncPost(payload) {
    const handler = syncHandler();
    if (!handler) return false;
    try {
      handler.postMessage(payload);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  window.manorSyncEvent = function (event) {
    if (!event || typeof event !== 'object') return;
    const status = document.getElementById('sync-status');
    const setStatus = (text) => { if (status) status.textContent = text; };
    if (event.type === 'status') {
      if (event.lastSync) setStatus(`档案上次同步：${event.lastSync}`);
      else setStatus('连上家中服务器后自动合并档案');
    } else if (event.type === 'syncing') {
      setStatus('正在和家中服务器合并档案…');
    } else if (event.type === 'done') {
      let merged = 0;
      try {
        if (bridge && event.payload) {
          const result = JSON.parse(bridge.sync_import(JSON.stringify(event.payload)));
          merged = Array.isArray(result.players) ? result.players.length : 0;
        }
      } catch (err) {
        console.error(err);
      }
      setStatus(`同步完成：合并了 ${merged || event.count || 0} 个档案`);
    } else if (event.type === 'noLocal') {
      setStatus('本机还没有档案，先登录一次再同步');
    } else if (event.type === 'error') {
      setStatus(event.quiet ? '家中服务器暂时连不上，单机照常玩' : `同步失败：${event.message || '未知错误'}`);
    }
  };

  let lastAutoSyncAt = 0;

  function syncNow(auto) {
    if (!bridge || !syncHandler()) return;
    if (auto && Date.now() - lastAutoSyncAt < 60000) return;
    let payload = { players: [] };
    try {
      payload = JSON.parse(bridge.sync_export());
    } catch (err) {
      payload = { players: [] };
    }
    const hasPlayers = payload && Array.isArray(payload.players) && payload.players.length > 0;
    if (auto && !hasPlayers) return;
    lastAutoSyncAt = Date.now();
    syncPost({ action: 'sync', payload: payload || { players: [] }, auto: !!auto });
  }

  function scheduleAutoSync(delay) {
    setTimeout(() => syncNow(true), delay || 2500);
  }

  function setupOta() {
    if (!otaHandler()) return;
    if (document.getElementById('ota-card')) return;
    const hero = document.querySelector('.entry-hero');
    if (!hero) return;
    if (!document.getElementById('ota-style')) {
      const style = document.createElement('style');
      style.id = 'ota-style';
      style.textContent = [
        '.ota-card{display:flex;flex-direction:column;gap:8px;margin-top:12px;padding:12px 14px;border:2px dashed rgba(92,110,74,.28);border-radius:18px;background:rgba(255,250,240,.62);max-width:100%}',
        '.ota-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.ota-head b{font-size:14px;color:#384f38}.ota-head small{font-size:11px;color:#748167}',
        '.ota-status{font-size:12px;line-height:1.5;color:#7d6a55}',
        '.sync-status{font-size:12px;line-height:1.5;color:#5f7a5a;margin-top:-2px}',
        '.ota-actions{display:flex;gap:8px;flex-wrap:wrap}.ota-btn{padding:8px 14px;border-radius:999px;border:1.5px solid rgba(79,125,87,.3);background:rgba(220,235,212,.4);color:#2f523d;font-size:12.5px;font-weight:800}.ota-btn.primary{background:#4f7d57;color:#fff;border-color:#4f7d57}.ota-btn:active{transform:translateY(1px)}',
        '.ota-source{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ota-source input{flex:1 1 180px;min-width:0;padding:8px 11px;border-radius:12px;border:1px solid rgba(110,83,59,.22);background:rgba(255,250,240,.9);font-size:12px;color:#3b3026}',
        '.manor-local .ota-card{display:flex!important}',
      ].join('\n');
      document.head.appendChild(style);
    }
    const card = document.createElement('div');
    card.id = 'ota-card';
    card.className = 'ota-card';
    card.innerHTML = [
      '<div class="ota-head"><b>家中服务器</b><small id="ota-version">读取中…</small></div>',
      '<div class="ota-status" id="ota-status">单机也能玩；有网时从家里服务器检查更新</div>',
      '<div class="sync-status" id="sync-status">连上家中服务器后自动合并档案</div>',
      '<div class="ota-actions">',
      '<button type="button" class="ota-btn primary" data-ota-check>检查更新</button>',
      '<button type="button" class="ota-btn" data-sync-now>同步数据</button>',
      '<button type="button" class="ota-btn" data-ota-source-toggle>服务器</button>',
      '</div>',
      '<div class="ota-source hidden" id="ota-source">',
      '<input id="ota-source-input" type="url" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="http://192.168.31.182:8000">',
      '<button type="button" class="ota-btn" data-ota-source-save>保存</button>',
      '</div>',
    ].join('');
    const nearby = document.getElementById('nearby-card');
    if (nearby && nearby.parentNode === hero) nearby.insertAdjacentElement('afterend', card);
    else hero.appendChild(card);
    card.querySelector('[data-ota-check]').addEventListener('click', () => {
      document.getElementById('ota-status').textContent = '正在检查更新…';
      otaPost({ action: 'check', manual: true });
    });
    card.querySelector('[data-sync-now]').addEventListener('click', () => {
      document.getElementById('sync-status').textContent = '正在同步…';
      syncNow(false);
    });
    card.querySelector('[data-ota-source-toggle]').addEventListener('click', () => {
      const panel = document.getElementById('ota-source');
      if (panel) panel.classList.toggle('hidden');
    });
    card.querySelector('[data-ota-source-save]').addEventListener('click', () => {
      const input = document.getElementById('ota-source-input');
      const value = input && input.value ? String(input.value).trim() : '';
      if (!value) return;
      otaPost({ action: 'setBase', base: value });
    });
    otaPost({ action: 'status' });
    otaPost({ action: 'check', auto: true });
    syncPost({ action: 'status' });
  }

  function installSender() {
    window.__manorSend = (text) => {
      if (activeSocket && activeSocket.readyState === 1 && activeSocket.onmessage) {
        try { activeSocket.onmessage({ data: text }); } catch (err) { console.error(err); }
      }
    };
    window.manorHostSend = (peer, text) => {
      nearbyPost({ action: 'send', to: String(peer), text: String(text) });
    };
  }

  async function boot() {
    localUiPolish();
    splash('正在唤醒本机牌桌…');
    await loadScript('/pyodide/pyodide.js');
    pyodide = await loadPyodide({ indexURL: '/pyodide/' });
    pyodide.setStderr({ batched: (s) => console.warn('[py]', s) });
    pyodide.setStdout({ batched: (s) => console.log('[py]', s) });
    splash('正在加载牌局引擎…');
    await pyodide.loadPackage('/packages/numpy-2.0.2-cp312-cp312-pyodide_2024_0_wasm32.whl');
    const buf = await (await fetch('/app-core.zip')).arrayBuffer();
    await pyodide.unpackArchive(new Uint8Array(buf), 'zip');
    splash('正在加载 DouZero 权重…');
    if (!pyodide.FS.analyzePath('/models').exists) pyodide.FS.mkdir('/models');
    const mBuf = await (await fetch('/models.zip')).arrayBuffer();
    await pyodide.unpackArchive(new Uint8Array(mBuf), 'zip', { extractDir: '/models' });

    if (!pyodide.FS.analyzePath('/data').exists) pyodide.FS.mkdir('/data');
    try {
      pyodide.FS.mount(pyodide.IDBFS, {}, '/data');
    } catch (err) {
      // 已挂载时忽略
    }
    await new Promise((resolve, reject) => pyodide.FS.syncfs(true, (err) => err ? reject(err) : resolve()));

    await pyodide.runPythonAsync(`
import sys
sys.path.insert(0, '/home/pyodide')
import local_bridge
local_bridge.init('/data')
`);
    bridge = pyodide.globals.get('local_bridge');

    installSender();
    installWebSocketShim();
    installFetchShim();
    splash('正在铺牌桌…');
    await loadScript(APP_JS);
    setupNearby();
    setupOta();
    scheduleAutoSync(4000);
    hideSplash();
    setInterval(syncData, 2000);
    window.addEventListener('pagehide', syncData);
  }

  boot().catch((err) => {
    console.error(err);
    splash('本机引擎启动失败：' + (err && err.message ? err.message : err));
  });
})();
