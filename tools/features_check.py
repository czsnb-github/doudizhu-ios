"""QA for ready gating, seat details/kick, per-seat plays and saved settings (dev 8001)."""
from __future__ import annotations

import json
import time
from pathlib import Path

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"
URL = "http://127.0.0.1:8001/"

errors: list[str] = []


def shot(page: Page, name: str) -> None:
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    print("shot", name)


def watch(page: Page, tag: str) -> None:
    page.on("pageerror", lambda exc: errors.append(f"{tag} pageerror: {exc}"))
    page.on(
        "console",
        lambda msg: errors.append(f"{tag} console: {msg.text}")
        if msg.type == "error" else None,
    )


def join(browser: Browser, pid: str) -> tuple[BrowserContext, Page]:
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="zh-CN"
    )
    page = ctx.new_page()
    watch(page, pid)
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(400)
    page.fill("#player-id", pid)
    page.click("#login-btn")
    page.wait_for_selector("#customize:not(.hidden)", timeout=10000)
    page.click("#enter-table")
    page.wait_for_timeout(1200)
    return ctx, page


def state(page: Page) -> dict:
    return page.evaluate(
        """() => {
          const q = (s) => document.querySelector(s);
          const txt = (s) => q(s) ? q(s).textContent.replace(/\\s+/g,' ').trim() : null;
          return {
            round: txt('#round-pill'),
            lobby: !!(q('#lobby-panel') && !q('#lobby-panel').classList.contains('hidden')),
            readyLabel: txt('[data-ready]'),
            progress: txt('.lobby-tip'),
            handBtn: txt('#hand-order'),
            seats: Array.from(document.querySelectorAll('#seat-left .seat-name, #seat-right .seat-name'))
              .map(el => el.textContent.trim()),
            tags: Array.from(document.querySelectorAll('#seat-left .seat-tag, #seat-right .seat-tag'))
              .map(el => el.textContent.trim()),
            zones: ['top','left','right','bottom'].filter(k => {
              const z = q('#play-' + k);
              return z && !z.classList.contains('hidden') && z.querySelector('.card');
            }),
            zoneCards: Object.fromEntries(['top','left','right','bottom'].map(k => {
              const z = q('#play-' + k);
              return [k, z ? z.querySelectorAll('.card').length : 0];
            })),
            modal: txt('.modal-card'),
            drawer: !!(q('#drawer-root') && q('#drawer-root').children.length),
          };
        }"""
    )


def advance(page: Page) -> str:
    """One interaction step: bid if possible, otherwise hint + play/pass."""
    act = page.evaluate(
        """() => {
          const bid = document.querySelector('#bidding:not(.hidden) [data-bid="3"]:not(:disabled)');
          if (bid) { bid.click(); return 'bid3'; }
          const hint = document.querySelector('#actions:not(.hidden) [data-act="hint"]');
          if (hint && !hint.disabled) { hint.click(); return 'hint'; }
          return 'wait';
        }"""
    )
    if act == "hint":
        page.wait_for_timeout(450)
        act2 = page.evaluate(
            """() => {
              const play = document.querySelector('#actions:not(.hidden) [data-act="play"]:not(:disabled)');
              if (play) { play.click(); return 'play'; }
              const pass = document.querySelector('#actions:not(.hidden) [data-act="pass"]:not(:disabled)');
              if (pass) { pass.click(); return 'pass'; }
              return 'stuck';
            }"""
        )
        return f'{act}->{act2}'
    return act


def main() -> None:
    SHOTS.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx_a, a = join(browser, "QA玩家1")
        ctx_b, b = join(browser, "QA玩家2")
        a.wait_for_timeout(700)

        # 1) 准备门禁：只准备一个人不开局
        print("A before ready:", state(a)["progress"])
        a.click("[data-ready]")
        a.wait_for_timeout(900)
        s = state(a)
        print("A ready only:", s["readyLabel"], "|", s["progress"], "| lobby:", s["lobby"])
        assert s["lobby"], "one ready must not start"
        shot(a, "features-ready-one")

        b.click("[data-ready]")
        a.wait_for_timeout(1800)
        s = state(a)
        print("after both ready:", s["round"], "| lobby:", s["lobby"])
        assert not s["lobby"], "both ready should start"
        shot(a, "features-started")

        # 2) 推进牌局，直到桌面上出现按座位摆放的牌
        pages = [a, b]
        saw_zone = False
        for _ in range(60):
            for pg in pages:
                try:
                    advance(pg)
                except Exception:
                    pass
            st = state(a)
            if st["zones"]:
                saw_zone = True
                break
            if st["lobby"]:
                break
            a.wait_for_timeout(500)
        s = state(a)
        print("zones:", s["zones"], s["zoneCards"], "| round:", s["round"])
        assert saw_zone, "play zones never appeared"
        shot(a, "features-zones-390")

        # 3) 侧边座位点击 -> 玩家详情
        b_name = "QA玩家2"
        side = a.evaluate(
            """(name) => {
              const boxes = Array.from(document.querySelectorAll('#seat-left, #seat-right'));
              const hit = boxes.find(box => box.textContent.includes(name));
              if (!hit) return null;
              hit.click();
              return hit.id;
            }""",
            b_name,
        )
        print("clicked side seat:", side)
        a.wait_for_selector(".pm-head", timeout=6000)
        a.wait_for_timeout(500)
        modal = state(a)["modal"]
        print("player modal:", modal[:220])
        shot(a, "features-player-modal")
        a.click(".modal-close")
        a.wait_for_timeout(300)

        # 4) 其他尺寸截图（按座位摆放的牌）
        for w, h, tag in [(360, 740, "360x740"), (740, 360, "740x360"),
                          (768, 1024, "768x1024"), (1024, 768, "1024x768")]:
            a.set_viewport_size({"width": w, "height": h})
            a.wait_for_timeout(600)
            shot(a, f"features-zones-{tag}")
        a.set_viewport_size({"width": 390, "height": 844})
        a.wait_for_timeout(500)

        # 5) B 掉线 -> 托管 -> A 请离 -> 机器人接手
        ctx_b.close()
        a.wait_for_timeout(1800)
        st = state(a)
        print("after B left seats:", st["seats"], "tags:", st["tags"])
        a.evaluate(
            """(name) => {
              const boxes = Array.from(document.querySelectorAll('#seat-left, #seat-right'));
              const hit = boxes.find(box => box.textContent.includes(name));
              if (hit) hit.click();
            }""",
            b_name,
        )
        a.wait_for_selector(".pm-head", timeout=6000)
        a.wait_for_timeout(400)
        info = a.evaluate(
            """() => ({
              head: document.querySelector('.pm-head') ? document.querySelector('.pm-head').textContent.replace(/\\s+/g,' ').trim() : '',
              kick: !!document.querySelector('[data-kick]'),
              note: document.querySelector('.pm-note') ? document.querySelector('.pm-note').textContent.trim() : '',
            })"""
        )
        print("autopilot detail:", info)
        assert info["kick"], "autopilot player should be kickable"
        shot(a, "features-kick-confirm")
        a.click("[data-kick]")
        a.wait_for_timeout(400)
        shot(a, "features-kick-dialog")
        a.click('[data-confirm="ok"]')
        a.wait_for_timeout(1500)
        st = state(a)
        print("after kick seats:", st["seats"], "tags:", st["tags"])
        assert any("AI" in t for t in st["tags"]), "kicked seat should become AI"

        # 6) 机器人详情
        a.evaluate(
            """() => {
              const boxes = Array.from(document.querySelectorAll('#seat-left, #seat-right'));
              const hit = boxes.find(box => /AI/.test(box.textContent));
              if (hit) hit.click();
            }"""
        )
        a.wait_for_selector(".pm-head", timeout=6000)
        a.wait_for_timeout(400)
        bot_info = a.evaluate(
            """() => ({
              kick: !!document.querySelector('[data-kick]'),
              note: document.querySelector('.pm-note') ? document.querySelector('.pm-note').textContent.trim() : '',
              status: document.querySelector('.pm-status') ? document.querySelector('.pm-status').textContent.trim() : '',
            })"""
        )
        print("bot detail:", bot_info)
        assert not bot_info["kick"], "bots must not be kickable"
        shot(a, "features-bot-modal")
        a.click(".modal-close")
        a.wait_for_timeout(300)

        # 7) 自己的状态条 -> 档案抽屉 -> 设置记忆
        a.click("#hand-me")
        a.wait_for_selector(".drawer-panel", timeout=5000)
        a.wait_for_timeout(400)
        order_info = a.evaluate(
            """() => ({
              current: document.querySelector('#drawer-order .seg-btn.active') ? document.querySelector('#drawer-order .seg-btn.active').textContent.trim() : null,
              note: document.querySelector('.setting-note') ? document.querySelector('.setting-note').textContent.trim() : '',
              handXp: !!document.querySelector('.hand-xp'),
              barW: document.querySelector('#hand-xp') ? document.querySelector('#hand-xp').style.width : null,
            })"""
        )
        print("drawer order:", order_info)
        assert order_info["current"] == "小 → 大", "default order should be asc"
        shot(a, "features-drawer-settings")
        a.click('#drawer-order [data-order="desc"]')
        a.wait_for_timeout(900)
        order_after = a.evaluate(
            """() => ({
              active: document.querySelector('#drawer-order .seg-btn.active') ? document.querySelector('#drawer-order .seg-btn.active').textContent.trim() : null,
              handBtn: document.querySelector('#hand-order') ? document.querySelector('#hand-order').textContent.trim() : null,
              ls: localStorage.getItem('ddz.handOrder'),
            })"""
        )
        print("after desc:", order_after)
        prof = a.evaluate(
            """async () => (await (await fetch('/api/profile/' + encodeURIComponent('QA玩家1'))).json()).settings"""
        )
        print("server settings:", prof)
        assert prof.get("hand_order") == "desc", "server should persist desc"
        shot(a, "features-order-desc")
        a.click('#drawer-order [data-order="asc"]')
        a.wait_for_timeout(700)
        prof2 = a.evaluate(
            """async () => (await (await fetch('/api/profile/' + encodeURIComponent('QA玩家1'))).json()).settings"""
        )
        print("server settings restored:", prof2)
        assert prof2.get("hand_order") == "asc"
        a.click("[data-drawer-close]")

        # 8) 观战者视角：顶部出牌区
        ctx_c, c = join(browser, "QA看客")
        c.wait_for_timeout(1200)
        shot(c, "features-spectator-390")
        cstate = state(c)
        print("spectator:", cstate["round"], cstate["zones"], cstate["zoneCards"])

        # 继续把这一局推进到结束，验证结算按钮文案
        for _ in range(30):
            advance(a)
            if state(a)["lobby"]:
                break
            a.wait_for_timeout(450)
        fin = state(a)
        print("final:", fin["round"], "lobby:", fin["lobby"], "modal:", (fin["modal"] or "")[:80])
        if fin["modal"]:
            shot(a, "features-result")
            again = a.evaluate(
                "() => { const b = document.querySelector('[data-result=\\\"again\\\"]'); return b ? b.textContent.trim() : null; }"
            )
            print("result again label:", again)

        ctx_c.close()
        ctx_a.close()
        browser.close()

    print("ERRORS:", json.dumps(errors, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
