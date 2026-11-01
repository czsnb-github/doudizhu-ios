/* 端侧启动：同一套页面，先起 Pyodide 引擎，再把 WebSocket/fetch 接到本机。 */
(() => {
  'use strict';

  const VERSION = '20261101c';
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
        try {
          bridge.handle(String(data));
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

  function installSender() {
    window.__manorSend = (text) => {
      if (activeSocket && activeSocket.readyState === 1 && activeSocket.onmessage) {
        try { activeSocket.onmessage({ data: text }); } catch (err) { console.error(err); }
      }
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
    hideSplash();
    setInterval(syncData, 2000);
    window.addEventListener('pagehide', syncData);
  }

  boot().catch((err) => {
    console.error(err);
    splash('本机引擎启动失败：' + (err && err.message ? err.message : err));
  });
})();
