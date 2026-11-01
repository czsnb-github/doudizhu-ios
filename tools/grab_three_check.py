"""叫 3 分后，下家仍然可以抢地主（dev 8001）。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

from spectator_check import join, shot


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="msedge", headless=True)
        ctx, a = join(b, "三分甲", {"width": 1180, "height": 688})
        a.click("[data-ready]")
        a.wait_for_selector('#bidding:not(.hidden)', timeout=20000)
        a.click('#bidding:not(.hidden) [data-bid="3"]')
        # 观察气泡：机器人应当出现“抢地主！”或“不抢”，说明进入了抢地主阶段
        seen = []
        for _ in range(40):
            bubbles = a.evaluate(
                """() => Array.from(document.querySelectorAll('.seat-bubble')).map(e => e.textContent.trim())"""
            )
            for t in bubbles:
                if ("抢" in t or "不抢" in t) and t not in seen:
                    seen.append(t)
            if seen:
                break
            a.wait_for_timeout(200)
        print("grab bubbles:", seen)
        assert seen, "3 分之后应该进入抢地主阶段"
        chip = a.locator("#mult-chip").text_content()
        print("multiplier chip:", chip)
        shot(a, "features-grab-after-three")
        ctx.close()
        b.close()
    print("OK")


if __name__ == "__main__":
    main()
