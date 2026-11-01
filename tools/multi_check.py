"""Multi-player and reconnect checks for the single-table frontend."""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"
URL = "http://127.0.0.1:8000/"


def shot(page: Page, name: str) -> None:
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    print("shot", name)


def join(browser: Browser, pid: str) -> tuple[BrowserContext, Page]:
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="zh-CN")
    page = ctx.new_page()
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(500)
    page.fill("#player-id", pid)
    page.click("#login-btn")
    page.wait_for_selector("#customize:not(.hidden)", timeout=8000)
    page.click("#enter-table")
    page.wait_for_timeout(1400)
    return ctx, page


def seats(page: Page) -> str:
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('.seat-name')).map(el => el.textContent.trim()).join(' / ')"
    )


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)

        ctx_a, a = join(browser, "测试摩尔")
        shot(a, "multi-a")
        print("A seats:", seats(a))

        ctx_b, b = join(browser, "测试阿花")
        shot(b, "multi-b")
        print("B seats:", seats(b))
        a.wait_for_timeout(800)
        print("A seats after B:", seats(a))

        ctx_c, c = join(browser, "测试阿豆")
        c.wait_for_timeout(900)
        print("C seats:", seats(c))

        ctx_d, d = join(browser, "测试看客")
        d.wait_for_timeout(1200)
        shot(d, "multi-spectator")
        print("D view:", d.evaluate("() => document.querySelector('.hand-dock').textContent.replace(/\\s+/g,' ').trim().slice(0,120)"))
        print("D has sit button:", d.evaluate("() => { const b=document.querySelector('#spectate-sit'); return b && !b.classList.contains('hidden') ? b.textContent.trim() : null; }"))

        # 重连：A 断网 3 秒再恢复
        ctx_a.set_offline(True)
        a.wait_for_timeout(2500)
        shot(a, "multi-offline")
        ctx_a.set_offline(False)
        a.wait_for_timeout(7000)
        shot(a, "multi-reconnect")
        print("A reconnected:", a.evaluate("() => document.querySelector('#conn').classList.contains('hidden')"))

        for ctx in (ctx_a, ctx_b, ctx_c, ctx_d):
            ctx.close()
        browser.close()


if __name__ == "__main__":
    main()
