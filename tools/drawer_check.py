"""Quick check: drawer difficulty switch + console errors."""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"
URL = "http://127.0.0.1:8000/"


def main() -> None:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="zh-CN")
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(600)
        page.fill("#player-id", "测试摩尔")
        page.click("#login-btn")
        page.wait_for_selector("#customize:not(.hidden)", timeout=8000)
        page.click("#enter-table")
        page.wait_for_timeout(1200)
        close = page.locator("#modal-root [data-close]")
        if close.count() and close.first.is_visible():
            close.first.click()
            page.wait_for_timeout(400)
        page.click("#profile-chip")
        page.wait_for_timeout(500)
        page.locator("#drawer-diff").scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / "m-drawer-diff.png"))
        page.click('#drawer-diff [data-diff="master"]')
        page.wait_for_timeout(500)
        print("active:", page.evaluate("() => document.querySelector('#drawer-diff .diff-btn.active')?.textContent.trim()"))
        print("toast:", page.evaluate("() => document.querySelector('#toast').textContent"))
        page.screenshot(path=str(SHOTS / "m-drawer-diff-master.png"))
        ctx.close()
        browser.close()
    print("console errors:", errors or "none")


if __name__ == "__main__":
    main()
