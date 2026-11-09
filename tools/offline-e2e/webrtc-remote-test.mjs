import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];

// 每次 E2E 用独立房间，避免和家里真实的猫猫/喵喵配对撞 topic。
const SIGNAL_ROOM = 'ci-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2, 8);
const SIGNAL_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

async function newPage(browser, label) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 688 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(`${label} pageerror: ${err.message}`));
  // 用 init script 注入，刷新后仍在（自动重连会在 boot 阶段读取这些覆盖）。
  await page.addInitScript(({ room, brokers, home }) => {
    window.__MANOR_SIGNAL_BASE = { room, brokers };
    // 把 LAN 信令指向静态测试服务器（没有 /api/signal），确定性地走 MQTT 回落，
    // 同时避免 E2E 写到正式服。LAN 路径另有本地验证。
    window.__MANOR_HOME_SERVER = home;
  }, { room: SIGNAL_ROOM, brokers: SIGNAL_BROKERS, home: BASE });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#local-splash', { state: 'detached', timeout: 90000 });
  await page.waitForTimeout(500);
  return { context, page };
}

async function prepare(page) {
  const button = page.getByRole('button', { name: '准备', exact: true });
  await button.waitFor({ state: 'visible', timeout: 20000 });
  await button.click();
}

async function playLoop(page, label) {
  for (let i = 0; i < 180; i++) {
    if (await page.locator('#modal-root .modal-title').count()) return true;
    if (await page.locator('#bidding').isVisible().catch(() => false)) {
      for (const selector of ['#bidding [data-call="1"]', '#bidding [data-grab="1"]']) {
        const button = page.locator(selector);
        if (await button.count()) { await button.first().click().catch(() => {}); break; }
      }
    } else if (await page.locator('#actions').isVisible().catch(() => false)) {
      const hint = page.locator('#actions [data-act="hint"]');
      if (await hint.count()) await hint.click().catch(() => {});
      await sleep(180);
      const play = page.locator('#actions [data-act="play"]');
      const pass = page.locator('#actions [data-act="pass"]');
      if (await play.count() && await play.isEnabled().catch(() => false)) {
        await play.click().catch(() => {});
      } else if (await pass.count() && await pass.isEnabled().catch(() => false)) {
        await pass.click().catch(() => {});
      }
    }
    await sleep(420);
  }
  throw new Error(`${label}: 对局没有在 75 秒内结束`);
}

async function openRemote(page) {
  await page.click('[data-remote-open]');
  await page.waitForSelector('#remote-modal', { state: 'visible', timeout: 10000 });
}

async function closeRemote(page) {
  const modal = page.locator('#remote-modal');
  if (await modal.isVisible().catch(() => false)) {
    await page.click('[data-remote-close]');
  }
}

async function manualHandshake(host, guest) {
  console.log('step: manual fallback offer/answer');
  await openRemote(host.page);
  await host.page.click('[data-remote-host-start]');
  await host.page.waitForFunction(() => {
    const el = document.querySelector('[data-remote-offer]');
    return el && el.value && el.value.length > 500;
  }, null, { timeout: 40000 });
  const offer = await host.page.inputValue('[data-remote-offer]');

  await openRemote(guest.page);
  await guest.page.click('[data-remote-tab="guest"]');
  await guest.page.fill('[data-remote-offer-input]', offer);
  await guest.page.click('[data-remote-guest-answer]');
  await guest.page.waitForFunction(() => {
    const el = document.querySelector('[data-remote-answer]');
    return el && el.value && el.value.length > 300;
  }, null, { timeout: 40000 });
  const answer = await guest.page.inputValue('[data-remote-answer]');

  await host.page.fill('[data-remote-answer-input]', answer);
  await host.page.click('[data-remote-host-connect]');
  await host.page.waitForFunction(() => window.__manorRemoteHost === true, null, { timeout: 30000 });
  await guest.page.waitForFunction(() => window.__manorRemoteGuest === true, null, { timeout: 30000 });
  await sleep(1200);

  console.log('step: reset manual session');
  // 先从客人侧重置，避免房主断开时触发客人自动刷新。
  await openRemote(guest.page);
  await guest.page.click('[data-remote-reset]');
  await guest.page.waitForFunction(() => window.__manorRemoteGuest !== true, null, { timeout: 10000 });
  await closeRemote(guest.page);

  await openRemote(host.page);
  if (await host.page.locator('[data-remote-reset]:visible').count()) {
    await host.page.click('[data-remote-reset]');
  }
  await host.page.waitForFunction(() => window.__manorRemoteHost !== true, null, { timeout: 10000 });
  await closeRemote(host.page);
}

async function automaticHandshake(host, guest) {
  console.log('step: automatic pairing over MQTT');
  await openRemote(host.page);
  if (!(await host.page.locator('[data-remote-auto-host]').count())) {
    throw new Error('缺少“自动开房”按钮');
  }
  await host.page.click('[data-remote-auto-host]');

  await openRemote(guest.page);
  if (!(await guest.page.locator('[data-remote-auto-join]').count())) {
    throw new Error('缺少“自动加入”按钮');
  }
  await guest.page.click('[data-remote-auto-join]');

  await Promise.all([
    host.page.waitForFunction(() => window.__manorRemoteHost === true, null, { timeout: 90000 }),
    guest.page.waitForFunction(() => window.__manorRemoteGuest === true, null, { timeout: 90000 }),
  ]);
  await sleep(1200);
  console.log('step: automatic pairing connected');
}

async function main() {
  fs.mkdirSync('shots', { recursive: true });
  const launchOptions = { args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] };
  if (process.env.BROWSER_CHANNEL) launchOptions.channel = process.env.BROWSER_CHANNEL;
  const browser = await chromium.launch(launchOptions);
  let host;
  let guest;
  try {
    host = await newPage(browser, 'remote-host');
    guest = await newPage(browser, 'remote-guest');

    await host.page.fill('#player-id', '房主');
    if (await host.page.locator('#remote-card').isVisible().catch(() => false)) {
      throw new Error('非猫猫/喵喵也看到了远程互动按钮');
    }
    await host.page.fill('#player-id', '喵喵');
    await guest.page.fill('#player-id', '猫猫');
    await host.page.waitForSelector('#remote-card', { state: 'visible', timeout: 10000 });
    await guest.page.waitForSelector('#remote-card', { state: 'visible', timeout: 10000 });

    await manualHandshake(host, guest);
    await automaticHandshake(host, guest);

    console.log('step: login and enter table');
    await host.page.click('#login-btn');
    await host.page.waitForSelector('#customize:not(.hidden)', { timeout: 25000 });
    await host.page.click('#enter-table');
    await guest.page.click('#login-btn');
    await guest.page.waitForSelector('#customize:not(.hidden)', { timeout: 25000 });
    await guest.page.click('#enter-table');
    await host.page.waitForFunction(() => document.body.innerText.includes('猫猫'), null, { timeout: 20000 });

    console.log('step: prepare and play');
    await prepare(host.page);
    await prepare(guest.page);
    await Promise.all([
      host.page.waitForFunction(() => {
        const round = document.querySelector('#round-pill')?.textContent || '';
        return round.includes('第 1 局') && document.querySelectorAll('#hand .card').length >= 17;
      }, null, { timeout: 30000 }),
      guest.page.waitForFunction(() => {
        const round = document.querySelector('#round-pill')?.textContent || '';
        return round.includes('第 1 局') && document.querySelectorAll('#hand .card').length >= 17;
      }, null, { timeout: 30000 }),
    ]);

    const hostAi = (await host.page.textContent('#ai-host-chip')) || '';
    const guestAi = (await guest.page.textContent('#ai-host-chip')) || '';
    if (!hostAi.includes('本机 iPad') || !guestAi.includes('喵喵')) {
      throw new Error(`远程 AI 设备标签不对: host=${hostAi} guest=${guestAi}`);
    }
    console.log(`remote AI labels: host=${hostAi} guest=${guestAi}`);

    console.log('step: in-table remote entry');
    await host.page.waitForSelector('#remote-table-btn', { state: 'visible', timeout: 10000 });
    await guest.page.waitForSelector('#remote-table-btn', { state: 'visible', timeout: 10000 });
    await host.page.click('#remote-table-btn');
    await host.page.waitForSelector('#remote-modal', { state: 'visible', timeout: 10000 });
    await host.page.click('[data-remote-close]');
    await host.page.waitForSelector('#remote-modal', { state: 'hidden', timeout: 10000 });

    console.log('step: guest drop and auto-reconnect');
    await guest.page.evaluate(() => window.__manorRemoteDrop());
    // 客人掉线→刷新→自动重连→自动登录进桌；host 自动重开房间等它回来。
    await guest.page.waitForFunction(() => {
      const btn = document.querySelector('#remote-table-btn');
      return window.__manorRemoteGuest === true && btn && !btn.classList.contains('hidden');
    }, null, { timeout: 90000 });
    await host.page.waitForFunction(() => document.body.innerText.includes('猫猫'), null, { timeout: 30000 });
    await sleep(1500);
    console.log('step: auto-reconnect restored guest into the same table');

    const [hostDone, guestDone] = await Promise.all([
      playLoop(host.page, 'remote-host'),
      playLoop(guest.page, 'remote-guest'),
    ]);
    if (!hostDone || !guestDone) throw new Error('远程对局没有同时结束');
    await host.page.screenshot({ path: 'shots/webrtc-remote-host-result.png' });
    await guest.page.screenshot({ path: 'shots/webrtc-remote-guest-result.png' });

    const guestProfile = await guest.page.evaluate(async () => {
      const res = await fetch('/api/profile/' + encodeURIComponent('猫猫'));
      return res.ok ? await res.json() : null;
    });
    if (!guestProfile || guestProfile.id !== '猫猫') throw new Error('猫猫的端侧档案没有同步');
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('WEBRTC REMOTE E2E OK', JSON.stringify({ guestXp: guestProfile.xp, guestLevel: guestProfile.level }));
  } catch (err) {
    try { if (host) await host.page.screenshot({ path: 'shots/webrtc-remote-host-fail.png' }); } catch (e) {}
    try { if (guest) await guest.page.screenshot({ path: 'shots/webrtc-remote-guest-fail.png' }); } catch (e) {}
    throw err;
  } finally {
    if (host) await host.context.close();
    if (guest) await guest.context.close();
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
