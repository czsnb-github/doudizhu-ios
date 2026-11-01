"""自适应虚拟画布：多分辨率截图与基本几何检查（dev 8001，三真人桌）。"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

from spectator_check import geo, join, shot

VIEWPORTS = [
    (1920, 1080), (1366, 768), (1180, 688), (1133, 612),
    (768, 1024), (740, 360), (390, 844),
]


def ready(p):
    p.wait_for_selector("[data-ready]", timeout=8000)
    p.click("[data-ready]")


def main():
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="msedge", headless=True)
        ctx_a, a = join(b, f"适配甲{int(time.time())%10000}", {"width": 1920, "height": 1080})
        ctx_b, bb = join(b, f"适配乙{int(time.time())%10000}", {"width": 1180, "height": 688})
        ctx_c, c = join(b, f"适配丙{int(time.time())%10000}", {"width": 1133, "height": 612})
        for pg in (a, bb, c):
            ready(pg)
        a.wait_for_timeout(900)
        a.click('#bidding:not(.hidden) [data-bid="3"]')
        a.wait_for_timeout(600)
        a.wait_for_selector('#actions:not(.hidden) [data-act="hint"]', timeout=15000)
        a.click('#actions [data-act="hint"]')
        a.wait_for_timeout(500)
        a.click('#actions [data-act="play"]:not(:disabled)')
        a.wait_for_timeout(800)

        shots = [
            (a, 1920, 1080, "stage-1920x1080"),
            (a, 1366, 768, "stage-1366x768"),
            (bb, 1180, 688, "stage-1180x688"),
            (bb, 1133, 612, "stage-1133x612"),
            (bb, 768, 1024, "stage-768x1024"),
            (bb, 740, 360, "stage-740x360"),
        ]
        for pg, w, h, name in shots:
            pg.set_viewport_size({"width": w, "height": h})
            pg.wait_for_timeout(600)
            g = geo(pg)
            print(f"== {name} == board={g['board']} seatsL={g['seats']['left']['card']} zonesL={g['zones']['left']['shown']}")
            for slot in ("left", "right"):
                rc = g["seats"][slot]["card"]
                assert rc and rc["x"] >= -2 and rc["right"] <= g["vw"] + 2, (name, slot, rc)
            shot(pg, name)
        # 手机竖屏回归：窄模式
        bb.set_viewport_size({"width": 390, "height": 844})
        bb.wait_for_timeout(600)
        shot(bb, "stage-390x844")
        print("390 wide-mode:", bb.evaluate("() => document.body.classList.contains('stage-wide')"))

        for x in (ctx_c, ctx_b, ctx_a):
            x.close()
        b.close()
    print("ERRORS:", errors)


if __name__ == "__main__":
    main()
