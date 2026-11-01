"""Mobile layout smoke test using the locally installed Edge.

Run: python tools/mobile_check.py
Saves screenshots to shots/.
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"
URL = "http://127.0.0.1:8000/"


def shot(page, name: str) -> None:
    SHOTS.mkdir(exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=False)
    print("shot", name)


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="zh-CN")
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(800)
        shot(page, "m-entry")

        page.fill("#player-id", "测试摩尔")
        page.click("#login-btn")
        page.wait_for_selector("#customize:not(.hidden)", timeout=8000)
        page.wait_for_timeout(500)
        shot(page, "m-customize")

        page.click("#enter-table")
        page.wait_for_timeout(1500)
        shot(page, "m-lobby")

        start = page.locator("#lobby-panel button", has_text="开始").first
        if start.count() and start.is_visible():
            start.click()
            page.wait_for_timeout(1200)
            shot(page, "m-bidding")

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
