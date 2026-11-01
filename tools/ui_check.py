"""UI smoke test against the local server using the installed Edge.

Run: python tools/ui_check.py
Saves screenshots to shots/.
"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import Locator, Page, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"
URL = "http://127.0.0.1:8000/"
PID = "测试摩尔"


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=False)
    print("shot", name)


def visible(page: Page, selector: str) -> bool:
    loc = page.locator(selector)
    return loc.count() > 0 and loc.first.is_visible()


def click_if(page: Page, selector: str) -> bool:
    loc = page.locator(selector)
    if loc.count() and loc.first.is_visible() and loc.first.is_enabled():
        loc.first.click()
        return True
    return False


def start_or_resume(page: Page, prefix: str) -> None:
    page.wait_for_timeout(700)
    if visible(page, "#modal-root .modal"):
        shot(page, f"{prefix}-result")
        click_if(page, "#modal-root .btn-primary")
        page.wait_for_timeout(900)
    if visible(page, "#lobby-panel:not(.hidden)"):
        shot(page, f"{prefix}-lobby")
        start = page.locator("#lobby-panel button", has_text="开始")
        if start.count() and start.first.is_visible():
            start.first.click()
            page.wait_for_timeout(900)
    if visible(page, "#bidding:not(.hidden)"):
        shot(page, f"{prefix}-bidding")
        click_if(page, '#bidding [data-bid="3"]')
        page.wait_for_timeout(1000)


def play_once(page: Page, prefix: str) -> None:
    if not visible(page, "#actions:not(.hidden)"):
        return
    shot(page, f"{prefix}-play")
    click_if(page, '#actions [data-act="hint"]')
    page.wait_for_timeout(800)
    shot(page, f"{prefix}-hint")
    click_if(page, '#actions [data-act="play"]')
    page.wait_for_timeout(1500)
    shot(page, f"{prefix}-after-play")


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)

        # --- 桌面宽屏入口 ---
        wide = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
        wp = wide.new_page()
        wp.goto(URL, wait_until="networkidle")
        wp.wait_for_timeout(1800)
        shot(wp, "desk-entry")
        wide.close()

        # --- 手机流程 ---
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="zh-CN"
        )
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle")
        page.wait_for_timeout(1800)
        shot(page, "m-entry")

        page.fill("#player-id", PID)
        page.click("#login-btn")
        page.wait_for_selector("#customize:not(.hidden)", timeout=8000)
        page.wait_for_timeout(500)
        shot(page, "m-customize")

        page.click("#enter-table")
        page.wait_for_timeout(1200)
        start_or_resume(page, "m")
        shot(page, "m-table")
        play_once(page, "m")

        # 抽屉
        if visible(page, "#profile-chip"):
            page.click("#profile-chip")
            page.wait_for_timeout(600)
            shot(page, "m-drawer")
            click_if(page, "#drawer-root .drawer-close")
            page.wait_for_timeout(300)

        # 横屏平板
        pad = browser.new_context(viewport={"width": 820, "height": 1180}, locale="zh-CN")
        pp = pad.new_page()
        pp.goto(URL, wait_until="networkidle")
        pp.wait_for_timeout(1800)
        shot(pp, "pad-entry")
        pad.close()
        ctx.close()

        # 桌面宽屏牌桌
        desk = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
        dp = desk.new_page()
        dp.goto(URL, wait_until="networkidle")
        dp.wait_for_timeout(1200)
        dp.fill("#player-id", PID)
        dp.click("#login-btn")
        dp.wait_for_selector("#customize:not(.hidden)", timeout=8000)
        dp.click("#enter-table")
        dp.wait_for_timeout(1500)
        shot(dp, "desk-table")
        desk.close()

        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
