"""检查客户端分辨率上报（dev 8001）。"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

from spectator_check import join

BASE = "http://127.0.0.1:8001"


def clients() -> dict:
    with urllib.request.urlopen(f"{BASE}/api/clients", timeout=5) as resp:
        return json.loads(resp.read().decode())


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx, page = join(browser, "分辨率甲", {"width": 390, "height": 844})
        page.wait_for_timeout(700)
        data = clients()
        print("390x844:", json.dumps(data, ensure_ascii=False, indent=2))
        assert data["count"] == 1, data
        info = data["clients"][0]["info"]
        assert info["vw"] == 390 and info["vh"] == 844, info
        assert info["dpr"] == 2.0, info
        assert info["orientation"] == "portrait", info
        assert "HeadlessChrome" in info["ua"] or "Chrome" in info["ua"], info

        page.set_viewport_size({"width": 740, "height": 360})
        page.wait_for_timeout(1200)
        data = clients()
        info = data["clients"][0]["info"]
        print("740x360:", json.dumps(info, ensure_ascii=False))
        assert info["vw"] == 740 and info["vh"] == 360, info
        assert info["orientation"] == "landscape", info
        assert data["clients"][0]["pid"] == "分辨率甲", data

        ctx.close()
        time.sleep(0.5)
        print("after close:", clients())
        browser.close()


if __name__ == "__main__":
    main()
