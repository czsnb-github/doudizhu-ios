"""抢地主 UI 全流程：两个真人叫分 → 进入抢地主 → 抢 → 倍数 ×2（dev 8001）。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

from spectator_check import geo, join, shot


def main():
    errors = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="msedge", headless=True)
        ctx_a, a = join(b, "抢甲", {"width": 1180, "height": 688})
        ctx_b, bb = join(b, "抢乙", {"width": 390, "height": 844})
        for pg in (a, bb):
            ready(pg)
        a.wait_for_timeout(900)

        # A 叫 1 分，B 叫 2 分 → B 成为待抢地主，A 有抢权
        a.click('#bidding:not(.hidden) [data-bid="1"]')
        a.wait_for_timeout(500)
        bb.click('#bidding:not(.hidden) [data-bid="2"]')
        bb.wait_for_timeout(700)
        # 机器人 C 也会叫分/抢地主，等 A 的抢地主按钮出现
        a.wait_for_selector('#bidding:not(.hidden) [data-grab="1"]', timeout=10000)
        chip = a.locator("#mult-chip").text_content()
        before = int(chip.replace("×", ""))
        print("multiplier chip before grab:", chip)

        a.click('#bidding [data-grab="1"]')
        a.wait_for_timeout(700)
        grab_gone = a.locator('#bidding:not(.hidden) [data-grab]').count() == 0
        chip2 = a.locator("#mult-chip").text_content()
        print("after grab: bar gone =", grab_gone, "| chip:", chip2)
        assert grab_gone, "grab bar should close after grabbing"
        assert "×" + str(before * 2) in chip2, (chip, chip2)  # 抢一次倍数 ×2

        # A 抢成地主，地主先出牌
        a.wait_for_selector('#actions:not(.hidden) [data-act="hint"]', timeout=15000)
        role = a.evaluate("() => (document.querySelector('#hand-role')||{}).textContent || ''")
        print("A role:", role)
        assert "地主" in role, role
        status = a.evaluate("() => (document.querySelector('#board-status')||{}).textContent || ''")
        print("status:", status)
        shot(a, "features-grab-landlord")

        bb.wait_for_timeout(400)
        shot(bb, "features-grab-landlord-b390")
        for x in (ctx_b, ctx_a):
            x.close()
        b.close()
    print("ERRORS:", errors)


def ready(p):
    p.wait_for_selector("[data-ready]", timeout=8000)
    p.click("[data-ready]")


if __name__ == "__main__":
    main()
