"""退出当前局：确认弹窗 → 全员退出后牌桌清空重开（dev 8001）。"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

from spectator_check import join, shot


def main():
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="msedge", headless=True)
        ctx, a = join(b, "退出甲", {"width": 1180, "height": 688})
        a.click("[data-ready]")
        a.wait_for_selector('#bidding:not(.hidden), #actions:not(.hidden)', timeout=20000)
        a.click("#hand-me")
        a.wait_for_selector(".drawer-panel", timeout=5000)
        btn_text = a.locator("[data-leave-table]").text_content()
        print("drawer button:", btn_text)
        assert "退出当前局" in btn_text, btn_text
        a.locator("[data-leave-table]").first.dispatch_event("click")
        a.wait_for_selector('[data-confirm="ok"]', timeout=5000)
        shot(a, "features-exit-confirm")
        a.locator('[data-confirm="ok"]').first.dispatch_event("click")
        a.wait_for_timeout(800)
        print("on entry screen:", a.locator("#screen-entry:not(.hidden)").count())

        ctx2, c = join(b, "退出乙", {"width": 390, "height": 844})
        c.click("[data-ready]")
        c.wait_for_selector('#bidding:not(.hidden), #actions:not(.hidden)', timeout=20000)
        c.click("#hand-me")
        c.wait_for_selector(".drawer-panel", timeout=5000)
        c.locator("[data-leave-table]").first.dispatch_event("click")
        c.wait_for_selector('[data-confirm="ok"]', timeout=5000)
        c.locator('[data-confirm="ok"]').first.dispatch_event("click")
        c.wait_for_timeout(800)
        with urllib.request.urlopen("http://127.0.0.1:8001/api/history?limit=5", timeout=5) as r:
            hist = r.read().decode()
        print("history after exits:", hist)
        assert '"rows":[]' in hist, hist
        for x in (ctx2, ctx):
            x.close()
        b.close()
    print("ERRORS:", errors)


if __name__ == "__main__":
    main()
