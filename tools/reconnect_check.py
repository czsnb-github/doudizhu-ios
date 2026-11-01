"""Force a WebSocket drop and verify the frontend reconnects and refreshes state."""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"
URL = "http://127.0.0.1:8000/"

INIT = """
(() => {
  const Orig = window.WebSocket;
  window.__blockWS = false;
  window.WebSocket = class extends Orig {
    constructor(url, protocols) {
      if (window.__blockWS) throw new Error('ws blocked');
      super(url, protocols);
      window.__ws = this;
    }
  };
})();
"""


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="zh-CN")
        page = ctx.new_page()
        page.add_init_script(INIT)
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(500)
        page.fill("#player-id", "测试摩尔")
        page.click("#login-btn")
        page.wait_for_selector("#customize:not(.hidden)", timeout=8000)
        page.click("#enter-table")
        page.wait_for_timeout(1200)

        close = page.locator("#modal-root [data-close]")
        if close.count() and close.first.is_visible():
            close.first.click()
            page.wait_for_timeout(300)

        before = page.evaluate("() => document.querySelector('#board-status')?.textContent.trim()")
        page.evaluate("() => { window.__blockWS = true; window.__ws.close(); }")
        page.wait_for_timeout(400)
        down = page.evaluate("() => ({ cls: document.querySelector('#conn').className, text: document.querySelector('#conn-text').textContent })")
        page.screenshot(path=str(SHOTS / "m-disconnected.png"))

        page.evaluate("() => { window.__blockWS = false; }")
        page.wait_for_timeout(7000)
        up = page.evaluate("() => ({ cls: document.querySelector('#conn').className, text: document.querySelector('#conn-text').textContent })")
        after = page.evaluate("() => document.querySelector('#board-status')?.textContent.trim()")
        page.screenshot(path=str(SHOTS / "m-reconnected.png"))

        print("before:", before)
        print("down:", down)
        print("up:", up)
        print("after:", after)
        ctx.close()
        browser.close()


if __name__ == "__main__":
    main()
