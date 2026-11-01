import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080/';
const MOCK = `window.__nearbyOutbox = [];
window.webkit = { messageHandlers: { manorNearby: { postMessage: (payload) => { window.__nearbyOutbox.push(payload); } } } };`;

const errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function newPage(browser, label) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 688 } });
  const page = await context.newPage();
  await page.addInitScript(MOCK);
  page.on('pageerror', (err) => errors.push(`${label} pageerror: ${err.message}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#local-splash', { state: 'detached', timeout: 90000 });
  await page.waitForTimeout(600);
  return { context, page };
}

async function drain(page) {
  return await page.evaluate(() => window.__nearbyOutbox.splice(0));
}

async function emit(page, event) {
  await page.evaluate((payload) => window.manorNearbyEvent(payload), event);
}

async function startRelay(hostPage, guestPage) {
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        for (const action of await drain(hostPage)) {
          if (action.action === 'host') {
            await emit(hostPage, { type: 'hosting', name: '房主' });
          } else if (action.action === 'send') {
            await emit(guestPage, { type: 'data', text: String(action.text || '') });
          }
        }
        for (const action of await drain(guestPage)) {
          if (action.action === 'browse') {
            await emit(guestPage, { type: 'hosts', hosts: [{ id: '房主的牌桌', name: '房主的牌桌' }] });
          } else if (action.action === 'join') {
            await emit(guestPage, { type: 'joined', host: '房主', peers: ['房主', '客人'] });
            await emit(hostPage, { type: 'peerjoined', name: '客人' });
          } else if (action.action === 'send') {
            await emit(hostPage, { type: 'peerdata', from: '客人', text: String(action.text || '') });
          }
        }
      } catch (err) {
        // 页面切换/退出时忽略；真正的页面错误由 pageerror 收集
      }
      await sleep(80);
    }
  })();
  return async () => {
    running = false;
    await loop;
  };
}

async function prepare(page) {
  const button = page.getByRole('button', { name: '准备', exact: true });
  await button.waitFor({ state: 'visible', timeout: 20000 });
  await button.click();
}

async function playLoop(page, label) {
  for (let i = 0; i < 180; i++) {
    if (await page.locator('#modal-root .modal-title').count()) {
      return true;
    }
    if (await page.locator('#bidding').isVisible().catch(() => false)) {
      for (const selector of ['#bidding [data-call="1"]', '#bidding [data-grab="1"]']) {
        const button = page.locator(selector);
        if (await button.count()) {
          await button.first().click().catch(() => {});
          break;
        }
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

async function main() {
  fs.mkdirSync('shots', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const host = await newPage(browser, 'host');
  const guest = await newPage(browser, 'guest');
  const stopRelay = await startRelay(host.page, guest.page);

  try {
    console.log('step: host host');
    await host.page.fill('#player-id', '房主');
    await host.page.click('[data-nearby-host-start]');
    await host.page.waitForFunction(() => (document.querySelector('#nearby-status')?.textContent || '').includes('牌桌已开'), { timeout: 10000 });
    console.log('step: host login');
    await host.page.click('#login-btn');
    await host.page.waitForSelector('#customize:not(.hidden)', { timeout: 25000 });
    await host.page.click('#enter-table');
    await sleep(800);

    console.log('step: guest browse/join');
    await guest.page.fill('#player-id', '客人');
    await guest.page.click('[data-nearby-browse]');
    await guest.page.waitForSelector('[data-nearby-host="房主的牌桌"]', { timeout: 15000 });
    await guest.page.click('[data-nearby-host="房主的牌桌"]');
    await guest.page.waitForFunction(() => window.__manorPeerMode === true, { timeout: 15000 });
    console.log('step: guest login');
    await guest.page.click('#login-btn');
    await guest.page.waitForSelector('#customize:not(.hidden)', { timeout: 25000 });
    await guest.page.click('#enter-table');
    await guest.page.waitForTimeout(1200);

    console.log('step: wait host sees guest');
    await host.page.waitForFunction(() => document.body.innerText.includes('客人'), { timeout: 20000 });
    console.log('step: prepare');
    await prepare(host.page);
    await prepare(guest.page);
    console.log('step: wait bidding');

    await Promise.all([
      host.page.waitForSelector('#bidding:not(.hidden) [data-call="1"], #actions:not(.hidden)', { timeout: 30000 }),
      guest.page.waitForSelector('#bidding:not(.hidden) [data-call="1"], #actions:not(.hidden)', { timeout: 30000 }),
    ]);

    const hostCards = await host.page.locator('#hand .card').count();
    const guestCards = await guest.page.locator('#hand .card').count();
    if (hostCards < 17 || guestCards < 17) {
      throw new Error(`两人手牌不对: host=${hostCards} guest=${guestCards}`);
    }
    if (errors.length) throw new Error(errors.join('\n'));

    await host.page.screenshot({ path: 'shots/offline-e2e-host-bid.png' });
    await guest.page.screenshot({ path: 'shots/offline-e2e-guest-bid.png' });

    const [hostDone, guestDone] = await Promise.all([
      playLoop(host.page, 'host'),
      playLoop(guest.page, 'guest'),
    ]);
    if (!hostDone || !guestDone) throw new Error('双方没有同时看到结算');

    await host.page.screenshot({ path: 'shots/offline-e2e-host-result.png' });
    await guest.page.screenshot({ path: 'shots/offline-e2e-guest-result.png' });

    const guestProfile = await guest.page.evaluate(async () => {
      const res = await fetch('/api/profile/' + encodeURIComponent('客人'));
      return res.ok ? await res.json() : null;
    });
    if (!guestProfile || guestProfile.id !== '客人') {
      throw new Error('客人端侧档案没有同步');
    }
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('OFFLINE E2E OK', JSON.stringify({
      hostCards,
      guestCards,
      guestXp: guestProfile.xp,
      guestLevel: guestProfile.level,
    }));
  } catch (err) {
    try { await host.page.screenshot({ path: 'shots/offline-e2e-host-fail.png' }); } catch (shotErr) {}
    try { await guest.page.screenshot({ path: 'shots/offline-e2e-guest-fail.png' }); } catch (shotErr) {}
    throw err;
  } finally {
    await stopRelay();
    await host.context.close();
    await guest.context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
