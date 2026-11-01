"""Entry-screen screenshots at desktop / tablet / phone sizes."""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"
URL = "http://127.0.0.1:8000/"


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        for name, w, h, scale in (
            ("desk-entry", 1440, 900, 1),
            ("pad-entry", 820, 1180, 1),
            ("m-entry", 390, 844, 2),
        ):
            ctx = browser.new_context(
                viewport={"width": w, "height": h}, device_scale_factor=scale, locale="zh-CN"
            )
            page = ctx.new_page()
            page.goto(URL, wait_until="networkidle")
            page.wait_for_timeout(1800)
            page.screenshot(path=str(SHOTS / f"{name}.png"))
            print("shot", name)
            ctx.close()
        browser.close()


if __name__ == "__main__":
    main()
