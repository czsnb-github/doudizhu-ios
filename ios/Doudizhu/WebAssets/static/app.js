/* ============================================================
   斗地主 · 庄园牌桌 — 前端控制器
   单牌桌 / 无房间号 / 所有牌局状态以服务器为准
   ============================================================ */
(() => {
  'use strict';

  if (window.__MANOR_IOS__) {
    document.querySelectorAll('[data-ios-download]').forEach((el) => el.remove());
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const LS = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : v;
      } catch (err) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, String(value)); } catch (err) { /* ignore */ }
    },
    del(key) {
      try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
    },
  };

  // ---------------------------------------------------------------- 常量

  const STAGE_ORDER = ['seed', 'baby', 'middle', 'high', 'super', 'god'];

  const AVATAR_FALLBACK = [
    ['mole_0', 'mole', '么么公主'], ['mole_1', 'mole', '摩尔王八世'],
    ['mole_2', 'mole', '哈娜'], ['mole_3', 'mole', '塞拉王子'],
    ['mole_4', 'mole', '捷克王子'], ['mole_5', 'mole', '摩尔王七世'],
    ['mole_6', 'mole', '摩乐乐'], ['mole_7', 'mole', '丫丽'],
    ['mole_8', 'mole', '瑞琪'], ['mole_9', 'mole', '其其'],
    ['genshin_0', 'genshin', '可莉'], ['genshin_1', 'genshin', '胡桃'],
    ['genshin_2', 'genshin', '钟离'], ['genshin_3', 'genshin', '雷电将军'],
    ['genshin_4', 'genshin', '纳西妲'], ['genshin_5', 'genshin', '芙宁娜'],
    ['genshin_6', 'genshin', '派蒙'], ['genshin_7', 'genshin', '温迪'],
    ['genshin_8', 'genshin', '甘雨'], ['genshin_9', 'genshin', '宵宫'],
  ].map(([id, origin, name]) => ({
    id, origin, name,
    url: `/static/assets/avatars/${id}.jpg`,
  }));

  const COLOR_FALLBACK = [
    ['pink', '樱花粉', '#f29ab5'], ['red', '草莓红', '#e86a72'],
    ['blue', '湖水蓝', '#6fb6e3'], ['yellow', '柠檬黄', '#f2ca57'],
    ['purple', '葡萄紫', '#a98ad6'], ['green', '嫩芽绿', '#83bf7a'],
    ['orange', '蜜橘橙', '#efa05a'], ['black', '夜空黑', '#565264'],
    ['gray', '云朵灰', '#b4bec4'], ['brown', '可可棕', '#a97a58'],
    ['cream', '奶白', '#f7edd6'],
    ['ink', '纯黑', '#000000'], ['white', '纯白', '#ffffff'],
  ].map(([id, name, hex]) => ({ id, name, hex }));

  const STAGE_FALLBACK = [
    { key: 'seed', name: '拉姆种子', min_level: 1 },
    { key: 'baby', name: '初级拉姆', min_level: 2 },
    { key: 'middle', name: '中级拉姆', min_level: 4 },
    { key: 'high', name: '高级拉姆', min_level: 7 },
    { key: 'super', name: '超级拉姆', min_level: 11 },
    { key: 'god', name: '神力拉姆', min_level: 17 },
  ];

  const DIFF_FALLBACK = [
    { key: 'easy', label: '简单', note: '偶尔走神' },
    { key: 'normal', label: '普通', note: 'ADP 进攻' },
    { key: 'hard', label: '困难', note: '原版 WP' },
    { key: 'master', label: '大师', note: '双模型合议' },
  ];

  const ORIGIN_LABELS = { mole: '摩尔庄园', genshin: '原神' };

  const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.6a5 5 0 0 1 0 6.8"/><path d="M19 6.2a8.5 8.5 0 0 1 0 11.6"/></svg>';
  const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 9l5 6M21.5 9l-5 6"/></svg>';
  const CROWN_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 23 L2.5 9 L10 14.5 L16 5 L22 14.5 L29.5 9 L28 23 Z"/></svg>';

  const S = {
    meta: null,
    lanUrl: '',
    hello: null,
    info: null,
    aiHost: '',

    ws: null,
    connected: false,
    reconnectTimer: null,
    reconnectDelay: 1000,
    heartbeatTimer: null,

    view: null,
    profile: null,
    loggedIn: false,
    pendingLogin: false,
    pendingId: null,
    loginMode: null,
    loginTimer: null,
    pid: null,
    idDraft: '',
    savedProfile: null,

    inTable: false,
    selected: new Set(),
    hints: [],
    hintSeq: -1,
    hintIdx: 0,
    hintPending: false,
    actionPending: false,

    lastRound: -1,
    liveRound: -1,
    lastSeq: -1,
    lastEventSeq: -1,
    lastMyTurn: false,
    resultShownRound: null,
    resultTimer: null,
    peekTable: false,

    bubbles: {},
    dealAnim: false,

    origin: 'mole',
    originInit: false,
    drawerOpen: false,
    drawerOrigin: 'mole',
    confirmFn: null,

    prefDiff: LS.get('ddz.diff', 'normal'),
    handOrder: LS.get('ddz.handOrder', 'asc') === 'desc' ? 'desc' : 'asc',
    orderEditAt: 0,
    playerModalToken: 0,
    diffSent: false,
    sound: LS.get('ddz.sound', '1') !== '0',
    toastTimer: null,

    turnKey: '',
    turnSince: 0,
    remindLast: 0,
    baseTitle: '',
  };

  const TURN_REMIND_MS = 15000;

  // ---------------------------------------------------------------- 元数据

  function avatars() {
    return (S.meta && Array.isArray(S.meta.avatars) && S.meta.avatars.length)
      ? S.meta.avatars : AVATAR_FALLBACK;
  }
  function colors() {
    return (S.meta && Array.isArray(S.meta.ram_colors) && S.meta.ram_colors.length)
      ? S.meta.ram_colors : COLOR_FALLBACK;
  }
  function stages() {
    const raw = (S.meta && Array.isArray(S.meta.ram_stages) && S.meta.ram_stages.length)
      ? S.meta.ram_stages : STAGE_FALLBACK;
    return raw.slice().sort((a, b) => a.min_level - b.min_level);
  }
  function difficulties() {
    return (S.meta && Array.isArray(S.meta.difficulties) && S.meta.difficulties.length)
      ? S.meta.difficulties : DIFF_FALLBACK;
  }

  function avatarMeta(id) {
    return avatars().find((a) => a.id === id) || avatars()[0];
  }
  function avatarUrl(id) {
    const meta = avatarMeta(id);
    return meta.url || `/static/assets/avatars/${meta.id}.jpg`;
  }
  function originOfAvatar(id) {
    const meta = avatarMeta(id);
    return meta.origin === 'genshin' ? 'genshin' : 'mole';
  }
  function colorOf(idOrHex) {
    const list = colors();
    return list.find((c) => c.id === idOrHex)
      || list.find((c) => c.hex === idOrHex)
      || list[0];
  }
  function stageForLevel(level) {
    let pick = stages()[0];
    for (const stage of stages()) {
      if (level >= stage.min_level) pick = stage;
    }
    return pick;
  }
  function nextStageForLevel(level) {
    return stages().find((stage) => stage.min_level > level) || null;
  }
  function ramFor(level, colorId, name) {
    const color = colorOf(colorId);
    const stage = stageForLevel(level);
    const next = nextStageForLevel(level);
    return {
      name: name || '小拉姆',
      color_id: color.id,
      color_name: color.name,
      color: color.hex,
      level,
      stage: stage.key,
      stage_name: stage.name,
      next_stage: next ? next.name : null,
      next_stage_at: next ? next.min_level : null,
    };
  }

  // ---------------------------------------------------------------- 拉姆

  let ramSeq = 0;

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(hex, target, amount) {
    const a = hexToRgb(hex);
    const b = hexToRgb(target);
    if (!a || !b) return hex;
    const out = a.map((v, i) => Math.round(v + (b[i] - v) * amount));
    return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function ramSVG(hex, stage, extraClass) {
    const uid = 'ram' + (++ramSeq);
    const safe = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#f29ab5';
    const idx = Math.max(0, STAGE_ORDER.indexOf(stage || 'seed'));
    const rgb = hexToRgb(safe) || [242, 154, 181];
    const lum = (rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114) / 255;
    const isDark = lum < .3;
    const isWhite = lum > .94;
    const light = mix(safe, '#ffffff', isDark ? .3 : isWhite ? .03 : .46);
    const shade = mix(safe, isDark ? '#ffffff' : '#3a2a22', isDark ? .16 : isWhite ? .2 : .3);
    const ink = isDark ? '#f4e8d4' : '#3a2a22';
    const seed = idx === 0;
    const cy = seed ? 70 : 69;
    const rx = seed ? 17 : 26.5;
    const ry = seed ? 16 : 24.5;
    const top = cy - ry;

    const gold = idx >= 4;
    const leafLight = gold ? '#ffe27c' : '#a9dc86';
    const leafDark = gold ? '#e6a923' : '#5aa54e';
    const leafEdge = gold ? '#a97a1e' : '#3f7a3a';
    const leafVein = gold ? '#fff4bd' : '#dcf2bd';

    const leaf = (angle, len) => `<g transform="translate(50 ${top + 2}) rotate(${angle})">
        <path d="M0 0 C-7.4 ${-len * .28} -7.4 ${-len * .74} 0 ${-len} C7.4 ${-len * .74} 7.4 ${-len * .28} 0 0Z"
              fill="url(#${uid}l)" stroke="${leafEdge}" stroke-width="1.2" stroke-linejoin="round"/>
        <path d="M0 -3 L0 ${-len + 5}" stroke="${leafVein}" stroke-width="1" stroke-linecap="round" opacity=".8"/>
      </g>`;

    let leaves = '';
    if (seed) {
      leaves = `<path d="M50 ${top + 3} C50 ${top - 2} 50 ${top - 7} 50 ${top - 11}" fill="none" stroke="#5f9e5a" stroke-width="2.4" stroke-linecap="round"/>
        ${[-28, 28].map((a) => `<g transform="translate(50 ${top - 10}) rotate(${a})">
          <path d="M0 0 C-4.6 -2.6 -5.4 -8.4 0 -12 C5.4 -8.4 4.6 -2.6 0 0Z" fill="#8cc47c" stroke="#4f8d49" stroke-width=".9" stroke-linejoin="round"/>
        </g>`).join('')}`;
    } else if (idx === 2) {
      leaves = [-26, 26].map((a) => leaf(a, 27)).join('');
    } else if (idx === 3) {
      leaves = [-66, -44, -22, 0, 22, 44, 66].map((a) => leaf(a, 34)).join('');
    } else if (idx === 4) {
      leaves = [-40, 0, 40].map((a) => leaf(a, 33)).join('');
    } else if (idx === 5) {
      leaves = [-66, -44, -22, 0, 22, 44, 66].map((a) => leaf(a, 37)).join('');
    }

    const orbs = idx === 5 ? `
      <g>
        ${orb(50, 36, 6.2, '#9fe6ff', '#3f9fdc', '#24658f', uid + 'o1')}
        ${orb(27, 47, 5.6, '#c6f49a', '#5cb54c', '#357a2d', uid + 'o2')}
        ${orb(73, 47, 5.6, '#ffc0b4', '#e2564d', '#962f2a', uid + 'o3')}
      </g>` : '';

    const sparkles = idx >= 3 ? `
      <g fill="#ffe9a3" stroke="#d9a93f" stroke-width=".6">
        <path d="M13 34 l1.4 3.2 3.2 1.4 -3.2 1.4 -1.4 3.2 -1.4 -3.2 -3.2 -1.4 3.2 -1.4Z"/>
        <path d="M86 38 l1.2 2.7 2.7 1.2 -2.7 1.2 -1.2 2.7 -1.2 -2.7 -2.7 -1.2 2.7 -1.2Z"/>
        ${gold ? '<path d="M77 15 l1 2.3 2.3 1 -2.3 1 -1 2.3 -1 -2.3 -2.3 -1 2.3 -1Z"/>' : ''}
      </g>` : '';

    const eyes = seed ? `
      <g fill="none" stroke="${ink}" stroke-width="1.9" stroke-linecap="round">
        <path d="M38 ${cy - 2} q4 4 8 0"/>
        <path d="M54 ${cy - 2} q4 4 8 0"/>
      </g>` : `
      <g class="ram-eye">
        <ellipse cx="41" cy="${cy - 2}" rx="9.6" ry="10.8" fill="#fffdf6" stroke="#42301f" stroke-width="1.2"/>
        <ellipse cx="59" cy="${cy - 2}" rx="9.6" ry="10.8" fill="#fffdf6" stroke="#42301f" stroke-width="1.2"/>
        <circle cx="42.2" cy="${cy - 1}" r="4.7" fill="#45301f"/>
        <circle cx="60.2" cy="${cy - 1}" r="4.7" fill="#45301f"/>
        <circle cx="43.4" cy="${cy - 3.4}" r="1.8" fill="#ffffff"/>
        <circle cx="61.4" cy="${cy - 3.4}" r="1.8" fill="#ffffff"/>
        <circle cx="40.6" cy="${cy + 1.8}" r=".9" fill="#ffffff" opacity=".8"/>
        <circle cx="58.6" cy="${cy + 1.8}" r=".9" fill="#ffffff" opacity=".8"/>
      </g>`;

    return `<svg class="ram-svg${extraClass ? ' ' + extraClass : ''}" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="${uid}b" cx="35%" cy="24%" r="86%">
          <stop offset="0" stop-color="${light}"/>
          <stop offset=".64" stop-color="${safe}"/>
          <stop offset="1" stop-color="${shade}"/>
        </radialGradient>
        <linearGradient id="${uid}l" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="${leafDark}"/>
          <stop offset="1" stop-color="${leafLight}"/>
        </linearGradient>
      </defs>
      <ellipse cx="50" cy="${cy + ry - 1.5}" rx="${rx * .78}" ry="${ry * .15}" fill="#6b533c" opacity=".14"/>
      ${leaves}
      <ellipse cx="50" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${uid}b)" stroke="${ink}" stroke-width="1.7"/>
      <ellipse cx="42" cy="${cy - 12}" rx="9" ry="5.4" fill="#ffffff" opacity="${isWhite ? .55 : .2}" transform="rotate(-24 42 ${cy - 12})"/>
      <ellipse cx="50" cy="${cy + ry * .55}" rx="${rx * .62}" ry="${ry * .32}" fill="${shade}" opacity=".35"/>
      ${eyes}
      <path d="M46 ${cy + (seed ? 9 : 13)} q4 3.4 8 0" fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round"/>
      ${orbs}
      ${sparkles}
    </svg>`;
  }

  function orb(cx, cy, r, lightColor, midColor, edgeColor, id) {
    return `<g>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})" stroke="${edgeColor}" stroke-width="1.1"/>
      <circle cx="${cx - r * .32}" cy="${cy - r * .34}" r="${r * .3}" fill="#ffffff" opacity=".85"/>
      <defs>
        <radialGradient id="${id}" cx="35%" cy="30%" r="75%">
          <stop offset="0" stop-color="${lightColor}"/>
          <stop offset=".55" stop-color="${midColor}"/>
          <stop offset="1" stop-color="${edgeColor}"/>
        </radialGradient>
      </defs>
    </g>`;
  }

  // ---------------------------------------------------------------- 扑克牌

  const RANK_LABELS = {
    3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2',
  };
  const SUIT_SYMBOLS = ['\u2660', '\u2665', '\u2663', '\u2666'];

  function cardInfo(id) {
    id = Number(id);
    if (id === 52) return { id, joker: true, red: false, word: '小', label: '小王' };
    if (id === 53) return { id, joker: true, red: true, word: '大', label: '大王' };
    const r = Math.floor(id / 4) + 3;
    const s = id % 4;
    return {
      id,
      r,
      s,
      red: s === 1 || s === 3,
      label: RANK_LABELS[r] || String(r),
      suit: SUIT_SYMBOLS[s],
    };
  }

  function handRank(id) {
    id = Number(id);
    if (id === 52) return 16;
    if (id === 53) return 17;
    return Math.floor(id / 4) + 3;
  }

  function orderedHand(cards) {
    const dir = S.handOrder === 'desc' ? -1 : 1;
    return (cards || []).slice().sort((a, b) => {
      const gap = handRank(a) - handRank(b) || Number(a) - Number(b);
      return gap * dir;
    });
  }

  function cardHTML(id, opts = {}) {
    const info = cardInfo(id);
    const classes = ['card'];
    if (info.red) classes.push('red');
    if (info.joker) classes.push('joker');
    if (opts.back) classes.push('back');
    if (opts.selected) classes.push('selected');
    if (opts.dealing) classes.push('dealing');
    if (opts.cls) classes.push(opts.cls);
    const style = `--i:${opts.i == null ? 0 : opts.i}${opts.cw ? `;--cw:${opts.cw}px` : ''}`;

    if (opts.back) {
      return `<div class="${classes.join(' ')}" style="${style}" aria-hidden="true"></div>`;
    }

    let inner;
    if (info.joker) {
      inner = `<span class="joker-sub">JOKER</span><span class="joker-word">${info.word}</span>`;
    } else {
      const ten = info.label === '10' ? ' ten' : '';
      inner = `<span class="corner"><span class="r${ten}">${info.label}</span><span class="s">${info.suit}</span></span>`
        + `<span class="pip">${info.suit}</span>`
        + `<span class="corner br"><span class="r${ten}">${info.label}</span><span class="s">${info.suit}</span></span>`;
    }

    if (opts.selectable) {
      return `<button type="button" class="${classes.join(' ')}" style="${style}" data-card="${id}" aria-pressed="${opts.selected ? 'true' : 'false'}" aria-label="${esc(info.label)}${info.joker ? '' : esc(info.suit)}">${inner}</button>`;
    }
    return `<div class="${classes.join(' ')}" style="${style}" aria-label="${esc(info.label)}">${inner}</div>`;
  }

  // ---------------------------------------------------------------- 声音

  const Sfx = {
    ctx: null,
    ensure() {
      if (!S.sound) return null;
      try {
        if (!this.ctx) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return null;
          this.ctx = new Ctx();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      } catch (err) { return null; }
    },
    tone(freq, dur, type, vol, delay) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t = ctx.currentTime + (delay || 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(vol || .045, t + .012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + (dur || .1));
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + (dur || .1) + .03);
    },
    click() { this.tone(560, .05, 'triangle', .03); },
    deal() {
      this.tone(620, .05, 'triangle', .028, 0);
      this.tone(720, .05, 'triangle', .026, .07);
      this.tone(820, .06, 'triangle', .024, .14);
    },
    bid() { this.tone(480, .09, 'sine', .05); this.tone(660, .12, 'sine', .045, .09); },
    call() { this.tone(520, .09, 'sine', .05); this.tone(690, .12, 'sine', .045, .09); },
    grab() {
      this.tone(620, .09, 'triangle', .055);
      this.tone(830, .1, 'triangle', .05, .08);
      this.tone(1040, .14, 'triangle', .045, .17);
    },
    remind() {
      this.tone(880, .16, 'sine', .06);
      this.tone(880, .16, 'sine', .06, .24);
      this.tone(1174, .2, 'sine', .055, .48);
    },
    landlord() {
      this.tone(523, .16, 'triangle', .05, 0);
      this.tone(659, .16, 'triangle', .05, .1);
      this.tone(784, .22, 'triangle', .05, .2);
    },
    play() { this.tone(420, .07, 'square', .028); this.tone(560, .06, 'square', .02, .04); },
    pass() { this.tone(280, .08, 'sine', .04); },
    bomb() {
      this.tone(92, .3, 'sawtooth', .075);
      this.tone(58, .34, 'sawtooth', .07, .03);
      this.tone(180, .12, 'square', .05, .05);
    },
    turn() { this.tone(880, .1, 'sine', .04); this.tone(1175, .12, 'sine', .032, .09); },
    win() {
      [523, 659, 784, 1046].forEach((f, i) => this.tone(f, .19, 'triangle', .045, i * .1));
    },
    lose() {
      [392, 330, 262].forEach((f, i) => this.tone(f, .22, 'sine', .045, i * .12));
    },
  };

  function unlockAudio() {
    if (S.sound) Sfx.ensure();
  }

  function applySoundIcon() {
    const icon = S.sound ? ICON_SOUND_ON : ICON_SOUND_OFF;
    for (const id of ['sound-entry', 'sound-table']) {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = icon;
        el.setAttribute('aria-label', S.sound ? '关闭声音' : '打开声音');
        el.classList.toggle('muted', !S.sound);
      }
    }
  }

  // ---------------------------------------------------------------- 提示条

  function setConn(ok, text) {
    const box = $('#conn');
    const copy = $('#conn-text');
    if (!box || !copy) return;
    box.classList.remove('hidden');
    box.classList.toggle('ok', !!ok);
    copy.textContent = text || (ok ? '已连接 · 局域网牌桌' : '正在连接…');
    clearTimeout(box._timer);
    if (ok) {
      box._timer = setTimeout(() => box.classList.add('hidden'), 1400);
    }
  }

  function toast(message, isError) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // ---------------------------------------------------------------- WebSocket

  function connect() {
    if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch (err) {
      scheduleReconnect();
      return;
    }
    S.ws = ws;
    setConn(false, '正在连接牌桌…');

    ws.onopen = () => {
      S.connected = true;
      S.reconnectDelay = 1000;
      setConn(true);
      startHeartbeat();
      if (S.pendingLogin && S.pendingId) {
        send({ type: 'login', id: S.pendingId }, { silent: true });
      } else if (S.loggedIn && S.pid) {
        send({ type: 'login', id: S.pid }, { silent: true });
      }
      if (S.inTable) send({ type: 'state' }, { silent: true });
      reportClient();
    };

    ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch (err) { return; }
      if (data && typeof data === 'object') handleMessage(data);
    };

    ws.onclose = () => {
      S.connected = false;
      stopHeartbeat();
      S.ws = null;
      if (!S.inTable) setConn(false, '等待服务器…');
      else setConn(false, '连接断开，正在重连…');
      scheduleReconnect();
    };

    ws.onerror = () => { /* onclose 会接手 */ };
  }

  function scheduleReconnect() {
    if (S.reconnectTimer) return;
    const delay = S.reconnectDelay;
    S.reconnectDelay = Math.min(6000, Math.round(S.reconnectDelay * 1.6));
    S.reconnectTimer = setTimeout(() => {
      S.reconnectTimer = null;
      connect();
    }, delay);
  }

  function startHeartbeat() {
    stopHeartbeat();
    S.heartbeatTimer = setInterval(() => {
      send({ type: 'ping', t: Date.now() }, { silent: true });
    }, 25000);
  }

  function stopHeartbeat() {
    if (S.heartbeatTimer) {
      clearInterval(S.heartbeatTimer);
      S.heartbeatTimer = null;
    }
  }

  function send(payload, opts = {}) {
    if (!S.ws || S.ws.readyState !== 1) {
      if (!opts.silent) toast('还没连上服务器，请稍候…', true);
      return false;
    }
    try {
      S.ws.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      if (!opts.silent) toast('消息发送失败', true);
      return false;
    }
  }

  // 客户端画面信息：只给局域网里排查分屏/分辨率用
  function clientSnapshot() {
    const vv = window.visualViewport;
    return {
      vw: Math.round(window.innerWidth),
      vh: Math.round(window.innerHeight),
      vvw: vv ? Math.round(vv.width) : null,
      vvh: vv ? Math.round(vv.height) : null,
      sw: screen.width,
      sh: screen.height,
      saw: screen.availWidth,
      sah: screen.availHeight,
      dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
      orientation: window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait',
      coarse: window.matchMedia('(pointer: coarse)').matches,
      touch: navigator.maxTouchPoints || 0,
      ua: navigator.userAgent || '',
      platform: navigator.platform || '',
      lang: navigator.language || '',
      mobile: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || ''),
    };
  }

  function reportClient() {
    send({ type: 'client_info', info: clientSnapshot() }, { silent: true });
  }

  let clientReportTimer = 0;
  function reportClientSoon() {
    clearTimeout(clientReportTimer);
    clientReportTimer = setTimeout(reportClient, 500);
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'hello':
        S.hello = msg;
        if (msg.url) S.lanUrl = msg.url;
        applyLan();
        break;
      case 'state':
        applyState(msg);
        break;
      case 'hints':
        onHints(msg.hints || []);
        break;
      case 'error':
        S.pendingLogin = false;
        S.actionPending = false;
        S.hintPending = false;
        clearTimeout(S.loginTimer);
        toast(msg.message || '操作失败', true);
        renderEntry();
        renderBars(S.view);
        break;
      case 'left':
        break;
      case 'kicked':
        closeModal();
        toast(msg.message || '你被请离了牌桌', true);
        renderAll();
        break;
      case 'pong':
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- 状态

  function applyState(v) {
    if (!v || v.type !== 'state') return;

    S.view = v;
    if (v.me) {
      S.profile = v.me;
      S.loggedIn = true;
      S.pid = v.me.id;
      if (!S.originInit) {
        S.origin = originOfAvatar(v.me.avatar);
        S.originInit = true;
      }
      LS.set('ddz.lastId', v.me.id);
      applyProfileSettings(v.me);
    }

    if (S.pendingLogin && v.me) {
      S.pendingLogin = false;
      S.pendingId = null;
      clearTimeout(S.loginTimer);
      S.savedProfile = null;
      if (S.loginMode === 'auto') {
        S.inTable = true;
        showTableScreen();
      }
      S.loginMode = null;
    }

    const g = v.game;
    if (!g || v.phase !== 'ended') S.peekTable = false;
    if (!g) {
      S.lastRound = v.round || 0;
      S.lastSeq = -1;
      S.lastEventSeq = -1;
      S.selected.clear();
      S.hints = [];
      S.hintSeq = -1;
      S.bubbles = {};
      S.lastMyTurn = false;
      S.actionPending = false;
      if (S.resultTimer) { clearTimeout(S.resultTimer); S.resultTimer = null; }
    } else {
      if (!g.result) S.liveRound = v.round;
      if (v.round !== S.lastRound) {
        S.lastRound = v.round;
        S.lastSeq = -1;
        S.lastEventSeq = -1;
        S.selected.clear();
        S.hints = [];
        S.hintSeq = -1;
        S.hintIdx = 0;
        S.bubbles = {};
        S.lastMyTurn = false;
        S.actionPending = false;
        S.resultShownRound = null;
        if (S.resultTimer) { clearTimeout(S.resultTimer); S.resultTimer = null; }
        const modalRoot = $('#modal-root');
        if (modalRoot && modalRoot.children.length) closeModal();
        if (g.phase === 'bidding') {
          S.dealAnim = true;
          Sfx.deal();
          setTimeout(() => {
            S.dealAnim = false;
            if (S.inTable) renderTable();
          }, 1250);
        }
      }

      pruneSelection(g.hand || []);

      if (g.seq !== S.lastSeq) {
        S.lastSeq = g.seq;
        S.actionPending = false;
        S.hintSeq = -1;
        S.hints = [];
      }

      if (g.event && g.event.type && g.event.type !== 'deal' && g.seq > S.lastEventSeq) {
        S.lastEventSeq = g.seq;
        applyEvent(g.event, v);
      }
    }

    renderAll();
    applyPrefDiff();
    syncTurnClock(v);
    turnChime(v);
    maybeShowResult(v);
  }

  function applyProfileSettings(me) {
    if (!me || !me.settings) return;
    // 刚点过顺序按钮时先别被在途的旧状态覆盖
    if (Date.now() - S.orderEditAt < 1600) return;
    const order = me.settings.hand_order === 'desc' ? 'desc' : 'asc';
    if (S.handOrder === order) return;
    S.handOrder = order;
    LS.set('ddz.handOrder', order);
  }

  function pruneSelection(hand) {
    const alive = new Set((hand || []).map(Number));
    let changed = false;
    for (const card of Array.from(S.selected)) {
      if (!alive.has(card)) {
        S.selected.delete(card);
        changed = true;
      }
    }
    if (changed) S.hints = [];
  }

  function nameOf(seat) {
    const v = S.view;
    if (!v || seat == null) return '玩家';
    const data = (v.seats || [])[seat];
    return data ? data.name : '玩家';
  }

  function seatOf(index) {
    const v = S.view;
    if (!v) return null;
    return (v.seats || [])[index] || null;
  }

  function autopilotAt(index) {
    const seat = seatOf(index);
    return !!(seat && !seat.is_bot && seat.autopilot);
  }

  function myTurn(v) {
    if (!v || v.you == null || !v.game) return false;
    const g = v.game;
    return (g.phase === 'bidding' && (g.grab_active ? g.grab_turn === v.you : g.call_turn === v.you))
      || (g.phase === 'playing' && g.current === v.you);
  }

  function myWin(v) {
    if (!v || !v.game || !v.game.result || v.you == null) return null;
    const r = v.game.result;
    return r.landlord === v.you ? !!r.landlord_win : !r.landlord_win;
  }

  function applyEvent(ev, v) {
    const seat = ev.seat;
    if (ev.type === 'call') {
      setBubble(seat, ev.want ? '叫地主！' : '不叫', !ev.want);
      if (ev.want) Sfx.call(); else Sfx.pass();
    } else if (ev.type === 'grab_start') {
      setBubble(ev.caller != null ? ev.caller : ev.candidate, '叫地主！', false);
      Sfx.call();
    } else if (ev.type === 'grab_reback') {
      setBubble(ev.seat, '可抢回', false);
      Sfx.turn();
    } else if (ev.type === 'grab') {
      setBubble(seat, ev.seat === v.caller ? '抢回！' : '抢地主！', false);
      Sfx.grab();
    } else if (ev.type === 'pass_grab') {
      setBubble(seat, '不抢', true);
      Sfx.pass();
    } else if (ev.type === 'landlord') {
      setBubble(seat, '地主', false);
      Sfx.landlord();
    } else if (ev.type === 'play') {
      setBubble(seat, ev.combo || '出牌', false);
      if (ev.bomb) {
        Sfx.bomb();
        shakeBoard();
      } else {
        Sfx.play();
      }
    } else if (ev.type === 'pass') {
      setBubble(seat, '不要', true);
      Sfx.pass();
    } else if (ev.type === 'trick') {
      S.bubbles = {};
      Sfx.turn();
    } else if (ev.type === 'redeal') {
      toast('三家都不叫，重新发牌');
      Sfx.deal();
    } else if (ev.type === 'end') {
      const won = myWin(v);
      if (won === true) Sfx.win();
      else if (won === false) Sfx.lose();
      else Sfx.landlord();
    }
  }

  function setBubble(seat, text, isPass) {
    if (seat == null) return;
    const stamp = Date.now();
    S.bubbles[seat] = { text, pass: !!isPass, ts: stamp };
    if (S.inTable && S.view) renderSeats(S.view);
    setTimeout(() => {
      if (S.bubbles[seat] && S.bubbles[seat].ts === stamp) {
        delete S.bubbles[seat];
        if (S.inTable && S.view) renderSeats(S.view);
      }
    }, 3600);
  }

  function turnChime(v) {
    const mine = myTurn(v);
    if (mine && !S.lastMyTurn) Sfx.turn();
    S.lastMyTurn = mine;
  }

  // ---- 15 秒未操作提醒：视觉（牌桌/操作条脉冲 + 浮条）+ 听觉 ----
  function turnSeat(v) {
    if (!v || v.you == null || !v.game) return null;
    const g = v.game;
    if (g.phase === 'bidding') return g.grab_active ? g.grab_turn : g.call_turn;
    if (g.phase === 'playing') return g.current;
    return null;
  }

  function syncTurnClock(v) {
    const seat = turnSeat(v);
    const key = seat == null ? '' : `${v.phase}:${seat}`;
    if (key === S.turnKey) return;
    S.turnKey = key;
    S.turnSince = Date.now();
    S.remindLast = 0;
    hideTurnRemind();
    $$('.seat.slow').forEach((el) => el.classList.remove('slow'));
  }

  function showTurnRemind(seconds) {
    document.body.classList.add('turn-alert');
    if (!S.baseTitle) S.baseTitle = document.title;
    document.title = `【${seconds}s】轮到你了 · ${S.baseTitle}`;
  }

  function hideTurnRemind() {
    document.body.classList.remove('turn-alert');
    if (S.baseTitle) document.title = S.baseTitle;
  }

  function acknowledgeTurn() {
    S.remindLast = Date.now();
    hideTurnRemind();
  }

  function tickTurnReminder() {
    if (!S.inTable || !S.view) { hideTurnRemind(); return; }
    const v = S.view;
    const seat = turnSeat(v);
    const now = Date.now();
    const waiting = seat == null ? 0 : now - S.turnSince;
    $$('.seat').forEach((el) => {
      const idx = Number(el.dataset.seat);
      el.classList.toggle(
        'slow', seat != null && idx === seat && waiting >= TURN_REMIND_MS
      );
    });
    if (seat == null || seat !== v.you || waiting < TURN_REMIND_MS) {
      hideTurnRemind();
      return;
    }
    if (S.remindLast && now - S.remindLast < TURN_REMIND_MS) return;
    S.remindLast = now;
    showTurnRemind(Math.floor(waiting / 1000));
    if (S.sound) Sfx.remind();
  }

  function shakeBoard() {
    const board = $('.board');
    if (!board) return;
    board.classList.remove('bomb-shake');
    void board.offsetWidth;
    board.classList.add('bomb-shake');
    setTimeout(() => board.classList.remove('bomb-shake'), 620);
  }

  function applyPrefDiff() {
    const v = S.view;
    if (!v || !S.loggedIn || S.diffSent) return;
    if (v.you == null) return;
    if (v.phase === 'bidding' || v.phase === 'playing') return;
    if (!difficulties().some((d) => d.key === S.prefDiff)) return;
    S.diffSent = true;
    if (v.difficulty !== S.prefDiff) {
      send({ type: 'set_difficulty', level: S.prefDiff }, { silent: true });
    }
  }

  // ---------------------------------------------------------------- 屏幕

    // ---- 自适应牌桌（宽屏虚拟画布）：按可用高度整体等比缩放 ----
  const STAGE_H_MIN = 560;   // 可用高度低于此值：整桌等比缩小
  const STAGE_H_MAX = 760;   // 高于此值：整桌等比放大
  function layoutStage() {
    const stage = document.querySelector('.table-stage');
    if (!stage) return;
    const wide = S.inTable && stage.clientWidth >= 641;
    document.body.classList.toggle('stage-wide', wide);
    const dock = stage.querySelector('.hand-dock');
    const dockH = dock ? dock.offsetHeight : 0;
    document.body.style.setProperty('--dock-h', `${dockH}px`);
    if (!wide) {
      document.body.classList.remove('stage-short');
      ['--stage-scale', '--scene-w', '--scene-h', '--dock-h'].forEach((v) => stage.style.removeProperty(v));
      return;
    }
    const availH = Math.max(120, stage.clientHeight - dockH);
    const stageW = stage.clientWidth;
    const short = availH < STAGE_H_MIN;
    document.body.classList.toggle('stage-short', short);
    const designH = short ? STAGE_H_MIN : Math.min(availH, STAGE_H_MAX);
    const scale = Math.max(0.25, availH / designH);
    let sceneW = Math.round(stageW / scale);
    sceneW = Math.max(641, Math.min(sceneW, 1400));
    stage.style.setProperty('--stage-scale', scale.toFixed(4));
    stage.style.setProperty('--scene-w', `${sceneW}px`);
    stage.style.setProperty('--scene-h', `${Math.round(designH)}px`);
    stage.style.setProperty('--dock-h', `${dockH}px`);
  }

  function showTableScreen() {
    $('#screen-entry').classList.add('hidden');
    $('#screen-table').classList.remove('hidden');
    S.inTable = true;
    renderTable();
    requestAnimationFrame(() => { layoutStage(); layoutHand(); });
  }

  function showEntryScreen() {
    $('#screen-table').classList.add('hidden');
    $('#screen-entry').classList.remove('hidden');
    S.inTable = false;
    document.body.classList.remove('stage-wide');
    hideTurnRemind();
  }

  function renderAll() {
    if (S.inTable) renderTable();
    else renderEntry();
    if (S.drawerOpen) renderDrawer();
  }

  function layoutHand() {
    const el = $('#hand');
    if (!el) return;
    const cards = $$('.card', el);
    if (cards.length < 2) {
      el.style.removeProperty('--step');
      return;
    }
    const width = el.clientWidth;
    if (!width) return;
    const cw = cards[0].getBoundingClientRect().width;
    const avail = Math.max(0, width - 24);
    const step = Math.max(cw * .28, Math.min(cw * .7, (avail - cw) / (cards.length - 1)));
    el.style.setProperty('--step', `${step.toFixed(2)}px`);
  }

  // ---------------------------------------------------------------- 登录页

  function setEntryHeader() {
    const title = $('#entry-title');
    const sub = $('#entry-sub');
    if (!title || !sub) return;
    if (S.loggedIn && S.profile) {
      title.textContent = `${S.profile.id}，回庄园了`;
      sub.textContent = '形象、拉姆和 AI 强度都能现在改，进桌后也随时能换。';
    } else if (S.savedProfile) {
      title.textContent = '还是你吗？';
      sub.textContent = '点上面的档案直接入座，或者换一个 ID。';
    } else {
      title.textContent = '报上你的名字';
      sub.textContent = '第一次来会建一份庄园档案，下次打开还在。';
    }
  }

  function renderReturning() {
    const el = $('#returning');
    if (!el) return;
    if (S.loggedIn || !S.savedProfile) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    const p = S.savedProfile;
    el.classList.remove('hidden');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.innerHTML = `<img src="${avatarUrl(p.avatar)}" alt="">
      <span class="rv-copy"><b>${esc(p.id)}</b><span>Lv.${p.level} · ${esc(p.level_title)} · ${p.wins} 胜</span></span>
      <span class="rv-level">入座</span>
      <span class="rv-switch" role="button" tabindex="0">不是我</span>`;
  }

  function renderEntry() {
    setEntryHeader();
    renderReturning();

    const idEl = $('#player-id');
    const loginBtn = $('#login-btn');
    if (idEl) {
      idEl.disabled = !!(S.loggedIn && S.profile);
      if (S.loggedIn && S.profile) {
        idEl.value = S.profile.id;
      } else if (document.activeElement !== idEl) {
        idEl.value = S.idDraft || '';
      }
    }
    if (loginBtn) {
      loginBtn.disabled = !!S.pendingLogin;
      loginBtn.textContent = (S.loggedIn && S.profile)
        ? '换个 ID'
        : (S.pendingLogin ? '进入中…' : '进庄园');
    }

    const customize = $('#customize');
    const enter = $('#enter-table');
    const logged = !!(S.loggedIn && S.profile);
    if (customize) customize.classList.toggle('hidden', !logged);
    if (enter) enter.classList.toggle('hidden', !logged);

    if (logged) renderCustomize();
    renderHeroRam();
    updateEntryUrl();
    syncRemoteEntry();
  }

  function syncRemoteEntry() {
    try {
      const el = $('#player-id');
      const id = (S.profile && S.profile.id) || (el && el.value) || S.idDraft || '';
      if (window.manorRemoteSetup) window.manorRemoteSetup(String(id).trim());
    } catch (err) {}
  }

  function renderHeroRam() {
    const el = $('#hero-ram');
    if (!el) return;
    const ram = (S.profile && S.profile.ram) || (S.savedProfile && S.savedProfile.ram)
      || ramFor(1, 'pink', '小拉姆');
    el.innerHTML = ramSVG(ram.color, ram.stage);
  }

  function renderCustomize() {
    const p = S.profile;
    if (!p) return;
    const count = $('#roster-count');
    if (count) count.textContent = `${avatars().length} 位角色 · 随时可换`;

    renderTabs($('#origin-tabs'), S.origin, 'entry');
    renderAvatarGrid($('#avatar-grid'), p.avatar, S.origin);

    const ram = p.ram;
    const preview = $('#ram-preview');
    if (preview) preview.innerHTML = ramSVG(ram.color, ram.stage);

    const nameEl = $('#ram-name');
    if (nameEl && document.activeElement !== nameEl) nameEl.value = ram.name;

    const colorBox = $('#ram-colors');
    if (colorBox) {
      colorBox.innerHTML = colors().map((c) => `<button type="button" class="color-dot${ram.color_id === c.id ? ' active' : ''}" data-color="${esc(c.id)}" style="background:${esc(c.hex)}" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join('');
    }

    const growth = $('#ram-growth');
    if (growth) {
      const pct = Math.max(0, Math.min(100, Math.round((p.xp_pct || 0) * 100)));
      const nextText = ram.next_stage
        ? `再升到 Lv.${ram.next_stage_at} 进化为 <b>${esc(ram.next_stage)}</b>`
        : `已经是最终形态 · <b>${esc(ram.stage_name)}</b>`;
      growth.innerHTML = `
        <div class="xp-bar"><i style="width:${pct}%"></i></div>
        <div class="xp-meta"><span>Lv.${p.level} ${esc(p.level_title)}</span><span>${p.level_xp}/${p.level_need} XP</span></div>
        <div style="margin-top:5px">${esc(ram.name)} · <b>${esc(ram.stage_name)}</b><br>${nextText}<br>赢一局 +20 × 倍数经验，输了不扣</div>`;
    }

    renderDiff($('#entry-diff'), S.prefDiff, false);
    const logoPill = $('#entry-diff');
    if (logoPill) logoPill.dataset.scope = 'entry';
  }

  function renderTabs(box, active, scope) {
    if (!box) return;
    box.innerHTML = Object.keys(ORIGIN_LABELS).map((key) => `<button type="button" role="tab" class="tab${active === key ? ' active' : ''}" data-tab="${key}" data-scope="${scope}" aria-selected="${active === key}">${ORIGIN_LABELS[key]}</button>`).join('');
  }

  function renderAvatarGrid(box, active, origin) {
    if (!box) return;
    const list = avatars().filter((a) => (a.origin === 'genshin' ? 'genshin' : 'mole') === origin);
    box.innerHTML = list.map((a) => `<button type="button" class="avatar-cell${active === a.id ? ' active' : ''}" data-avatar="${esc(a.id)}" title="${esc(a.note || a.name)}"><img src="${avatarUrl(a.id)}" alt="" loading="lazy"><span>${esc(a.name)}</span></button>`).join('');
  }

  function renderDiff(box, active, disabled) {
    if (!box) return;
    box.innerHTML = difficulties().map((d) => `<button type="button" class="diff-btn${active === d.key ? ' active' : ''}" data-diff="${esc(d.key)}" ${disabled ? 'disabled' : ''}><b>${esc(d.label)}</b><span>${esc(d.note || '')}</span></button>`).join('');
  }

  function updateEntryUrl() {
    const btn = $('#entry-url');
    if (btn && S.lanUrl) {
      btn.textContent = S.lanUrl.replace(/^https?:\/\//, '');
      btn.title = `复制 ${S.lanUrl}`;
    }
    const qr = $('#entry-qr');
    if (qr && S.lanUrl && qr.dataset.url !== S.lanUrl) {
      qr.dataset.url = S.lanUrl;
      qr.src = `/api/qr.svg?text=${encodeURIComponent(S.lanUrl)}`;
    }
  }

  function applyLan() {
    updateEntryUrl();
  }

  function startLogin(raw, mode) {
    const id = String(raw || '').trim();
    if (!id) {
      toast('先填一个 ID，比如「么么」', true);
      const input = $('#player-id');
      if (input) input.focus();
      return;
    }
    if (S.pendingLogin) return;
    S.pendingLogin = true;
    S.pendingId = id;
    S.loginMode = mode;
    S.idDraft = id;
    renderEntry();
    if (!S.connected) {
      connect();
      toast('正在连接服务器…');
    } else {
      send({ type: 'login', id }, { silent: true });
    }
    clearTimeout(S.loginTimer);
    S.loginTimer = setTimeout(() => {
      if (S.pendingLogin) {
        S.pendingLogin = false;
        S.pendingId = null;
        toast('登录超时，检查一下服务器是否启动', true);
        renderEntry();
      }
    }, 9000);
  }

  function onLoginButton() {
    if (S.loggedIn && S.profile) {
      requestSwitchId();
      return;
    }
    const input = $('#player-id');
    startLogin(input ? input.value : S.idDraft, 'manual');
  }

  function forgetSaved() {
    S.savedProfile = null;
    S.idDraft = '';
    LS.del('ddz.lastId');
    renderEntry();
    toast('已清掉这台电脑上的快捷档案');
  }

  function enterTable() {
    if (!S.loggedIn) {
      toast('先进庄园，再坐到牌桌前', true);
      return;
    }
    showTableScreen();
    applyPrefDiff();
    if (S.connected) send({ type: 'state' }, { silent: true });
    const v = S.view;
    if (v && v.you == null && v.can_sit) send({ type: 'sit' }, { silent: true });
  }

  function leaveToEntry(forget) {
    send({ type: 'leave' }, { silent: true });
    const snapshot = S.profile ? { ...S.profile } : null;
    resetLocalPlayer();
    if (snapshot && !forget) {
      S.savedProfile = snapshot;
      LS.set('ddz.lastId', snapshot.id);
    }
    showEntryScreen();
    renderEntry();
    toast(forget ? '档案还留在庄园里，随时回来' : '已离开牌桌');
  }

  function requestSwitchId() {
    confirmDialog('换一个 ID？', '当前档案会留在庄园里，等级、胜场和拉姆都不会丢。', () => {
      leaveToEntry(true);
    }, '换个 ID');
  }

  function resetLocalPlayer() {
    S.loggedIn = false;
    S.pendingLogin = false;
    S.pendingId = null;
    S.loginMode = null;
    S.profile = null;
    S.view = null;
    S.pid = null;
    S.selected.clear();
    S.hints = [];
    S.hintSeq = -1;
    S.hintPending = false;
    S.actionPending = false;
    S.lastRound = -1;
    S.liveRound = -1;
    S.lastSeq = -1;
    S.lastEventSeq = -1;
    S.lastMyTurn = false;
    S.resultShownRound = null;
    S.bubbles = {};
    S.diffSent = false;
    S.originInit = false;
    S.idDraft = '';
    S.drawerOpen = false;
    S.drawerOrigin = 'mole';
    clearTimeout(S.loginTimer);
    closeModal();
    const drawer = $('#drawer-root');
    if (drawer) drawer.innerHTML = '';
  }

  // ---------------------------------------------------------------- 牌桌

  function renderTable() {
    const v = S.view;
    renderTopbar(v);
    renderSeats(v);
    renderBoard(v);
    renderPlayZones(v);
    renderLobby(v);
    renderHandDock(v);
    renderBars(v);
    requestAnimationFrame(layoutHand);
  }

  function phaseLabel(v) {
    if (!v) return '连接中';
    const map = {
      waiting: '候场', bidding: '叫地主', playing: '出牌',
      ended: '结算', redeal: '重发',
    };
    return map[v.phase] || '候场';
  }

  function aiHostLabel() {
    if (window.__manorAiHost) return String(window.__manorAiHost);
    if (window.__MANOR_LOCAL__ || window.__MANOR_IOS__) {
      const name = (S.profile && S.profile.id) || S.idDraft || '';
      return name ? `${name} 的 iPad` : '本机 iPad';
    }
    return S.aiHost || '家里电脑';
  }

  function renderTopbar(v) {
    const aiChip = $('#ai-host-chip');
    if (aiChip) {
      const label = aiHostLabel();
      aiChip.textContent = `AI 推理：${label}`;
      aiChip.title = `AI 推理设备：${label}`;
    }
    const pill = $('#round-pill');
    if (pill) {
      pill.textContent = (!v || !v.game)
        ? (v && v.round ? `第 ${v.round} 局 · 候场` : '等待开局')
        : `第 ${v.round} 局 · ${phaseLabel(v)}`;
    }
    const g = v && v.game;
    const mult = g
      ? (g.phase === 'bidding'
        ? (g.current_multiplier || 1)
        : (g.multiplier || g.current_multiplier || 1))
      : 1;
    const chip = $('#mult-chip');
    if (chip) {
      chip.classList.toggle('hidden', !(v && v.game));
      chip.textContent = `×${mult}`;
    }
    const me = v && v.me;
    if (me) {
      const img = $('#chip-avatar');
      if (img) img.src = avatarUrl(me.avatar);
      const name = $('#chip-name');
      if (name) name.textContent = me.id;
      const level = $('#chip-level');
      if (level) level.textContent = `Lv.${me.level} · ${me.level_title}`;
      const ram = $('#chip-ram');
      if (ram) ram.innerHTML = ramSVG(me.ram.color, me.ram.stage);
    }
    const remoteBtn = $('#remote-table-btn');
    if (remoteBtn) {
      const pid = (me && me.id) || (S.profile && S.profile.id) || '';
      const allowed = typeof window.manorRemoteAllowed === 'function'
        && window.manorRemoteAllowed(pid);
      remoteBtn.classList.toggle('hidden', !allowed);
      if (allowed && !remoteBtn.__manorRemoteBound) {
        remoteBtn.__manorRemoteBound = true;
        remoteBtn.addEventListener('click', () => {
          if (window.manorRemoteOpen) window.manorRemoteOpen();
        });
      }
    }
  }

  function renderSeats(v) {
    const top = $('#seat-top');
    const left = $('#seat-left');
    const right = $('#seat-right');
    if (!top || !left || !right) return;

    if (!v) {
      [top, left, right].forEach((el) => { el.classList.add('hidden'); el.innerHTML = ''; });
      return;
    }

    const slots = v.you == null
      ? [['top', top, 0], ['left', left, 1], ['right', right, 2]]
      : [['left', left, (v.you + 2) % 3], ['right', right, (v.you + 1) % 3]];

    if (v.you != null) {
      top.classList.add('hidden');
      top.innerHTML = '';
    }

    for (const [name, el, idx] of slots) {
      const seat = (v.seats || [])[idx];
      if (!seat) {
        el.classList.add('hidden');
        el.innerHTML = '';
        continue;
      }
      const g = v.game;
      const biddingTurn = !!(g && g.phase === 'bidding'
        && (g.grab_active ? g.grab_turn === idx : g.call_turn === idx));
      const turn = !!(g && (biddingTurn || (g.phase === 'playing' && g.current === idx)));
      const bubble = S.bubbles[idx] && (Date.now() - S.bubbles[idx].ts < 4000)
        ? S.bubbles[idx] : null;
      const crown = g && g.landlord === idx;
      const sub = [];

      if (g && (g.phase === 'playing' || g.phase === 'ended') && g.counts) {
        sub.push(`<span class="count"><i class="count-icon"></i>${g.counts[idx] == null ? 0 : g.counts[idx]}</span>`);
      }
      if (seat.is_bot) {
        sub.push(`<span class="seat-tag ai" title="${esc(seat.ai_label || '')}">AI<span class="ai-diff">·${esc(seat.ai_label || '')}</span></span>`);
      } else {
        const score = Number(seat.score || 0);
        if (score) sub.push(`<span class="score">${score > 0 ? '+' : ''}${score}</span>`);
        if (!g || g.phase === 'ended') {
          if (seat.autopilot || !seat.connected) {
            sub.push('<span class="seat-tag">离线</span>');
          } else {
            sub.push(seat.ready
              ? '<span class="seat-tag ready">已准备</span>'
              : '<span class="seat-tag">未准备</span>');
          }
        } else if (seat.autopilot) sub.push('<span class="seat-tag auto">托管</span>');
        else if (!seat.connected) sub.push('<span class="seat-tag">离线</span>');
      }
      if (turn && !seat.autopilot) {
        sub.push('<span class="thinking"><i></i><i></i><i></i></span>');
      }

      el.innerHTML = `<div class="seat-card" title="查看 ${esc(seat.name)} 的玩家详情">
        ${crown ? `<span class="seat-crown">${CROWN_SVG}</span>` : ''}
        ${bubble ? `<span class="seat-bubble${bubble.pass ? ' pass' : ''}">${esc(bubble.text)}</span>` : ''}
        <span class="avatar-badge">
          <img src="${esc(seat.avatar_url || avatarUrl(seat.avatar))}" alt="">
          <span class="lv-tag${seat.is_bot ? ' gold' : ''}">Lv.${seat.level || 1}</span>
        </span>
        <span class="seat-info">
          <span class="seat-name">${esc(seat.name)}${seat.is_me ? ' · 你' : ''}</span>
          <span class="seat-sub">${sub.join('')}</span>
        </span>
        ${seat.ram ? `<span class="seat-ram">${ramSVG(seat.ram.color, seat.ram.stage)}</span>` : ''}
      </div>`;
      el.classList.remove('hidden');
      el.classList.toggle('turn', turn);
      el.classList.toggle('offline', !seat.is_bot && !seat.connected);
      el.dataset.seat = String(idx);
      el.dataset.slot = name;
    }
  }

  function renderBoard(v) {
    const g = v && v.game;
    const status = $('#board-status');
    if (status) {
      let text = '等待家人入座';
      let hot = false;
      if (v && v.you == null) {
        if (!g) text = '观众席 · 等待开局';
        else if (g.phase === 'bidding' && g.grab_active) {
          text = autopilotAt(g.grab_turn)
            ? `观战 · 等待 ${nameOf(g.grab_turn)} 回来抢地主`
            : `观战 · ${nameOf(g.grab_turn)} 正在抢地主`;
        } else if (g.phase === 'bidding') {
          text = autopilotAt(g.call_turn)
            ? `观战 · 等待 ${nameOf(g.call_turn)} 回来叫地主`
            : `观战 · ${nameOf(g.call_turn)} 正在叫地主`;
        } else if (g.phase === 'playing') {
          text = autopilotAt(g.current)
            ? `观战 · 等待 ${nameOf(g.current)} 回来出牌`
            : `观战 · ${nameOf(g.current)} 正在出牌`;
        } else if (g.phase === 'ended') text = '本局结束';
        else text = '重新发牌中…';
      } else if (g) {
        if (g.phase === 'bidding' && g.grab_active) {
          hot = g.grab_turn === v.you;
          const reback = g.grab_turn === g.caller && g.grabs > 0;
          text = hot
            ? (reback ? '轮到你抢回，再抢一次倍数 ×2' : '轮到你抢地主，抢一次倍数 ×2')
            : (autopilotAt(g.grab_turn)
              ? `等待 ${nameOf(g.grab_turn)} 回来抢地主`
              : `${nameOf(g.grab_turn)} 正在决定是否抢地主`);
        } else if (g.phase === 'bidding') {
          hot = g.call_turn === v.you;
          text = hot ? '轮到你叫地主' : (autopilotAt(g.call_turn)
            ? `等待 ${nameOf(g.call_turn)} 回来叫地主`
            : `${nameOf(g.call_turn)} 正在叫地主`);
        } else if (g.phase === 'playing') {
          hot = g.current === v.you;
          text = hot ? '轮到你出牌' : (autopilotAt(g.current)
            ? `等待 ${nameOf(g.current)} 回来出牌`
            : `${nameOf(g.current)} 正在思考…`);
        } else if (g.phase === 'ended') {
          text = g.result && g.result.landlord_win ? '地主赢了 · 本局结束' : '农民赢了 · 本局结束';
        } else if (g.phase === 'redeal') {
          text = '三家都不叫，重新发牌…';
        }
      } else if (v) {
        const meSeat = v.you != null ? (v.seats || [])[v.you] : null;
        if (meSeat && meSeat.ready) {
          const left = Math.max(0, (v.human_count || 0) - (v.ready_count || 0));
          text = left > 0 ? `已准备 · 还差 ${left} 位家人` : '全部准备好了，发牌…';
        } else {
          text = v.you != null ? '全部按准备后开局，空位由 AI 补上' : '等待家人按准备';
        }
      }
      status.classList.toggle('your-turn', hot);
      status.innerHTML = `<span class="status-dot"></span><span>${esc(text)}</span>`;
    }

    const bottomArea = $('#bottom-area');
    const bottomCards = $('#bottom-cards');
    if (bottomArea && bottomCards) {
      const show = !!(g && (g.phase === 'bidding' || g.phase === 'playing' || g.phase === 'ended'));
      bottomArea.classList.toggle('hidden', !show);
      if (show) {
        if (g.bottom && g.bottom.length) {
          bottomCards.innerHTML = g.bottom.map((id) => cardHTML(id)).join('');
        } else {
          bottomCards.innerHTML = '<div class="card back"></div>'.repeat(3);
        }
      }
    }

    const center = $('#center');
    if (!center) return;
    if (!g || g.phase === 'waiting' || g.phase === 'ended' || g.phase === 'redeal') {
      center.innerHTML = '';
      return;
    }
    if (g.phase === 'bidding') {
      center.innerHTML = g.grab_active
        ? '<div class="play-empty"><div class="emblem">抢</div><span>抢地主中 · 每抢一次倍数 ×2</span></div>'
        : '<div class="play-empty"><div class="emblem">叫</div><span>底牌已就位，等待叫地主</span></div>';
      return;
    }
    if (g.phase !== 'playing') {
      center.innerHTML = '';
      return;
    }
    const anyPlayed = (g.last_action || []).some((cards) => cards && cards.length);
    if (anyPlayed) {
      center.innerHTML = '';
      return;
    }
    center.innerHTML = '<div class="play-empty"><div class="emblem">斗</div><span>新的一轮，自由出牌</span></div>';
  }

  function playZoneSeats(v) {
    if (!v || !v.game) return null;
    if (v.you != null) {
      return {
        bottom: v.you,
        left: (v.you + 2) % 3,
        right: (v.you + 1) % 3,
        top: null,
      };
    }
    return { top: 0, left: 1, right: 2, bottom: null };
  }

  function renderPlayZones(v) {
    const zones = {
      top: $('#play-top'),
      left: $('#play-left'),
      right: $('#play-right'),
      bottom: $('#play-bottom'),
    };
    const g = v && v.game;
    const seats = playZoneSeats(v);
    // 结算后把没打出去的牌摊在各自座位前；自己的手牌本来就在下方，不重复
    const ended = !!(g && g.phase === 'ended' && g.result && Array.isArray(g.result.hands));
    const active = !!(g && g.phase === 'playing'
      && g.last_combo && g.last_combo_cards && g.last_combo_cards.length);

    for (const key of Object.keys(zones)) {
      const el = zones[key];
      if (!el) continue;
      const idx = seats ? seats[key] : null;
      let cards = [];
      let reveal = false;
      let winner = false;
      if (ended && idx != null) {
        const left = g.result.hands[idx] || [];
        if (left.length) {
          // 剩牌摊在座位前；自己的剩牌本来就在手牌区，不重复
          if (idx !== v.you) {
            reveal = true;
            cards = orderedHand(left);
          }
        } else if (g.last_play_seat === idx && g.last_combo
          && Array.isArray(g.last_combo_cards) && g.last_combo_cards.length) {
          // 赢家最后一手：留在桌上让大家看清
          const last = (g.last_action && g.last_action[idx]) || [];
          cards = last.length ? last : g.last_combo_cards;
          winner = true;
        }
      } else if (active && idx != null && g.last_action) {
        cards = g.last_action[idx] || [];
      }
      if (!cards.length) {
        el.classList.add('hidden');
        el.innerHTML = '';
        el.classList.remove('reveal', 'winner', 'live', 'stale');
        continue;
      }
      const live = !ended && g.last_play_seat === idx;
      const combo = winner
        ? `胜 · ${g.last_combo.label || ''}`
        : ended
          ? `剩 ${cards.length} 张`
          : (live && g.last_combo ? (g.last_combo.label || '') : '');
      const bomb = !!(live && g.last_combo
        && (g.last_combo.type === 'bomb' || g.last_combo.type === 'rocket'));
      el.dataset.actor = String(idx);
      el.classList.remove('hidden');
      el.classList.toggle('reveal', reveal);
      el.classList.toggle('winner', winner);
      el.classList.toggle('live', live);
      el.classList.toggle('stale', !ended && !live);
      el.style.setProperty('--n', String(cards.length));
      el.innerHTML = `<div class="play-zone-head">
          <span class="pz-name">${esc(nameOf(idx))}${idx === v.you ? ' · 你' : ''}</span>
          ${combo ? `<span class="combo-chip${bomb ? ' bomb' : ''}">${esc(combo)}</span>` : ''}
        </div>
        <div class="play-cards">${cards.map((id, i) => cardHTML(id, { i })).join('')}</div>`;
    }
    requestAnimationFrame(layoutPlayZones);
  }

  function layoutPlayZones() {
    $$('.play-zone').forEach((zone) => {
      if (zone.classList.contains('hidden')) return;
      const cards = $$('.play-cards .card', zone);
      if (cards.length < 2) {
        zone.style.removeProperty('--pstep');
        return;
      }
      const width = zone.clientWidth - 10;
      const cw = cards[0].getBoundingClientRect().width;
      if (!cw || width <= 0) return;
      const step = Math.max(5, Math.min(cw * .62, (width - cw) / (cards.length - 1)));
      zone.style.setProperty('--pstep', `${step.toFixed(2)}px`);
    });
  }

  function renderLobby(v) {
    const box = $('#lobby-panel');
    if (!box) return;
    const peek = !!(S.peekTable && v && v.phase === 'ended');
    const show = !v || !v.game || v.phase === 'waiting' || (v.phase === 'ended' && !peek);
    box.classList.toggle('hidden', !show);
    if (!show) {
      box.innerHTML = '';
      return;
    }

    const seats = (v && v.seats) || [null, null, null];
    const chips = seats.map((seat, i) => {
      if (!seat) return `<span class="lobby-seat empty">空位 ${i + 1} · AI 补位</span>`;
      let status = '未准备';
      if (seat.is_bot) status = `AI·Lv.${seat.level || 1}`;
      else if (seat.autopilot || !seat.connected) status = '离线';
      else if (seat.ready) status = '已准备';
      return `<button type="button" class="lobby-seat${seat.is_bot ? ' bot' : ''}${seat.ready ? ' ready' : ''}" data-open-seat="${i}" title="查看 ${esc(seat.name)} 的详情">
        <img src="${esc(seat.avatar_url || avatarUrl(seat.avatar))}" alt="">
        <b>${esc(seat.name)}</b>
        <span class="tiny${seat.ready ? ' ok' : ''}">${status}</span>
      </button>`;
    }).join('');

    const me = v && v.me;
    const ended = v && v.phase === 'ended';
    const title = ended ? '这一局结束了' : (v && v.round ? `第 ${v.round} 局打完了` : '三缺一，机器人补位');
    const copy = (v && v.you != null)
      ? (v.human_count > 1
        ? `牌桌上 ${v.human_count} 位真人，全部按准备后自动开局。空位由 DouZero AI 补上。`
        : '一个人也能开局，空位由 DouZero AI 补上，强度随时可调。')
      : '同一张牌桌，不用房间号。等这一局结束就能入座。';
    const meSeat = v && v.you != null ? (v.seats || [])[v.you] : null;
    const meReady = !!(meSeat && meSeat.ready);
    const readyLabel = meReady ? '取消准备' : (ended ? '准备下一局' : '准备');
    const progress = v && v.you != null
      ? `已准备 ${v.ready_count || 0}/${v.human_count || 0} 人` : '';

    box.innerHTML = `
      <div class="lobby-kicker">MOLE MANOR · SAME TABLE</div>
      <h3 class="lobby-title">${esc(title)}</h3>
      <p class="lobby-copy">${esc(copy)}</p>
      <div class="lobby-seats">${chips}</div>
      ${v && v.you != null ? '<div class="lobby-diff" id="lobby-diff"></div>' : ''}
      <div class="lobby-actions">
        ${v && v.you != null && v.can_ready ? `<button type="button" class="btn ${meReady ? 'btn-soft' : 'btn-primary'}" data-ready>${readyLabel}</button>` : ''}
        ${v && v.you == null && v.can_sit ? '<button type="button" class="btn btn-primary" data-sit>入座</button>' : ''}
        ${v && v.you == null && !v.can_sit ? '<span class="lobby-tip">本局进行中，结束后就能入座</span>' : ''}
      </div>
      <p class="lobby-tip">${progress ? `<b>${progress}</b> · 全部准备后自动开局` : ''}${progress ? ' · ' : ''}${me ? `你是 ${esc(me.id)} · ` : ''}${v ? `${v.online || 1} 人在线` : ''}</p>`;

    if (v && v.you != null) {
      renderDiff($('#lobby-diff'), v.difficulty, false);
    }
  }

  function defaultHint(v) {
    if (!v) return '正在连接牌桌…';
    const g = v.game;
    if (!g) {
      return v.you != null
        ? '全部准备后自动开局 · 空位由 AI 补上'
        : '三缺一时机器人会补位 · 入座后按准备';
    }
    if (g.phase === 'bidding' && g.grab_active) {
      if (g.grab_turn === v.you) {
        return g.grab_turn === g.caller && g.grabs > 0
          ? '轮到你抢回 · 再抢一次倍数 ×2'
          : '轮到你抢地主 · 每抢一次倍数 ×2';
      }
      if (autopilotAt(g.grab_turn)) return `${nameOf(g.grab_turn)} 托管中 · 等他回来抢地主`;
      return `等待 ${nameOf(g.grab_turn)} 决定是否抢地主…`;
    }
    if (g.phase === 'bidding') {
      if (g.call_turn === v.you) return '轮到你叫地主 · 叫了之后别家可以抢';
      if (autopilotAt(g.call_turn)) return `${nameOf(g.call_turn)} 托管中 · 等他回来叫地主`;
      return '等其他玩家叫地主…';
    }
    if (g.phase === 'redeal') return '三家都不叫，正在重新发牌…';
    if (g.phase === 'ended') {
      if (v.you == null) {
        return v.can_sit ? '本局结束 · 入座下一局' : '本局结束 · 三位都坐着，等有人离开才能入座';
      }
      return '本局结束 · 按准备开下一局，赢了加经验，输了不扣';
    }
    if (v.you == null) return '观战中 · 下一局可以入座';
    if (g.current === v.you) return '点牌或横向滑动选牌，再点「出牌」';
    if (autopilotAt(g.current)) return `${nameOf(g.current)} 托管中 · 等他回来再继续`;
    return `${nameOf(g.current)} 正在思考…`;
  }

  function renderHandDock(v) {
    const hand = $('#hand');
    if (!hand) return;
    const g = v && v.game;
    const me = v && v.me;
    const mine = v && v.you != null ? (v.seats || [])[v.you] : null;

    if (me) {
      const img = $('#hand-avatar');
      if (img) img.src = avatarUrl(me.avatar);
      const name = $('#hand-name');
      if (name) name.textContent = me.id;
      const level = $('#hand-level');
      if (level) level.textContent = `Lv.${me.level} · ${me.level_title}`;
      const xp = $('#hand-xp');
      if (xp) xp.style.width = `${Math.max(0, Math.min(100, Math.round((me.xp_pct || 0) * 100)))}%`;
      const ram = $('#hand-ram');
      if (ram) ram.innerHTML = ramSVG(me.ram.color, me.ram.stage);
    }

    const readyEl = $('#hand-ready');
    if (readyEl) {
      // 结算时改由右侧“准备下一局”按钮显示，别再挤名字
      const waiting = !g;
      const meSeat = v && v.you != null ? (v.seats || [])[v.you] : null;
      const show = !!(waiting && meSeat && !meSeat.is_bot);
      readyEl.classList.toggle('hidden', !show);
      if (show) {
        readyEl.textContent = meSeat.ready ? '已准备' : '未准备';
        readyEl.classList.toggle('ok', !!meSeat.ready);
      }
    }

    const role = $('#hand-role');
    if (role) {
      const seatIndex = v && v.you;
      if (g && g.your_position) {
        const landlord = g.your_position === 'landlord';
        role.className = `role-chip show${landlord ? ' landlord' : ''}`;
        role.textContent = landlord ? '地主' : '农民';
      } else {
        role.className = 'role-chip';
        role.textContent = '';
      }
      if (seatIndex == null) role.className = 'role-chip';
    }

    const score = $('#hand-score');
    if (score) score.textContent = mine ? `积分 ${mine.score > 0 ? '+' : ''}${mine.score || 0}` : '';

    const orderBtn = $('#hand-order');
    if (orderBtn) {
      // 结算时给“准备下一局”腾位置，顺序仍可在档案抽屉里改
      const hasHand = !!(v && v.you != null && g && g.hand && g.hand.length
        && g.phase !== 'ended');
      orderBtn.classList.toggle('hidden', !hasHand);
      orderBtn.textContent = S.handOrder === 'desc' ? '大→小' : '小→大';
      orderBtn.title = S.handOrder === 'desc' ? '当前从大到小，点一下换成小到大' : '当前从小到大，点一下换成大到小';
    }

    const nextBtn = $('#hand-next');
    if (nextBtn) {
      const ended = !!(g && g.phase === 'ended');
      const show = !!(ended && v && v.you != null);
      nextBtn.classList.toggle('hidden', !show);
      if (show) nextBtn.textContent = mine && mine.ready ? '取消准备' : '准备下一局';
    }

    const sitBtn = $('#spectate-sit');
    if (sitBtn) {
      sitBtn.classList.toggle('hidden', !(v && v.you == null && v.can_sit));
      sitBtn.textContent = v && v.phase === 'ended' ? '入座下一局' : '入座';
    }

    if (!v || v.you == null) {
      const full = v && !v.can_sit;
      hand.innerHTML = `<div class="hand-empty">
        <span class="backs">${'<div class="card back"></div>'.repeat(3)}</span>
        <span>${v && (v.phase === 'bidding' || v.phase === 'playing') ? '你在观战，下一局可以入座' : (full ? '三位都坐满了，先看看牌局吧' : '入座后就能摸牌')}</span>
      </div>`;
      const hint = $('#hand-hint');
      if (hint) hint.textContent = defaultHint(v);
      return;
    }

    if (!g) {
      const meSeat = v.you != null ? (v.seats || [])[v.you] : null;
      const label = meSeat && meSeat.ready ? '已准备 · 等其他人按准备' : '等待开局 · 按准备，空位由 AI 补上';
      hand.innerHTML = `<div class="hand-empty">
        <span class="backs">${'<div class="card back"></div>'.repeat(3)}</span>
        <span>${label}</span>
      </div>`;
      const hint = $('#hand-hint');
      if (hint) hint.textContent = defaultHint(v);
      return;
    }

    const cards = orderedHand(g.hand || []);
    if (!cards.length) {
      hand.innerHTML = '<div class="hand-empty"><span>手牌出完了，等这一局结算</span></div>';
    } else {
      const selectable = g.phase === 'playing';
      hand.innerHTML = cards.map((id, i) => cardHTML(id, {
        selectable,
        selected: S.selected.has(Number(id)),
        dealing: S.dealAnim,
        i,
      })).join('');
    }

    const hint = $('#hand-hint');
    if (hint) {
      hint.classList.toggle('hot', !!myTurn(v));
      const meSeat = v.you != null ? (v.seats || [])[v.you] : null;
      if (g && g.phase === 'ended' && v.you != null) {
        hint.textContent = meSeat && meSeat.ready
          ? `已准备 · 等其他人（${v.ready_count || 0}/${v.human_count || 0}）`
          : '本局结束 · 按准备开下一局，赢了加经验，输了不扣';
      } else {
        hint.textContent = defaultHint(v);
      }
    }
    requestAnimationFrame(layoutHand);
  }

  function renderBars(v) {
    const bidding = $('#bidding');
    const actions = $('#actions');
    if (!bidding || !actions) return;

    let bidHTML = '';
    let actHTML = '';

    if (v && v.you != null && v.game) {
      const g = v.game;
      if (g.phase === 'bidding' && g.grab_active && g.grab_turn === v.you) {
        const disabled = S.actionPending ? 'disabled' : '';
        const reback = g.grab_turn === g.caller && g.grabs > 0;
        bidHTML = `
          <button type="button" class="bid-btn zero" data-grab="0" ${disabled}>不抢</button>
          <button type="button" class="bid-btn hot" data-grab="1" ${disabled}>${reback ? '抢回 ×2' : '抢地主 ×2'}</button>`;
      } else if (g.phase === 'bidding' && !g.grab_active && g.call_turn === v.you) {
        const disabled = S.actionPending ? 'disabled' : '';
        bidHTML = `
          <button type="button" class="bid-btn zero" data-call="0" ${disabled}>不叫</button>
          <button type="button" class="bid-btn hot" data-call="1" ${disabled}>叫地主</button>`;
      }
      if (g.phase === 'playing' && g.current === v.you) {
        const canPass = !!g.last_combo;
        actHTML = `<span class="selected">${S.selected.size ? `已选 ${S.selected.size} 张` : '点牌或滑动选牌'}</span>
          <button type="button" class="act-btn pass" data-act="pass" ${canPass && !S.actionPending ? '' : 'disabled'}>不要</button>
          <button type="button" class="act-btn" data-act="hint" ${S.hintPending || S.actionPending ? 'disabled' : ''}>提示</button>
          <button type="button" class="act-btn primary" data-act="play" ${S.selected.size && !S.actionPending ? '' : 'disabled'}>出牌</button>`;
      }
    }

    bidding.innerHTML = bidHTML;
    bidding.classList.toggle('hidden', !bidHTML);
    actions.innerHTML = actHTML;
    actions.classList.toggle('hidden', !actHTML);
  }

  // ---------------------------------------------------------------- 操作

  let handDrag = null;
  let handDragAteClick = false;

  function paintCardSelection(id, on) {
    const btn = $(`#hand [data-card="${id}"]`);
    if (!btn) return false;
    if (S.selected.has(id) === on) return false;
    if (on) S.selected.add(id);
    else S.selected.delete(id);
    btn.classList.toggle('selected', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    return true;
  }

  function afterSelectionChange() {
    renderBars(S.view);
    const hint = $('#hand-hint');
    if (hint && S.view) {
      hint.textContent = S.selected.size
        ? `已选 ${S.selected.size} 张 · 再点一次或从已选牌拖动取消`
        : defaultHint(S.view);
    }
  }

  function paintDragRange(fromX, toX, y, on) {
    const cards = $$('#hand [data-card]');
    if (!cards.length) return;
    const rects = cards.map((btn) => btn.getBoundingClientRect());
    const lo = Math.min(fromX, toX) - 3;
    const hi = Math.max(fromX, toX) + 3;
    let changed = false;
    cards.forEach((btn, i) => {
      const box = rects[i];
      // 交错叠放时，每张牌可点的只有左侧露出的那条
      const stripRight = i + 1 < rects.length ? rects[i + 1].left : box.right;
      if (hi < box.left || lo > stripRight) return;
      if (y < box.top - 10 || y > box.bottom + 10) return;
      if (paintCardSelection(Number(btn.dataset.card), on)) changed = true;
    });
    return changed;
  }

  function onHandPointerDown(event) {
    handDragAteClick = false;
    if (!event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const btn = event.target.closest('#hand [data-card]');
    if (!btn) return;
    const startCard = Number(btn.dataset.card);
    handDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      moved: false,
      startCard,
      // 从已选中的牌起拖 = 取消选择，从未选的牌起拖 = 连选
      on: !S.selected.has(startCard),
    };
  }

  function onHandPointerMove(event) {
    if (!handDrag || event.pointerId !== handDrag.pointerId) return;
    const dx = event.clientX - handDrag.startX;
    const dy = event.clientY - handDrag.startY;
    let changed = false;
    if (!handDrag.moved) {
      // 先横向越过阈值才算连选，避免竖着划一下误触
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
      handDrag.moved = true;
      handDragAteClick = true;
      changed = paintCardSelection(handDrag.startCard, handDrag.on);
    }
    if (paintDragRange(handDrag.lastX, event.clientX, event.clientY, handDrag.on)) changed = true;
    handDrag.lastX = event.clientX;
    if (changed) afterSelectionChange();
  }

  function onHandPointerEnd(event) {
    if (!handDrag || event.pointerId !== handDrag.pointerId) return;
    handDrag = null;
  }

  function onHandClick(event) {
    if (handDragAteClick) {
      handDragAteClick = false;
      if (event.detail !== 0) return;
    }
    const btn = event.target.closest('[data-card]');
    if (!btn) return;
    const id = Number(btn.dataset.card);
    if (!Number.isFinite(id)) return;
    const on = !S.selected.has(id);
    paintCardSelection(id, on);
    Sfx.click();
    afterSelectionChange();
  }

  function renderHandSelection() {
    $$('#hand [data-card]').forEach((btn) => {
      const on = S.selected.has(Number(btn.dataset.card));
      btn.classList.toggle('selected', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function requestHint() {
    const v = S.view;
    const g = v && v.game;
    if (!g || v.you == null || g.current !== v.you) return;
    if (S.hintSeq === g.seq && S.hints.length) {
      cycleHint();
      return;
    }
    if (S.hintPending) return;
    S.hintPending = true;
    acknowledgeTurn();
    S.hints = [];
    renderBars(v);
    if (!send({ type: 'hint' })) S.hintPending = false;
  }

  function onHints(list) {
    S.hintPending = false;
    const v = S.view;
    if (!v || !v.game) { renderBars(v); return; }
    S.hintSeq = v.game.seq;
    S.hintIdx = 0;
    S.hints = (Array.isArray(list) ? list : []).filter((h) => Array.isArray(h) && h.length);
    if (!S.hints.length) {
      toast('这一手没有能压过的牌，只能不要');
      renderBars(v);
      return;
    }
    applyHint();
  }

  function cycleHint() {
    if (!S.hints.length) return;
    S.hintIdx = (S.hintIdx + 1) % S.hints.length;
    applyHint();
  }

  function applyHint() {
    const hint = S.hints[S.hintIdx] || [];
    S.selected = new Set(hint.map(Number));
    renderHandSelection();
    renderBars(S.view);
    const el = $('#hand-hint');
    if (el) el.textContent = `提示 ${S.hintIdx + 1}/${S.hints.length} · 再点「提示」换一种`;
  }

  function clearSelection() {
    S.selected.clear();
    renderHandSelection();
    renderBars(S.view);
  }

  function doCall(want) {
    if (S.actionPending) return;
    S.actionPending = true;
    acknowledgeTurn();
    Sfx.click();
    renderBars(S.view);
    if (!send({ type: 'call', want: !!want })) S.actionPending = false;
  }

  function doGrab(want) {
    if (S.actionPending) return;
    S.actionPending = true;
    acknowledgeTurn();
    Sfx.click();
    renderBars(S.view);
    if (!send({ type: 'grab', want: !!want })) S.actionPending = false;
  }

  function doPlay() {
    if (S.actionPending) return;
    const cards = Array.from(S.selected).map(Number).sort((a, b) => a - b);
    if (!cards.length) {
      toast('先点牌选中再出', true);
      return;
    }
    S.actionPending = true;
    acknowledgeTurn();
    renderBars(S.view);
    if (!send({ type: 'play', cards })) S.actionPending = false;
    else S.hints = [];
  }

  function doPass() {
    if (S.actionPending) return;
    S.actionPending = true;
    acknowledgeTurn();
    renderBars(S.view);
    if (!send({ type: 'pass' })) S.actionPending = false;
    else {
      S.selected.clear();
      renderHandSelection();
    }
  }

  function setHandOrder(order, opts = {}) {
    const next = order === 'desc' ? 'desc' : 'asc';
    S.handOrder = next;
    S.orderEditAt = Date.now();
    LS.set('ddz.handOrder', next);
    if (S.loggedIn && opts.persist !== false) {
      // 存在这个 ID 的庄园档案里，换设备也记得
      send({ type: 'update_settings', settings: { hand_order: next } }, { silent: true });
    }
    if (S.inTable && S.view) renderAll();
    else renderEntry();
    requestAnimationFrame(layoutHand);
  }

  function chooseDiff(key) {
    if (!difficulties().some((d) => d.key === key)) return;
    S.prefDiff = key;
    LS.set('ddz.diff', key);
    Sfx.click();
    S.diffSent = false;
    const v = S.view;
    if (v && v.you != null && v.phase !== 'bidding' && v.phase !== 'playing') {
      S.diffSent = true;
      if (v.difficulty !== key) send({ type: 'set_difficulty', level: key }, { silent: true });
    } else if (v && v.you != null && v.difficulty !== key) {
      toast('等这一局结束，AI 就换成「' + (difficulties().find((d) => d.key === key) || {}).label + '」');
    }
    if (S.inTable) renderAll();
    else renderCustomize();
  }

  function chooseAvatar(id) {
    if (!S.loggedIn || !S.profile) return;
    const meta = avatarMeta(id);
    if (!meta || S.profile.avatar === id) return;
    S.profile.avatar = meta.id;
    S.profile.avatar_meta = meta;
    S.origin = originOfAvatar(meta.id);
    Sfx.click();
    send({ type: 'update_profile', avatar: meta.id }, { silent: true });
    renderAll();
  }

  function chooseColor(id) {
    if (!S.loggedIn || !S.profile) return;
    const color = colorOf(id);
    if (!color) return;
    S.profile.ram = ramFor(S.profile.level, color.id, S.profile.ram.name);
    Sfx.click();
    send({ type: 'update_profile', ram_color: color.id }, { silent: true });
    renderAll();
  }

  function saveRamName(raw) {
    if (!S.loggedIn || !S.profile) return;
    const name = String(raw || '').trim().slice(0, 8);
    if (!name) {
      toast('拉姆得有个名字', true);
      return;
    }
    if (name === S.profile.ram.name) return;
    S.profile.ram = ramFor(S.profile.level, S.profile.ram.color_id, name);
    send({ type: 'update_profile', ram_name: name }, { silent: true });
    renderAll();
  }

  // ---------------------------------------------------------------- 结果 / 弹窗

  function maybeShowResult(v) {
    if (!S.inTable) return;
    const g = v && v.game;
    if (!g || !g.result || v.round === S.resultShownRound) return;
    const rewards = v.rewards || [];
    const mine = rewards.some((x) => (x.pid
      ? (S.pid && x.pid === S.pid)
      : (v.you != null && x.seat === v.you)));
    // 重连后不把上一局的结果弹给刚坐下的人
    if (!mine && S.liveRound !== v.round) return;
    showResult(v);
  }

  function showResult(v) {
    const g = v.game;
    const r = g.result;
    if (!r) return;
    S.resultShownRound = v.round;

    const my = v.you;
    const won = my == null ? null : (r.landlord === my ? !!r.landlord_win : !r.landlord_win);
    const rewards = v.rewards || [];
    const reward = rewards.find((x) => x.pid && S.pid && x.pid === S.pid)
      || rewards.find((x) => !x.pid && my != null && x.seat === my)
      || null;
    const winnerText = r.landlord_win ? '地主胜' : '农民胜';

    const rows = (v.seats || []).map((seat, i) => {
      if (!seat) return '';
      const delta = Number((r.deltas || [])[i] || 0);
      const found = rewards.find((x) => x.seat === i) || null;
      const rp = found && (!found.pid || (seat.pid && found.pid === seat.pid)) ? found : null;
      const role = r.landlord === i ? '地主' : '农民';
      return `<div class="result-row${i === my ? ' me' : ''}">
        <img src="${esc(seat.avatar_url || avatarUrl(seat.avatar))}" alt="">
        <span class="rr-name">${esc(seat.name)}</span>
        <span class="rr-role">${role}</span>
        ${rp ? `<span class="rr-xp">${rp.won ? `+${rp.xp_gain} XP` : '未获胜'}</span>` : ''}
        <span class="rr-delta ${delta >= 0 ? 'plus' : 'minus'}">${delta > 0 ? '+' : ''}${delta}</span>
      </div>`;
    }).join('');

    const chips = [
      '底分 100',
      r.caller != null ? `叫地主 · ${nameOf(r.caller)}` : '',
      r.grabs ? `抢地主 ×${r.grabs}` : '',
      `炸弹 ${r.bombs}`,
      r.spring ? '春天 ×2' : '',
      r.anti_spring ? '反春 ×2' : '',
      `最终 ×${r.multiplier}`,
      `本局 ${r.total}`,
    ].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join('');

    const leftRows = Array.isArray(r.hands) ? (v.seats || []).map((seat, i) => {
      if (!seat) return '';
      const cards = orderedHand(r.hands[i] || []);
      const role = r.landlord === i ? '地主' : '农民';
      const body = cards.length
        ? `<span class="rl-cards">${cards.map((id) => cardHTML(id)).join('')}</span>`
        : '<span class="rl-empty">出完了</span>';
      return `<div class="rl-row">
        <span class="rl-name">${esc(seat.name)} <em>${role}</em></span>
        ${body}
      </div>`;
    }).join('') : '';
    const leftBlock = leftRows
      ? `<div class="result-left"><div class="rl-title">大家剩的牌</div>${leftRows}</div>`
      : '';

    let xpBlock = '<b>·</b><span>观战不结算</span>';
    if (reward) {
      xpBlock = `<b>${reward.won ? `+${reward.xp_gain}` : '0'}</b><span>${reward.won ? '经验' : '经验不扣'}</span>`;
    } else if (won === false) {
      xpBlock = '<b>0</b><span>经验不扣</span>';
    }

    const levelBox = reward && reward.level_up
      ? `<div class="levelup-box"><span class="lu-icon">★</span><div><b>升到 Lv.${reward.level_after} · ${esc(reward.level_title_after)}</b><span>${reward.ram_up ? `拉姆成长为 ${esc(reward.ram_after)}` : '继续赢下去，拉姆还会长大'}</span></div></div>`
      : (reward && reward.ram_up
        ? `<div class="levelup-box"><span class="lu-icon">★</span><div><b>拉姆进化了</b><span>${esc(reward.ram_before)} → ${esc(reward.ram_after)}</span></div></div>`
        : '');

    const actions = [];
    if (v.you != null) actions.push('<button type="button" class="btn btn-primary" data-result="again">准备下一局</button>');
    if (my == null && v.can_sit) actions.push('<button type="button" class="btn btn-primary" data-result="sit">入座下一局</button>');
    actions.push('<button type="button" class="btn btn-soft" data-result="close">看看牌桌</button>');

    openModal(`
      <button type="button" class="modal-close" data-close aria-label="关闭">×</button>
      <div class="modal-kicker">ROUND ${v.round} · ${esc(winnerText)}</div>
      <h3 class="modal-title">${won === true ? '这局赢了' : won === false ? '这局差一点' : '本局结束'}</h3>
      <p class="modal-sub">${my == null ? '你在观战，这一局没有经验结算。' : (won ? '经验已经记进庄园档案，拉姆也会跟着长大。' : '输了不扣经验，下一局再来。')}</p>
      <div class="result-banner ${won === false ? 'lose' : 'win'}">
        <div class="result-badge">${won === true ? '胜' : won === false ? '负' : '局'}</div>
        <div class="rb-copy"><b>${esc(winnerText)} · 倍数 ×${r.multiplier}</b><span>${r.landlord === my ? '你是地主' : my == null ? '观众席' : '你是农民'} · 底分 100</span></div>
        <div class="rb-xp">${xpBlock}</div>
      </div>
      ${levelBox}
      <div class="result-list">${rows}</div>
      ${leftBlock}
      <div class="result-breakdown">${chips}</div>
      <div class="result-actions">${actions.join('')}</div>`);
  }

  function openModal(inner) {
    const root = $('#modal-root');
    if (!root) return;
    root.innerHTML = `<div class="modal" data-modal><div class="modal-card" role="dialog" aria-modal="true">${inner}</div></div>`;
  }

  function closeModal() {
    S.playerModalToken += 1;
    const root = $('#modal-root');
    if (root) root.innerHTML = '';
    S.confirmFn = null;
  }

  function confirmDialog(title, sub, onOk, okText) {
    S.confirmFn = onOk;
    openModal(`
      <button type="button" class="modal-close" data-close aria-label="关闭">×</button>
      <div class="modal-kicker">PLEASE CONFIRM</div>
      <h3 class="modal-title">${esc(title)}</h3>
      <p class="modal-sub">${esc(sub)}</p>
      <div class="result-actions">
        <button type="button" class="btn btn-soft" data-confirm="cancel">取消</button>
        <button type="button" class="btn btn-primary" data-confirm="ok">${esc(okText || '确定')}</button>
      </div>`);
  }

  function onModalClick(event) {
    if (event.target.closest('[data-close]')) {
      closeModal();
      return;
    }
    const kickBtn = event.target.closest('[data-kick]');
    if (kickBtn) {
      const v = S.view;
      const seat = ((v && v.seats) || []).find((s) => s && s.pid === kickBtn.dataset.kick);
      if (seat) confirmKick(seat);
      return;
    }
    const confirmBtn = event.target.closest('[data-confirm]');
    if (confirmBtn) {
      const fn = S.confirmFn;
      S.confirmFn = null;
      const action = confirmBtn.dataset.confirm;
      closeModal();
      if (action === 'ok' && fn) fn();
      return;
    }
    const resultBtn = event.target.closest('[data-result]');
    if (resultBtn) {
      const action = resultBtn.dataset.result;
      if (action === 'again') {
        closeModal();
        const v = S.view;
        if (send({ type: 'ready', value: true })) {
          toast(v && v.human_count > 1 ? '已准备，等其他人按准备' : '已准备，马上开局');
        }
      } else if (action === 'sit') {
        closeModal();
        send({ type: 'sit' });
      } else {
        // “看看牌桌”：收起候场面板，把各家没出的牌摊在桌面上
        if (S.view && S.view.phase === 'ended') S.peekTable = true;
        closeModal();
        renderAll();
      }
      return;
    }
    if (event.target.matches('[data-modal]')) closeModal();
  }

  async function openLeaderboard() {
    openModal(`
      <button type="button" class="modal-close" data-close aria-label="关闭">×</button>
      <div class="modal-kicker">MOLE MANOR · RANK</div>
      <h3 class="modal-title">庄园排行榜</h3>
      <p class="modal-sub">按等级、经验和胜场排序 · 只统计这台电脑上的档案</p>
      <div class="lb-list" id="lb-body"><div class="lb-empty">正在翻庄园名册…</div></div>`);
    const body = $('#lb-body');
    if (!body) return;
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      const rows = (data && data.rows) || [];
      if (!rows.length) {
        body.innerHTML = '<div class="lb-empty">名册还是空的，先来一局吧</div>';
        return;
      }
      body.innerHTML = rows.map((row) => `<div class="lb-row${row.id === S.pid ? ' me' : ''}">
        <span class="lb-rank">${row.rank}</span>
        <img src="${esc(row.avatar_url || avatarUrl(row.avatar))}" alt="">
        <span style="min-width:0"><span class="lb-name">${esc(row.id)}</span><br><span class="lb-title">${esc(row.level_title)}</span></span>
        <span class="lb-wins">${row.wins} 胜</span>
        <span class="lb-lv">Lv.${row.level}</span>
      </div>`).join('');
    } catch (err) {
      body.innerHTML = '<div class="lb-empty">排行榜暂时读不到</div>';
    }
  }

  // ---------------------------------------------------------------- 玩家详情

  async function openPlayer(seatIndex) {
    const v = S.view;
    const seat = v && (v.seats || [])[seatIndex];
    if (!seat) return;
    if (v.you === seatIndex) {
      openDrawer();
      return;
    }
    const token = ++S.playerModalToken;
    openModal(`<div class="pm-loading"><span class="pm-spinner"></span>正在翻 ${esc(seat.name)} 的档案…</div>`);
    let profile = null;
    if (!seat.is_bot && seat.pid) {
      try {
        const res = await fetch(`/api/profile/${encodeURIComponent(seat.pid)}`);
        if (res.ok) profile = await res.json();
      } catch (err) {
        /* 读不到档案时只展示座位上的公开状态 */
      }
    }
    if (token !== S.playerModalToken) return;
    const cur = (S.view && S.view.seats && S.view.seats[seatIndex]) || seat;
    renderPlayerModal(seatIndex, cur, profile);
  }

  function playerStatus(seat) {
    if (seat.is_bot) return { text: `AI · ${seat.ai_label || '补位'}`, cls: 'ai' };
    if (seat.autopilot) return { text: '托管中', cls: 'auto' };
    if (!seat.connected) return { text: '离线', cls: 'off' };
    if (seat.ready) return { text: '已准备', cls: 'ok' };
    return { text: '在线', cls: 'ok' };
  }

  function renderPlayerModal(index, seat, profile) {
    const v = S.view;
    const g = v && v.game;
    const status = playerStatus(seat);
    const p = profile && profile.id ? profile : null;
    // 机器人没有个人档案，但所有难度共用一个 AI 等级，数据挂在座位上
    const prof = p || (seat.is_bot ? seat : null);
    const level = prof ? prof.level : (seat.level || 1);
    const title = prof ? prof.level_title : (seat.level_title || '');
    const pct = prof ? Math.max(0, Math.min(100, Math.round((prof.xp_pct || 0) * 100))) : 0;
    const winRate = prof && prof.games
      ? Math.round((prof.wins || 0) / prof.games * 100)
      : null;
    const ram = (p && p.ram) || seat.ram || null;
    const role = g && g.landlord != null
      ? (g.landlord === index ? '地主' : '农民')
      : (seat.ready ? '已准备' : '候场');
    const cardsLeft = g && g.counts ? g.counts[index] : null;
    const score = Number(seat.score || 0);
    const kick = seat.can_kick && seat.pid
      ? `<button type="button" class="btn btn-coral" data-kick="${esc(seat.pid)}">请离牌桌</button>`
      : '';

    openModal(`
      <button type="button" class="modal-close" data-close aria-label="关闭">×</button>
      <div class="modal-kicker">${seat.is_bot ? 'AI SEAT · DOUZERO' : 'MANOR PROFILE'}</div>
      <div class="pm-head">
        <img src="${esc(seat.avatar_url || avatarUrl(seat.avatar))}" alt="">
        <div class="pm-copy">
          <h3>${esc(seat.name)}${seat.is_me ? ' · 你' : ''}</h3>
          <span>Lv.${level}${title ? ' · ' + esc(title) : ''}</span>
        </div>
        <span class="pm-status ${status.cls}">${esc(status.text)}</span>
      </div>
      ${prof ? `
      <div class="xp-bar"><i style="width:${pct}%"></i></div>
      <div class="xp-meta"><span>Lv.${prof.level}</span><span>${prof.level_xp || 0}/${prof.level_need || 0} XP</span></div>
      <div class="profile-stats">
        <div class="stat-cell"><b>${prof.wins || 0}</b><span>胜场</span></div>
        ${p && !seat.is_bot ? `<div class="stat-cell"><b>${p.losses}</b><span>负场</span></div>` : ''}
        <div class="stat-cell"><b>${prof.games || 0}</b><span>场次</span></div>
        <div class="stat-cell"><b>${winRate == null ? '·' : winRate + '%'}</b><span>胜率</span></div>
        <div class="stat-cell"><b>×${prof.best_multiplier || 0}</b><span>最高倍数</span></div>
      </div>` : ''}
      ${ram ? `<div class="drawer-ram">
        <div class="dr-art">${ramSVG(ram.color, ram.stage)}</div>
        <div class="dr-copy"><b>${esc(ram.name || '小拉姆')} · ${esc(ram.stage_name || '')}</b><span>${esc(ram.color_name || '')} · 跟着等级一起长大</span></div>
      </div>` : ''}
      <div class="pm-seat-info">
        <div><span>座位</span><b>${index + 1} 号</b></div>
        <div><span>本局</span><b>${esc(role)}</b></div>
        ${cardsLeft != null ? `<div><span>剩牌</span><b>${cardsLeft} 张</b></div>` : ''}
        <div><span>桌上积分</span><b>${score > 0 ? '+' : ''}${score}</b></div>
      </div>
      <p class="pm-note">${seat.is_bot
        ? 'DouZero 深度网络补位，只公开剩余牌数和座位状态，手牌不可见。'
        : '只看得到公开档案和座位状态。手牌不会离开对方的手机。'}</p>
      ${kick ? `<div class="result-actions pm-actions">
        <button type="button" class="btn btn-soft" data-close>先不请离</button>
        ${kick}
      </div>` : ''}
    `);
  }

  function confirmKick(seat) {
    confirmDialog(
      `请离 ${seat.name}？`,
      'TA 正在托管或离线。请离后座位由机器人接手，这一局不会卡住；下一局空位也会由 AI 补上。',
      () => {
        if (send({ type: 'kick', pid: seat.pid })) toast(`已请离 ${seat.name}`);
      },
      '请离牌桌',
    );
  }

  // ---------------------------------------------------------------- 档案抽屉

  function openDrawer() {
    if (!S.loggedIn || !S.profile) {
      toast('先登录再打开档案', true);
      return;
    }
    S.playerModalToken += 1;
    S.drawerOpen = true;
    S.drawerOrigin = originOfAvatar(S.profile.avatar);
    renderDrawer();
  }

  function closeDrawer() {
    S.drawerOpen = false;
    const root = $('#drawer-root');
    if (root) root.innerHTML = '';
  }

  function renderDrawer() {
    const root = $('#drawer-root');
    if (!root) return;
    if (!S.drawerOpen || !S.profile) {
      root.innerHTML = '';
      return;
    }
    const p = S.profile;
    const ram = p.ram;
    const pct = Math.max(0, Math.min(100, Math.round((p.xp_pct || 0) * 100)));
    const nextText = ram.next_stage
      ? `再升到 Lv.${ram.next_stage_at} 进化为 ${esc(ram.next_stage)}`
      : '已经是最终形态';

    root.innerHTML = `<div class="drawer" data-drawer-backdrop>
      <aside class="drawer-panel" role="dialog" aria-modal="true" aria-label="我的庄园档案">
        <div class="drawer-head">
          <img src="${avatarUrl(p.avatar)}" alt="">
          <div class="dh-copy"><b>${esc(p.id)}</b><span>Lv.${p.level} · ${esc(p.level_title)}</span></div>
          <button type="button" class="drawer-close" data-drawer-close aria-label="关闭">×</button>
        </div>

        <div class="xp-bar"><i style="width:${pct}%"></i></div>
        <div class="xp-meta"><span>Lv.${p.level}</span><span>${p.level_xp}/${p.level_need} XP</span></div>

        <div class="profile-stats">
          <div class="stat-cell"><b>${p.wins}</b><span>胜场</span></div>
          <div class="stat-cell"><b>${p.losses}</b><span>负场</span></div>
          <div class="stat-cell"><b>${p.games}</b><span>场次</span></div>
          <div class="stat-cell"><b>${p.games ? Math.round(p.wins / p.games * 100) + '%' : '·'}</b><span>胜率</span></div>
          <div class="stat-cell"><b>×${p.best_multiplier || 0}</b><span>最高倍数</span></div>
        </div>

        <div class="drawer-ram">
          <div class="dr-art">${ramSVG(ram.color, ram.stage)}</div>
          <div class="dr-copy"><b>${esc(ram.name)} · ${esc(ram.stage_name)}</b><span>${esc(ram.color_name)} · ${nextText}<br>跟着摩尔等级一起长大</span></div>
        </div>

        <div class="drawer-section">
          <div class="section-head"><b>挑个形象</b><span>${AVATAR_ORIGIN()}</span></div>
          <div class="tabs" id="drawer-tabs" role="tablist"></div>
          <div class="avatar-grid" id="drawer-avatars"></div>
        </div>

        <div class="drawer-section">
          <div class="section-head"><b>拉姆颜色</b><span>随时都能换</span></div>
          <div class="ram-colors" id="drawer-colors"></div>
          <div class="field-label mini" style="margin-top:10px" for="drawer-ram-name">拉姆名字</div>
          <div class="id-row">
            <input id="drawer-ram-name" class="input" maxlength="8" value="${esc(ram.name)}" autocomplete="off">
            <button type="button" class="btn btn-primary" data-ram-save>保存</button>
          </div>
        </div>

        <div class="drawer-section">
          <div class="section-head"><b>AI 强度</b><span>下一局生效</span></div>
          <div class="diff-row" id="drawer-diff"></div>
        </div>

        <div class="drawer-section">
          <div class="section-head"><b>牌桌设置</b><span>跟着这个 ID 记住</span></div>
          <div class="seg-row" id="drawer-order">
            <button type="button" class="seg-btn${S.handOrder === 'asc' ? ' active' : ''}" data-order="asc">小 → 大</button>
            <button type="button" class="seg-btn${S.handOrder === 'desc' ? ' active' : ''}" data-order="desc">大 → 小</button>
          </div>
          <p class="setting-note">手牌顺序会存进「${esc(p.id)}」的档案，换手机打开也一样。</p>
        </div>

        <div class="drawer-foot">
          <button type="button" class="btn btn-soft" data-lb>庄园排行榜</button>
          <button type="button" class="btn btn-soft" data-leave-table>${S.view && S.view.game && (S.view.phase === 'bidding' || S.view.phase === 'playing') ? '退出当前局' : '离开牌桌'}</button>
          <button type="button" class="btn btn-soft" data-switch-id>换个 ID</button>
          <p class="drawer-note">ID 没有密码 · 头像素材取自网络，仅家庭局域网娱乐</p>
        </div>
      </aside>
    </div>`;

    renderTabs($('#drawer-tabs'), S.drawerOrigin, 'drawer');
    renderAvatarGrid($('#drawer-avatars'), p.avatar, S.drawerOrigin);
    const colorBox = $('#drawer-colors');
    if (colorBox) {
      colorBox.innerHTML = colors().map((c) => `<button type="button" class="color-dot${ram.color_id === c.id ? ' active' : ''}" data-color="${esc(c.id)}" style="background:${esc(c.hex)}" title="${esc(c.name)}" aria-label="${esc(c.name)}"></button>`).join('');
    }
    const activeDiff = S.inTable && S.view && S.view.difficulty ? S.view.difficulty : S.prefDiff;
    renderDiff($('#drawer-diff'), activeDiff, false);
  }

  function AVATAR_ORIGIN() {
    return `${avatars().length} 位角色`;
  }

  function onDrawerClick(event) {
    if (event.target.closest('[data-drawer-close]')) {
      closeDrawer();
      return;
    }
    if (event.target.matches('[data-drawer-backdrop]')) {
      closeDrawer();
      return;
    }
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      S.drawerOrigin = tab.dataset.tab === 'genshin' ? 'genshin' : 'mole';
      renderDrawer();
      return;
    }
    const avatar = event.target.closest('[data-avatar]');
    if (avatar) {
      chooseAvatar(avatar.dataset.avatar);
      return;
    }
    const color = event.target.closest('[data-color]');
    if (color) {
      chooseColor(color.dataset.color);
      return;
    }
    const save = event.target.closest('[data-ram-save]');
    if (save) {
      const input = $('#drawer-ram-name');
      saveRamName(input ? input.value : '');
      return;
    }
    const diff = event.target.closest('[data-diff]');
    if (diff) {
      chooseDiff(diff.dataset.diff);
      return;
    }
    const order = event.target.closest('[data-order]');
    if (order) {
      Sfx.click();
      setHandOrder(order.dataset.order);
      renderDrawer();
      return;
    }
    if (event.target.closest('[data-lb]')) {
      closeDrawer();
      openLeaderboard();
      return;
    }
    if (event.target.closest('[data-leave-table]')) {
      const v = S.view;
      const inGame = !!(v && v.game && (v.phase === 'bidding' || v.phase === 'playing'));
      if (inGame) {
        confirmDialog('退出当前局？',
          '退出后由机器人替你打完这一局，这一局不再给你记经验；若三人都退出，牌桌会清空重开。',
          () => {
            closeDrawer();
            leaveToEntry(false);
          },
          '退出');
      } else {
        closeDrawer();
        leaveToEntry(false);
      }
      return;
    }
    if (event.target.closest('[data-switch-id]')) {
      closeDrawer();
      requestSwitchId();
    }
  }

  // ---------------------------------------------------------------- 事件绑定

  function bind() {
    window.addEventListener('manor-remote-connected', () => {
      // 取消可能还在排队的本地登录，避免客人登录到本机引擎；只有本来就在登录
      // （已登录或正在 pending）才把这次登录重发到 host，不替没点登录的用户自动登录。
      if (window.manorCancelPendingLogin) window.manorCancelPendingLogin();
      const resumeId = window.__manorRemoteResumeId;
      const pendingId = S.pendingId;
      clearTimeout(S.loginTimer);
      S.pendingLogin = false;
      S.pendingId = null;
      if (resumeId) {
        // 断线自动重连：用记住的 ID 自动登录，'auto' 模式登录成功后会自动进桌。
        window.__manorRemoteResumeId = null;
        startLogin(resumeId, 'auto');
      } else if (S.loggedIn && S.pid) {
        startLogin(S.pid, 'auto');
      } else if (pendingId) {
        startLogin(pendingId, 'auto');
      } else {
        toast('远程已连接，输入 ID 进庄园');
      }
    });
    window.addEventListener('manor-remote-disconnected', (event) => {
      toast('远程连接断开了', true);
      const role = event && event.detail && event.detail.role;
      if (role === 'guest') {
        // 客人端稍后会自动刷新；先收回首页，清掉残留的 host 牌桌/AI 标签，
        // 避免这几秒里的点击落到本机引擎。host 端保留它的本地牌桌。
        resetLocalPlayer();
        showEntryScreen();
        renderEntry();
      }
    });
    const loginBtn = $('#login-btn');
    if (loginBtn) loginBtn.addEventListener('click', onLoginButton);

    const idInput = $('#player-id');
    if (idInput) {
      idInput.addEventListener('input', () => { S.idDraft = idInput.value; syncRemoteEntry(); });
      idInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onLoginButton();
        }
      });
    }

    const returning = $('#returning');
    if (returning) {
      returning.addEventListener('click', (event) => {
        if (event.target.closest('.rv-switch')) {
          event.stopPropagation();
          forgetSaved();
          return;
        }
        if (S.savedProfile) startLogin(S.savedProfile.id, 'auto');
      });
      returning.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (S.savedProfile) startLogin(S.savedProfile.id, 'auto');
        }
      });
    }

    const tabs = $('#origin-tabs');
    if (tabs) {
      tabs.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-tab]');
        if (!btn) return;
        S.origin = btn.dataset.tab === 'genshin' ? 'genshin' : 'mole';
        renderCustomize();
      });
    }

    const grid = $('#avatar-grid');
    if (grid) {
      grid.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-avatar]');
        if (btn) chooseAvatar(btn.dataset.avatar);
      });
    }

    const colorBox = $('#ram-colors');
    if (colorBox) {
      colorBox.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-color]');
        if (btn) chooseColor(btn.dataset.color);
      });
    }

    const ramName = $('#ram-name');
    if (ramName) {
      ramName.addEventListener('change', () => saveRamName(ramName.value));
      ramName.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          ramName.blur();
          saveRamName(ramName.value);
        }
      });
    }

    const diffBox = $('#entry-diff');
    if (diffBox) {
      diffBox.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-diff]');
        if (btn) chooseDiff(btn.dataset.diff);
      });
    }

    const enter = $('#enter-table');
    if (enter) enter.addEventListener('click', enterTable);

    const lb = $('#show-lb');
    if (lb) lb.addEventListener('click', openLeaderboard);

    for (const id of ['sound-entry', 'sound-table']) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', () => {
          S.sound = !S.sound;
          LS.set('ddz.sound', S.sound ? '1' : '0');
          applySoundIcon();
          if (S.sound) Sfx.click();
        });
      }
    }

    const urlBtn = $('#entry-url');
    if (urlBtn) {
      urlBtn.addEventListener('click', async () => {
        if (!S.lanUrl) return;
        try {
          await navigator.clipboard.writeText(S.lanUrl);
          toast('访问地址已复制');
        } catch (err) {
          toast(S.lanUrl);
        }
      });
    }

    const profileChip = $('#profile-chip');
    if (profileChip) profileChip.addEventListener('click', openDrawer);

    const sitBtn = $('#spectate-sit');
    if (sitBtn) sitBtn.addEventListener('click', () => send({ type: 'sit' }));

    const meBtn = $('#hand-me');
    if (meBtn) meBtn.addEventListener('click', openDrawer);

    for (const id of ['seat-top', 'seat-left', 'seat-right']) {
      const seatEl = document.getElementById(id);
      if (!seatEl) continue;
      seatEl.addEventListener('click', () => {
        const idx = Number(seatEl.dataset.seat);
        if (Number.isFinite(idx)) openPlayer(idx);
      });
      seatEl.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        const idx = Number(seatEl.dataset.seat);
        if (Number.isFinite(idx)) openPlayer(idx);
      });
    }

    const orderBtn = $('#hand-order');
    if (orderBtn) {
      orderBtn.addEventListener('click', () => {
        Sfx.click();
        setHandOrder(S.handOrder === 'asc' ? 'desc' : 'asc');
      });
    }

    const nextBtn = $('#hand-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const v = S.view;
        const meSeat = v && v.you != null ? (v.seats || [])[v.you] : null;
        Sfx.click();
        send({ type: 'ready', value: !(meSeat && meSeat.ready) });
      });
    }

    const lobby = $('#lobby-panel');
    if (lobby) {
      lobby.addEventListener('click', (event) => {
        const ready = event.target.closest('[data-ready]');
        if (ready) {
          const v = S.view;
          const meSeat = v && v.you != null ? (v.seats || [])[v.you] : null;
          Sfx.click();
          send({ type: 'ready', value: !(meSeat && meSeat.ready) });
          return;
        }
        const openSeat = event.target.closest('[data-open-seat]');
        if (openSeat) {
          openPlayer(Number(openSeat.dataset.openSeat));
          return;
        }
        const start = event.target.closest('[data-start]');
        if (start) {
          Sfx.click();
          send({ type: 'start' });
          return;
        }
        const sit = event.target.closest('[data-sit]');
        if (sit) {
          send({ type: 'sit' });
          return;
        }
        const diff = event.target.closest('[data-diff]');
        if (diff) chooseDiff(diff.dataset.diff);
      });
    }

    const bidding = $('#bidding');
    if (bidding) {
      bidding.addEventListener('click', (event) => {
        const grabBtn = event.target.closest('[data-grab]');
        if (grabBtn) {
          doGrab(grabBtn.dataset.grab === '1');
          return;
        }
        const callBtn = event.target.closest('[data-call]');
        if (callBtn) doCall(callBtn.dataset.call === '1');
      });
    }

    const actions = $('#actions');
    if (actions) {
      actions.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'play') doPlay();
        else if (act === 'pass') doPass();
        else if (act === 'hint') requestHint();
      });
    }

    const hand = $('#hand');
    if (hand) {
      hand.addEventListener('click', onHandClick);
      hand.addEventListener('pointerdown', onHandPointerDown);
      hand.addEventListener('contextmenu', (event) => event.preventDefault());
      window.addEventListener('pointermove', onHandPointerMove);
      window.addEventListener('pointerup', onHandPointerEnd);
      window.addEventListener('pointercancel', onHandPointerEnd);
    }

    const modalRoot = $('#modal-root');
    if (modalRoot) modalRoot.addEventListener('click', onModalClick);

    const drawerRoot = $('#drawer-root');
    if (drawerRoot) drawerRoot.addEventListener('click', onDrawerClick);

    window.addEventListener('resize', () => {
      requestAnimationFrame(() => {
        layoutStage();
        layoutHand();
        layoutPlayZones();
      });
      reportClientSoon();
    });
    if (window.ResizeObserver) {
      const dockEl = document.querySelector('.hand-dock');
      if (dockEl) {
        new ResizeObserver(() => { requestAnimationFrame(layoutStage); }).observe(dockEl);
      }
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const drawer = $('#drawer-root');
        if (drawer && drawer.children.length) {
          closeDrawer();
          return;
        }
        const modal = $('#modal-root');
        if (modal && modal.children.length) closeModal();
      }
    });

    document.addEventListener('pointerdown', unlockAudio, { once: true });
    setInterval(tickTurnReminder, 500);
  }

  // ---------------------------------------------------------------- 初始化

  async function loadMeta() {
    try {
      const [metaRes, infoRes] = await Promise.all([
        fetch('/api/meta'),
        fetch('/api/info'),
      ]);
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta && Array.isArray(meta.avatars)) S.meta = meta;
      }
      if (infoRes.ok) {
        const info = await infoRes.json();
        S.info = info;
        if (info && info.url) S.lanUrl = info.url;
        if (info && info.ai && info.ai.host) S.aiHost = String(info.ai.host);
      }
    } catch (err) {
      /* 用内置兜底数据 */
    }
    if (!S.lanUrl) S.lanUrl = location.origin;
    applyLan();
    renderEntry();
  }

  async function loadSavedProfile() {
    const id = LS.get('ddz.lastId');
    if (!id) {
      renderEntry();
      return;
    }
    S.idDraft = id;
    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error('not found');
      const profile = await res.json();
      if (profile && profile.id) {
        S.savedProfile = profile;
        if (!S.originInit) {
          S.origin = originOfAvatar(profile.avatar);
          S.originInit = true;
        }
      }
    } catch (err) {
      LS.del('ddz.lastId');
      S.savedProfile = null;
    }
    renderEntry();
  }

  function init() {
    applySoundIcon();
    applyLan();
    bind();
    renderEntry();
    connect();
    loadMeta();
    loadSavedProfile();

    const idEl = $('#player-id');
    if (idEl && S.idDraft) idEl.value = S.idDraft;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
