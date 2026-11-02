/* 端侧启动：同一套页面，先起 Pyodide 引擎，再把 WebSocket/fetch 接到本机。 */
(() => {
  'use strict';

  const VERSION = '20261113a';
  const APP_JS = `/static/app.js?v=${VERSION}`;
  let pyodide = null;
  let bridge = null;
  let activeSocket = null;
  let syncing = false;
  let pendingLoginText = null;

  let currentStage = 'boot';
  let homeServerBase = 'http://192.168.31.182:8000';
  let bootTrace = [];
  const BOOT_TRACE_LIMIT = 40;
  let failureReported = false;

  const REMOTE_USERS = new Set(['喵喵', '猫猫']);
  const REMOTE_PEER = 'webrtc:guest';
  const REMOTE_ICE = [
    { urls: 'stun:stun.miwifi.com:3478' },
    { urls: 'stun:stun.qq.com:3478' },
    { urls: 'stun:stun.chat.bilibili.com:3478' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  let remoteSession = null;
  let remoteProfileId = '';
  let remoteUi = null;
  let remoteModal = null;
  let remoteLastStatus = '';
  let remoteLastError = false;

  function diagHandler() {
    return window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.manorDiag;
  }

  function diagPost(payload) {
    const handler = diagHandler();
    if (!handler) return false;
    try {
      handler.postMessage(payload);
      return true;
    } catch (err) {
      return false;
    }
  }

  function hasNativeDiag() {
    return !!diagHandler();
  }

  function serverBase() {
    return String(homeServerBase || '').replace(/\/+$/, '');
  }

  function trace(event, detail) {
    try {
      bootTrace.push({
        at: new Date().toISOString(),
        event: String(event || 'event'),
        detail: detail || {},
      });
      if (bootTrace.length > BOOT_TRACE_LIMIT) bootTrace.shift();
    } catch (err) { /* diagnostics must never break boot */ }
  }

  function setStage(name, detail) {
    currentStage = String(name || 'unknown');
    trace('boot.stage', { stage: currentStage, webVersion: VERSION, extra: detail || {} });
    diagPost({ action: 'stage', stage: currentStage, webVersion: VERSION });
  }

  function directUploadFailure(err) {
    if (hasNativeDiag()) return;
    const message = String((err && err.message) || err || 'unknown');
    const payload = {
      schema: 1,
      reason: 'bootError',
      source: 'ios-web',
      sentAt: new Date().toISOString(),
      device: {
        name: String(navigator.platform || 'ios-web'),
        model: String(navigator.userAgent || ''),
        system: String(navigator.userAgent || ''),
      },
      app: {},
      web: { version: VERSION, stage: currentStage },
      events: bootTrace.concat([{
        at: new Date().toISOString(),
        event: 'boot.error',
        level: 'error',
        detail: { message: message.slice(0, 2000), stage: currentStage },
      }]),
    };
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', serverBase() + '/api/clientlog', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.timeout = 8000;
      xhr.send(JSON.stringify(payload));
    } catch (ignored) { /* native logger will retry on next launch */ }
  }

  function reportBootFailure(err, stage) {
    if (failureReported) return;
    failureReported = true;
    const message = String((err && err.message) || err || 'unknown');
    const stack = String((err && err.stack) || '');
    trace('boot.error', { stage: stage || currentStage, message: message.slice(0, 2000) });
    diagPost({
      action: 'bootError',
      message: message.slice(0, 2000),
      stack: stack.slice(0, 4000),
      detail: { stage: stage || currentStage, webVersion: VERSION, trace: bootTrace },
    });
    directUploadFailure(err);
  }

  window.__manorBootTrace = bootTrace;
  window.addEventListener('error', (event) => {
    if (hasNativeDiag() || window.__MANOR_READY__) return;
    reportBootFailure(event.error || new Error(String(event.message || 'window error')), currentStage);
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (hasNativeDiag() || window.__MANOR_READY__) return;
    const reason = event.reason;
    reportBootFailure(reason instanceof Error ? reason : new Error(String(reason)), currentStage);
  });

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
        if (message && message.type === 'login' && !window.__manorPeerMode
            && queueLoginForSync(text, message)) {
          return;
        }
        if (window.__manorPeerMode) {
          let outbound = text;
          if (message && message.type === 'login') {
            try {
              const profileText = bridge.ensure_profile(String(message.id || ''));
              if (profileText && profileText !== '{}') {
                message.profile = JSON.parse(profileText);
              }
            } catch (err) {
              console.warn('profile snapshot failed', err);
            }
            outbound = JSON.stringify(message);
          }
          if (window.__manorRemoteGuest && remoteSession && remoteSession.dc
              && remoteSession.dc.readyState === 'open') {
            try { remoteSession.dc.send(String(outbound)); return; } catch (err) { console.error(err); }
          }
          nearbyPost({ action: 'send', text: outbound });
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
      window.__manorAiHost = '本机 iPad';
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
      window.__manorAiHost = `${event.host || '房主'} 的 iPad`;
      setStatus(`已加入 ${event.host} 的牌桌，现在登录/进桌`);
      if (actions) actions.classList.add('hidden');
      if (hosts) hosts.innerHTML = '';
    } else if (event.type === 'peerjoined') {
      setStatus(`家人 ${event.name} 已加入，等他准备`);
    } else if (event.type === 'peerleft') {
      setStatus(`家人 ${event.name} 离开了`);
    } else if (event.type === 'disconnected') {
      window.__manorPeerMode = false;
      window.__manorAiHost = '';
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
      window.__manorAiHost = '';
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
      window.__manorAiHost = '本机 iPad';
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
      if (event.baseURL) homeServerBase = String(event.baseURL);
      if (version) {
        const shell = event.shellVersion ? `客户端 v${event.shellVersion}` : '';
        const web = event.effectiveVersion ? `离线包 v${event.effectiveVersion}` : '';
        version.textContent = [shell, web].filter(Boolean).join(' · ') || '版本未知';
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
      let historyAdded = 0;
      try {
        if (bridge && event.payload) {
          const result = JSON.parse(bridge.sync_import(JSON.stringify(event.payload)));
          merged = Array.isArray(result.players) ? result.players.length : 0;
          historyAdded = Number(result.history_added || event.historyAdded || 0);
        }
      } catch (err) {
        console.error(err);
      }
      setStatus(`同步完成：档案 ${merged || event.count || 0} 个，牌谱新增 ${historyAdded} 局`);
      diagPost({ action: 'log', level: 'info', event: 'sync.done',
        detail: { players: merged || event.count || 0, history_added: historyAdded } });
      notifySyncFinished();
    } else if (event.type === 'noLocal') {
      setStatus('本机还没有档案，先登录一次再同步');
      notifySyncFinished();
    } else if (event.type === 'error') {
      setStatus(event.quiet ? '家中服务器暂时连不上，单机照常玩' : `同步失败：${event.message || '未知错误'}`);
      diagPost({ action: 'log', level: 'error', event: 'sync.error',
        detail: { message: event.message || 'sync failed', quiet: !!event.quiet } });
      notifySyncFinished();
    }
  };

  function notifySyncFinished() {
    try { window.dispatchEvent(new Event('manor-sync-finished')); } catch (err) {}
  }

  let lastAutoSyncAt = 0;

  function syncNow(auto) {
    if (!bridge) return;
    if (auto && Date.now() - lastAutoSyncAt < 60000) return;
    let payload = { players: [], history: [] };
    try {
      payload = JSON.parse(bridge.sync_export());
    } catch (err) {
      payload = { players: [], history: [] };
    }
    const hasPlayers = payload && Array.isArray(payload.players) && payload.players.length > 0;
    lastAutoSyncAt = Date.now();
    if (!hasPlayers || !syncHandler()) {
      // 新设备还没有本机档案，原生同步会拒绝空 payload；直接拉服务器全家档案。
      directPull();
      return;
    }
    syncPost({ action: 'sync', payload: payload || { players: [] }, auto: !!auto });
  }

  function scheduleAutoSync(delay) {
    setTimeout(() => syncNow(true), delay || 2500);
  }

  function directPull() {
    if (!bridge) return;
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', serverBase() + '/api/sync/data', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.timeout = 8000;
      xhr.onload = function () {
        if (xhr.status !== 200) return;
        try {
          const data = JSON.parse(xhr.responseText);
          if (!data || !Array.isArray(data.players)) return;
          bridge.sync_import(JSON.stringify(data));
          diagPost({ action: 'log', level: 'info', event: 'sync.pull',
            detail: { players: data.players.length, history: (data.history || []).length } });
          notifySyncFinished();
        } catch (err) { console.error(err); }
      };
      xhr.send(JSON.stringify({ players: [], history: [] }));
    } catch (err) {
      console.error(err);
    }
  }

  function maybeSyncAfterState(text) {
    try {
      const msg = JSON.parse(String(text || ''));
      if (!msg || msg.type !== 'state') return;
      const ended = msg.phase === 'ended' || (msg.game && msg.game.phase === 'ended');
      if (ended) setTimeout(() => syncNow(true), 1800);
    } catch (err) { /* not a state message */ }
  }

  function syncAndWait(timeoutMs) {
    if (!syncHandler() || !bridge) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('manor-sync-finished', finish);
        resolve(true);
      };
      const timer = setTimeout(finish, timeoutMs || 2600);
      window.addEventListener('manor-sync-finished', finish);
      syncNow(false);
    });
  }

  // ID 就是登录态：先把该 ID（以及服务器上的家人档案）合并回来，再真正 attach。
  // 服务器连不上时最多等 2.6 秒，随后用本地缓存登录，不破坏离线。
  function queueLoginForSync(text, message) {
    if (!bridge || !syncHandler() || window.__manorPeerMode) return false;
    const id = String((message && message.id) || '').trim();
    if (!id) return false;
    try {
      const profileText = bridge.ensure_profile(id);
      if (!profileText || profileText === '{}') return false;
    } catch (err) {
      return false;
    }
    pendingLoginText = text;
    syncAndWait(2600).then(() => {
      if (pendingLoginText !== text) return;
      pendingLoginText = null;
      try {
        bridge.handle(text);
      } catch (err) {
        if (activeSocket && activeSocket.onerror) activeSocket.onerror({ type: 'error', error: err });
      }
    });
    return true;
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


  // ---------------------------------------------------------- remote WebRTC
  // 仅猫猫/喵喵：两段邀请码/应答码，无信令服务器；牌桌和 AI 仍在开桌设备。

  function remoteAllowed(raw) {
    return REMOTE_USERS.has(String(raw || '').trim());
  }

  function remoteDefaultStatus() {
    if (remoteSession && remoteSession.connected) {
      return remoteSession.role === 'host'
        ? '已连接家人；AI 在这台 iPad 上推理'
        : `已连上 ${remoteSession.hostName || '房主'}；AI 在房主 iPad 上推理`;
    }
    if (remoteSession && remoteSession.role === 'host' && remoteSession.offerCode) return '房间已开，等待对方应答';
    if (remoteSession && remoteSession.role === 'guest' && remoteSession.answerCode) return '应答码已生成，等待房主连接';
    return 'WebRTC 直连 · 仅猫猫/喵喵 · 不需要服务器';
  }

  function remoteSetStatus(text, isError) {
    remoteLastStatus = String(text || '');
    remoteLastError = !!isError;
    remoteRefreshUi();
  }

  function remoteRefreshUi() {
    if (remoteUi) {
      remoteUi.status.textContent = remoteLastStatus || remoteDefaultStatus();
      remoteUi.status.style.color = remoteLastError ? '#b24b3d' : '#5f7a5a';
      remoteUi.button.textContent = remoteSession ? '查看远程房间' : '远程互动';
    }
    if (remoteModal) {
      const status = remoteModal.querySelector('[data-remote-modal-status]');
      if (status) {
        status.textContent = remoteLastStatus || remoteDefaultStatus();
        status.style.color = remoteLastError ? '#b24b3d' : '#5f7a5a';
      }
      const hostOffer = remoteModal.querySelector('[data-remote-offer-box]');
      const guestAnswer = remoteModal.querySelector('[data-remote-answer-box]');
      const offerField = remoteModal.querySelector('[data-remote-offer]');
      const answerField = remoteModal.querySelector('[data-remote-answer]');
      const hostSession = remoteSession && remoteSession.role === 'host';
      const guestSession = remoteSession && remoteSession.role === 'guest';
      if (hostOffer) hostOffer.classList.toggle('hidden', !(hostSession && remoteSession.offerCode));
      if (guestAnswer) guestAnswer.classList.toggle('hidden', !(guestSession && remoteSession.answerCode));
      if (offerField && hostSession && remoteSession.offerCode) offerField.value = remoteSession.offerCode;
      if (answerField && guestSession && remoteSession.answerCode) answerField.value = remoteSession.answerCode;
      const reset = remoteModal.querySelector('[data-remote-reset]');
      if (reset) reset.classList.toggle('hidden', !remoteSession);
      const hostConnect = remoteModal.querySelector('[data-remote-host-connect]');
      if (hostConnect) hostConnect.disabled = !(hostSession && remoteSession.offerCode);
    }
  }

  function remoteInjectStyle() {
    if (document.getElementById('remote-style')) return;
    const style = document.createElement('style');
    style.id = 'remote-style';
    style.textContent = [
      '.remote-card{display:flex;flex-direction:column;gap:8px;margin-top:12px;padding:12px 14px;border:2px solid rgba(79,125,87,.34);border-radius:18px;background:rgba(255,250,240,.74);box-shadow:0 6px 0 rgba(58,78,48,.09),0 12px 26px rgba(47,62,38,.12);max-width:100%}',
      '.remote-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.remote-head b{font-size:14px;color:#384f38}.remote-head small{font-size:11px;color:#748167}',
      '.remote-status{font-size:12px;line-height:1.5;color:#5f7a5a}',
      '.remote-actions{display:flex;gap:8px;flex-wrap:wrap}',
      '.remote-btn{padding:8px 14px;border-radius:999px;border:1.5px solid rgba(79,125,87,.35);background:rgba(220,235,212,.55);color:#2f523d;font-size:12.5px;font-weight:800;cursor:pointer}',
      '.remote-btn.primary{background:#4f7d57;color:#fff;border-color:#4f7d57}',
      '.remote-btn:disabled{opacity:.45;cursor:default}',
      '.remote-btn:active{transform:translateY(1px)}',
      '.remote-mask{position:fixed;inset:0;z-index:300000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(36,48,35,.56);backdrop-filter:blur(5px)}',
      '.remote-panel{width:min(560px,100%);max-height:90vh;overflow:auto;background:#fffaf0;border:2px solid rgba(79,125,87,.35);border-radius:22px;box-shadow:0 18px 60px rgba(25,35,25,.28);padding:18px;color:#3b3026}',
      '.remote-title{display:flex;align-items:center;gap:10px}.remote-title b{font-size:20px;flex:1}.remote-close{width:34px;height:34px;border-radius:50%;border:1px solid rgba(110,83,59,.2);background:#f4ead7;font-size:20px;line-height:1;color:#6b5a46}',
      '.remote-sub{font-size:12px;color:#7d6a55;margin:4px 0 12px}',
      '.remote-tabs{display:flex;gap:8px;margin-bottom:12px}.remote-tab{flex:1;padding:8px 10px;border-radius:12px;border:1.5px solid rgba(79,125,87,.25);background:#f6f0e1;color:#5d6f52;font-size:13px;font-weight:800}.remote-tab.active{background:#4f7d57;color:#fff;border-color:#4f7d57}',
      '.remote-panel-body{display:flex;flex-direction:column;gap:9px}.remote-panel-body p{font-size:12.5px;line-height:1.6;color:#6b5a46;margin:0 0 2px}',
      '.remote-label{font-size:12px;font-weight:800;color:#5d6f52;margin-top:2px}',
      '.remote-code{width:100%;box-sizing:border-box;min-height:86px;resize:vertical;border:1.5px solid rgba(110,83,59,.18);border-radius:12px;background:#fffaf0;padding:8px 10px;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;color:#4a4038;word-break:break-all}',
      '.remote-code-row{display:flex;gap:8px;flex-wrap:wrap}',
      '.remote-modal-status{font-size:12px;line-height:1.55;margin-top:10px;color:#5f7a5a;min-height:18px}',
      '.remote-footer{display:flex;justify-content:flex-end;margin-top:12px}',
      '.remote-small{padding:6px 10px;font-size:11px}',
      '.manor-local .remote-card{display:flex!important}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function remoteBuildCard() {
    if (remoteUi || !window.__MANOR_IOS__) return;
    const hero = document.querySelector('.entry-hero');
    if (!hero) return;
    remoteInjectStyle();
    const card = document.createElement('div');
    card.id = 'remote-card';
    card.className = 'remote-card';
    card.style.display = 'none';
    card.innerHTML = [
      '<div class="remote-head"><b>远程互动</b><small>WebRTC 直连 · 仅猫猫/喵喵</small></div>',
      '<div class="remote-status" id="remote-card-status">WebRTC 直连 · 仅猫猫/喵喵 · 不需要服务器</div>',
      '<div class="remote-actions"><button type="button" class="remote-btn primary" data-remote-open>远程互动</button></div>',
    ].join('');
    const anchor = document.getElementById('ota-card') || document.getElementById('nearby-card') || hero.querySelector('.ios-card');
    if (anchor && anchor.parentNode === hero) anchor.insertAdjacentElement('afterend', card);
    else hero.appendChild(card);
    remoteUi = {
      card,
      status: card.querySelector('#remote-card-status'),
      button: card.querySelector('[data-remote-open]'),
    };
    remoteUi.button.addEventListener('click', () => remoteOpenModal());
  }

  window.manorRemoteSetup = function (rawId) {
    if (!window.__MANOR_IOS__) return;
    remoteProfileId = String(rawId || '').trim();
    if (!remoteUi) remoteBuildCard();
    if (!remoteUi) return;
    const show = remoteAllowed(remoteProfileId) || !!remoteSession;
    remoteUi.card.style.display = show ? '' : 'none';
    if (show) remoteRefreshUi();
  };

  function remoteBuildModal() {
    if (remoteModal) return;
    remoteInjectStyle();
    const mask = document.createElement('div');
    mask.id = 'remote-modal';
    mask.className = 'remote-mask';
    mask.style.display = 'none';
    mask.innerHTML = [
      '<div class="remote-panel">',
      '  <div class="remote-title"><b>远程互动</b><button type="button" class="remote-close" data-remote-close aria-label="关闭">×</button></div>',
      '  <div class="remote-sub">WebRTC 点对点直连 · 仅猫猫/喵喵 · 牌桌和 AI 在开桌设备上</div>',
      '  <div class="remote-tabs"><button type="button" class="remote-tab" data-remote-tab="host">我要开房</button><button type="button" class="remote-tab" data-remote-tab="guest">我要加入</button></div>',
      '  <div class="remote-panel-body" data-remote-panel="host">',
      '    <p>开一间房，把邀请码发给对方；对方回应答码后，粘贴到这里连接。</p>',
      '    <button type="button" class="remote-btn primary" data-remote-host-start>开一间房</button>',
      '    <div class="hidden" data-remote-offer-box>',
      '      <div class="remote-label">邀请码（发给对方）</div>',
      '      <textarea class="remote-code" data-remote-offer readonly></textarea>',
      '      <div class="remote-code-row"><button type="button" class="remote-btn remote-small" data-remote-copy-offer>复制邀请码</button><button type="button" class="remote-btn remote-small" data-remote-share-offer>分享</button></div>',
      '      <div class="remote-label">对方发来的应答码</div>',
      '      <textarea class="remote-code" data-remote-answer-input placeholder="粘贴对方发来的应答码"></textarea>',
      '      <button type="button" class="remote-btn primary" data-remote-host-connect>连接</button>',
      '    </div>',
      '  </div>',
      '  <div class="remote-panel-body hidden" data-remote-panel="guest">',
      '    <p>粘贴房主发来的邀请码，生成应答码发回去；房主连接后就能进桌。</p>',
      '    <div class="remote-label">邀请码</div>',
      '    <textarea class="remote-code" data-remote-offer-input placeholder="粘贴房主发来的邀请码"></textarea>',
      '    <button type="button" class="remote-btn primary" data-remote-guest-answer>生成应答码</button>',
      '    <div class="hidden" data-remote-answer-box>',
      '      <div class="remote-label">应答码（发回给房主）</div>',
      '      <textarea class="remote-code" data-remote-answer readonly></textarea>',
      '      <div class="remote-code-row"><button type="button" class="remote-btn remote-small" data-remote-copy-answer>复制应答码</button><button type="button" class="remote-btn remote-small" data-remote-share-answer>分享</button></div>',
      '    </div>',
      '  </div>',
      '  <div class="remote-modal-status" data-remote-modal-status></div>',
      '  <div class="remote-footer"><button type="button" class="remote-btn remote-small hidden" data-remote-reset>重置连接</button></div>',
      '</div>',
    ].join('');
    document.body.appendChild(mask);
    remoteModal = mask;
    mask.querySelector('[data-remote-close]').addEventListener('click', () => { mask.style.display = 'none'; });
    mask.querySelectorAll('[data-remote-tab]').forEach((btn) => btn.addEventListener('click', () => remoteSetTab(btn.getAttribute('data-remote-tab'))));
    mask.querySelector('[data-remote-host-start]').addEventListener('click', () => remoteHostStart());
    mask.querySelector('[data-remote-host-connect]').addEventListener('click', () => remoteHostConnect());
    mask.querySelector('[data-remote-guest-answer]').addEventListener('click', () => remoteGuestAnswer());
    mask.querySelector('[data-remote-copy-offer]').addEventListener('click', () => remoteCopy('[data-remote-offer]'));
    mask.querySelector('[data-remote-copy-answer]').addEventListener('click', () => remoteCopy('[data-remote-answer]'));
    mask.querySelector('[data-remote-share-offer]').addEventListener('click', () => remoteShare('[data-remote-offer]'));
    mask.querySelector('[data-remote-share-answer]').addEventListener('click', () => remoteShare('[data-remote-answer]'));
    mask.querySelector('[data-remote-reset]').addEventListener('click', () => remoteReset(false));
  }

  function remoteSetTab(tab) {
    const wanted = tab === 'guest' ? 'guest' : 'host';
    if (!remoteModal) return;
    remoteModal.querySelectorAll('[data-remote-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-remote-tab') === wanted);
    });
    remoteModal.querySelectorAll('[data-remote-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.getAttribute('data-remote-panel') !== wanted);
    });
  }

  function remoteOpenModal(tab) {
    if (!remoteUi) remoteBuildCard();
    if (!remoteModal) remoteBuildModal();
    if (!remoteModal) return;
    const wanted = tab || (remoteSession && remoteSession.role) || 'host';
    remoteSetTab(wanted);
    remoteModal.style.display = 'flex';
    remoteRefreshUi();
  }

  function remoteCopy(selector) {
    const el = remoteModal && remoteModal.querySelector(selector);
    if (!el || !el.value) return;
    el.focus();
    el.select();
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(el.value).catch(() => {});
        copied = true;
      }
    } catch (err) {}
    if (!copied) {
      try { copied = document.execCommand('copy'); } catch (err) {}
    }
    remoteSetStatus(copied ? '已复制，发微信给对方即可' : '长按文本框复制');
  }

  function remoteShare(selector) {
    const el = remoteModal && remoteModal.querySelector(selector);
    if (!el || !el.value) return;
    if (navigator.share) {
      navigator.share({ title: '庄园牌桌远程互动', text: el.value }).catch(() => {});
    } else {
      remoteCopy(selector);
    }
  }

  function remoteEncode(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function remoteDecode(code) {
    let text = String(code || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!text) throw new Error('邀请码为空');
    while (text.length % 4) text += '=';
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function remoteGather(pc) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
      pc.addEventListener('icegatheringstatechange', check);
      const timer = setTimeout(finish, 8000);
    });
  }

  function remoteCreatePeer(role) {
    if (typeof RTCPeerConnection !== 'function') throw new Error('这台设备不支持 WebRTC');
    remoteReset(true);
    const pc = new RTCPeerConnection({ iceServers: REMOTE_ICE, iceCandidatePoolSize: 2 });
    const session = {
      role,
      pc,
      dc: null,
      offerCode: '',
      answerCode: '',
      hostName: '',
      connected: false,
      everConnected: false,
      rejected: false,
      srflx: false,
    };
    pc.onicecandidate = (event) => {
      if (event.candidate && event.candidate.type === 'srflx') session.srflx = true;
    };
    pc.onconnectionstatechange = () => {
      if (remoteSession !== session) return;
      if (pc.connectionState === 'failed') remoteConnectionLost(session, '远程连接失败');
      else if (pc.connectionState === 'closed') remoteConnectionLost(session, '远程连接已断开');
    };
    remoteSession = session;
    return session;
  }

  function remoteBindChannel(session, dc) {
    session.dc = dc;
    dc.onopen = () => remoteChannelOpen(session);
    dc.onmessage = (event) => remoteChannelMessage(session, String(event.data || ''));
    dc.onclose = () => remoteConnectionLost(session, '远程连接已断开');
    dc.onerror = () => remoteConnectionLost(session, '远程连接出错');
  }

  function remoteChannelOpen(session) {
    if (remoteSession !== session) return;
    session.connected = true;
    session.everConnected = true;
    if (session.role === 'host') {
      window.__manorRemoteHost = true;
      window.__manorAiHost = '本机 iPad';
      remoteSetStatus('已连上家人；现在去登录/进桌，AI 在这台 iPad 上推理');
    } else {
      window.__manorPeerMode = true;
      window.__manorRemoteGuest = true;
      window.__manorAiHost = `${session.hostName || '房主'} 的 iPad`;
      remoteSetStatus(`已连上 ${session.hostName || '房主'}；现在去登录/进桌`);
      try { window.dispatchEvent(new Event('manor-remote-connected')); } catch (err) {}
    }
    setTimeout(() => {
      if (remoteModal) remoteModal.style.display = 'none';
    }, 900);
    remoteRefreshUi();
  }

  function remoteChannelMessage(session, text) {
    if (remoteSession !== session) return;
    if (session.role === 'host') {
      try {
        const msg = JSON.parse(text);
        if (msg && msg.type === 'login') {
          const id = String(msg.id || '').trim();
          if (!REMOTE_USERS.has(id)) {
            remoteRejectHost(session, '远程互动只允许猫猫和喵喵');
            return;
          }
          if (id === session.hostName) {
            remoteRejectHost(session, '不能和自己联机');
            return;
          }
        }
      } catch (err) { /* non-login */ }
      try { bridge.host_receive(REMOTE_PEER, text); } catch (err) { console.error(err); }
      return;
    }
    applyGuestState(text);
  }

  function remoteRejectHost(session, message) {
    session.rejected = true;
    try { if (session.dc) session.dc.send(JSON.stringify({ type: 'error', message })); } catch (err) {}
    remoteSetStatus(message, true);
    setTimeout(() => remoteReset(true), 500);
  }

  function remoteConnectionLost(session, message) {
    if (remoteSession !== session) return;
    const wasConnected = session.everConnected;
    const wasRejected = session.rejected;
    const role = session.role;
    remoteReset(true);
    remoteSetStatus(wasRejected ? '远程连接被拒绝' : message, !wasRejected);
    try { window.dispatchEvent(new Event('manor-remote-disconnected')); } catch (err) {}
    if (role === 'guest' && wasConnected && !wasRejected) {
      setTimeout(() => { try { window.location.reload(); } catch (err) {} }, 2600);
    }
  }

  function remoteReset(silent) {
    const session = remoteSession;
    remoteSession = null;
    if (session) {
      try { if (session.dc) { session.dc.onclose = null; session.dc.onerror = null; session.dc.close(); } } catch (err) {}
      try { session.pc.close(); } catch (err) {}
      if (session.role === 'host') {
        window.__manorRemoteHost = false;
        try { bridge.host_leave(REMOTE_PEER); } catch (err) {}
      } else {
        window.__manorPeerMode = false;
        window.__manorRemoteGuest = false;
        window.__manorAiHost = '';
      }
    }
    if (!silent) remoteSetStatus(remoteDefaultStatus(), false);
    else remoteRefreshUi();
  }

  async function remoteHostStart() {
    try {
      if (!remoteAllowed(remoteProfileId)) throw new Error('远程互动只允许猫猫和喵喵');
      const session = remoteCreatePeer('host');
      session.hostName = remoteProfileId;
      const dc = session.pc.createDataChannel('manor', { ordered: true });
      remoteBindChannel(session, dc);
      remoteSetStatus('正在收集线路（最多 8 秒）…');
      await session.pc.setLocalDescription(await session.pc.createOffer());
      await remoteGather(session.pc);
      session.offerCode = remoteEncode({ v: 1, k: 'offer', sdp: session.pc.localDescription, name: session.hostName });
      if (!session.srflx) remoteSetStatus('邀请码已生成；没拿到公网映射，可能只能同一 Wi-Fi，先发给对方试试');
      else remoteSetStatus('邀请码已生成，发给对方；收到应答码后粘贴连接');
      remoteRefreshUi();
    } catch (err) {
      remoteReset(true);
      remoteSetStatus('开房失败：' + (err && err.message ? err.message : err), true);
    }
  }

  async function remoteGuestAnswer() {
    try {
      if (!remoteAllowed(remoteProfileId)) throw new Error('远程互动只允许猫猫和喵喵');
      const input = remoteModal && remoteModal.querySelector('[data-remote-offer-input]');
      const offer = remoteDecode(input && input.value);
      if (!offer || offer.v !== 1 || offer.k !== 'offer' || !offer.sdp) throw new Error('邀请码格式不对');
      const session = remoteCreatePeer('guest');
      session.hostName = String(offer.name || '房主');
      session.pc.ondatachannel = (event) => remoteBindChannel(session, event.channel);
      remoteSetStatus('正在生成应答码（最多 8 秒）…');
      await session.pc.setRemoteDescription(offer.sdp);
      await session.pc.setLocalDescription(await session.pc.createAnswer());
      await remoteGather(session.pc);
      session.answerCode = remoteEncode({ v: 1, k: 'answer', sdp: session.pc.localDescription });
      remoteSetStatus('应答码已生成，发回给房主；房主连接后就能进桌');
      remoteRefreshUi();
    } catch (err) {
      remoteReset(true);
      remoteSetStatus('加入失败：' + (err && err.message ? err.message : err), true);
    }
  }

  async function remoteHostConnect() {
    try {
      if (!remoteSession || remoteSession.role !== 'host' || !remoteSession.offerCode) throw new Error('先开房生成邀请码');
      const input = remoteModal && remoteModal.querySelector('[data-remote-answer-input]');
      const answer = remoteDecode(input && input.value);
      if (!answer || answer.v !== 1 || answer.k !== 'answer' || !answer.sdp) throw new Error('应答码格式不对');
      remoteSetStatus('正在连接对方…');
      await remoteSession.pc.setRemoteDescription(answer.sdp);
    } catch (err) {
      remoteSetStatus('连接失败：' + (err && err.message ? err.message : err), true);
    }
  }

  function installSender() {
    window.__manorSend = (text) => {
      maybeSyncAfterState(text);
      if (activeSocket && activeSocket.readyState === 1 && activeSocket.onmessage) {
        try { activeSocket.onmessage({ data: text }); } catch (err) { console.error(err); }
      }
    };
    window.manorHostSend = (peer, text) => {
      const key = String(peer);
      if (window.__manorRemoteHost && remoteSession && remoteSession.dc
          && remoteSession.dc.readyState === 'open' && key.indexOf('webrtc') === 0) {
        try { remoteSession.dc.send(String(text)); return; } catch (err) { console.error(err); }
      }
      nearbyPost({ action: 'send', to: key, text: String(text) });
    };
  }

  async function boot() {
    setStage('boot.start');
    localUiPolish();
    splash('正在唤醒本机牌桌…');
    await loadScript('/pyodide/pyodide.js');
    setStage('pyodide.script');
    pyodide = await loadPyodide({ indexURL: '/pyodide/' });
    pyodide.setStderr({ batched: (s) => console.warn('[py]', s) });
    pyodide.setStdout({ batched: (s) => console.log('[py]', s) });
    setStage('pyodide.ready');
    splash('正在加载牌局引擎…');
    await pyodide.loadPackage('/packages/numpy-2.0.2-cp312-cp312-pyodide_2024_0_wasm32.whl');
    setStage('numpy.ready');
    const buf = await (await fetch('/app-core.zip')).arrayBuffer();
    await pyodide.unpackArchive(new Uint8Array(buf), 'zip');
    setStage('appcore.ready');
    splash('正在加载 DouZero 权重…');
    if (!pyodide.FS.analyzePath('/models').exists) pyodide.FS.mkdir('/models');
    const mBuf = await (await fetch('/models.zip')).arrayBuffer();
    await pyodide.unpackArchive(new Uint8Array(mBuf), 'zip', { extractDir: '/models' });
    setStage('models.ready');

    try {
      if (!pyodide.FS.analyzePath('/data').exists) pyodide.FS.mkdir('/data');
    } catch (err) {
      trace('idbfs.mkdirFailed', { message: String(err && err.message || err) });
    }
    try {
      pyodide.FS.mount(pyodide.IDBFS, {}, '/data');
    } catch (err) {
      // 已挂载时忽略；其他错误记录后继续，内存数据也能玩。
      trace('idbfs.mountFailed', { message: String(err && err.message || err) });
    }
    try {
      await new Promise((resolve, reject) => pyodide.FS.syncfs(true, (err) => err ? reject(err) : resolve()));
      setStage('idbfs.ready');
    } catch (err) {
      window.__MANOR_IDBFS_ERROR__ = String(err && err.message || err);
      trace('idbfs.syncFailed', { message: window.__MANOR_IDBFS_ERROR__ });
      console.warn('本机数据读取失败，先以空数据启动', err);
    }

    setStage('bridge.init');
    await pyodide.runPythonAsync(`
import sys
sys.path.insert(0, '/home/pyodide')
import local_bridge
local_bridge.init('/data')
`);
    bridge = pyodide.globals.get('local_bridge');
    setStage('bridge.ready');
    try {
      const aiStatus = bridge.ai_status ? JSON.parse(bridge.ai_status()) : null;
      if (aiStatus) {
        diagPost({
          action: 'log',
          level: aiStatus.available ? 'info' : 'error',
          event: 'ai.status',
          detail: aiStatus,
        });
      }
    } catch (err) {
      trace('ai.status.failed', { message: String(err && err.message || err) });
    }

    installSender();
    installWebSocketShim();
    installFetchShim();
    splash('正在铺牌桌…');
    setStage('app.load');
    await loadScript(APP_JS);
    setupNearby();
    setupOta();
    scheduleAutoSync(1500);
    setInterval(() => {
      if (document.visibilityState === 'visible') syncNow(true);
    }, 180000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncNow(true);
    });
    hideSplash();
    setStage('app.ready');
    diagPost({ action: 'ready', webVersion: VERSION });
    window.__MANOR_READY__ = true;
    setInterval(syncData, 2000);
    window.addEventListener('pagehide', syncData);
  }

  boot().catch((err) => {
    console.error(err);
    reportBootFailure(err, currentStage);
    splash('本机引擎启动失败：' + (err && err.message ? err.message : err));
  });
})();
