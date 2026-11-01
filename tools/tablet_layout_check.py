"""三真人桌：检查 1133x612 / 1180x688 平板横屏布局（不调用 AI 模型）。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

from spectator_check import geo, join, shot, watch

URL = "http://127.0.0.1:8001/"


def ready(p):
    p.wait_for_selector("[data-ready]", timeout=8000)
    p.click("[data-ready]")


def main():
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="msedge", headless=True)
        ctx_a, a = join(b, "平板甲", {"width": 1180, "height": 688})
        ctx_b, bb = join(b, "平板乙", {"width": 1133, "height": 612})
        ctx_c, c = join(b, "平板丙", {"width": 1024, "height": 768})
        for pg in (a, bb, c):
            ready(pg)
        a.wait_for_timeout(900)
        a.click('#bidding:not(.hidden) [data-bid="3"]')
        a.wait_for_timeout(600)
        a.wait_for_selector('#actions:not(.hidden) [data-act="hint"]', timeout=15000)
        a.click('#actions [data-act="hint"]')
        a.wait_for_timeout(500)
        a.click('#actions [data-act="play"]:not(:disabled)')
        a.wait_for_timeout(700)

        ctx_d, d = join(b, "平板观", {"width": 1133, "height": 612})
        d.wait_for_timeout(1000)

        for tag, pg, name in (("1180x688", a, "features-tablet-1180x688"),
                              ("1133x612", bb, "features-tablet-1133x612"),
                              ("spectator-1133x612", d, "features-tablet-spectator-1133x612")):
            g = geo(pg)
            print("\n==", tag, "==")
            print(" board", g["board"], "bottomCards", g["bottomCards"])
            for slot in ("top", "left", "right"):
                s = g["seats"][slot]
                print(" seat", slot, "hidden", s["hidden"], "name", s["name"], "card", s["card"])
            print(" zones", {k: (v["shown"], v["rect"]) for k, v in g["zones"].items()})
            # 座位卡不能超出视口
            for slot in ("top", "left", "right"):
                s = g["seats"][slot]
                if not s["hidden"] and s["card"]:
                    rc = s["card"]
                    assert rc["x"] >= 0 and rc["right"] <= g["vw"], (tag, slot, rc)
                    assert rc["y"] >= 0 and rc["bottom"] <= g["vh"], (tag, slot, rc)
            assert not g["seats"]["left"]["hidden"] and not g["seats"]["right"]["hidden"], (tag, "side seats hidden")
            shot(pg, name)

        for x in (ctx_d, ctx_a, ctx_b, ctx_c):
            x.close()
        b.close()
    print("\nERRORS:", errors)


if __name__ == "__main__":
    main()
