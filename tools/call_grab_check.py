"""新叫地主/抢地主规则的浏览器实测（dev 8001，单真人 + 两个机器人）。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

import spectator_check
from spectator_check import act, errors, join, shot


def read_bar(page):
    return page.evaluate(
        r"""() => {
          const bar = document.querySelector('#bidding:not(.hidden)');
          if (!bar) return null;
          return {
            call: !!bar.querySelector('[data-call]'),
            grab: !!bar.querySelector('[data-grab]'),
            text: bar.innerText.replace(/\s+/g, ' ').trim(),
          };
        }"""
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8001/")
    ap.add_argument("--player", default="叫抢甲")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    spectator_check.URL = args.url.rstrip("/") + "/"
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)
        ctx, page = join(browser, args.player, {"width": 1180, "height": 688})
        page.click("[data-ready]")
        page.wait_for_selector("#bidding:not(.hidden)", timeout=30000)

        first = None
        for _ in range(100):
            bar = read_bar(page)
            if bar:
                if bar["call"]:
                    print("叫地主操作条:", bar["text"])
                    shot(page, "newrule-call-bar")
                    page.click('#bidding [data-call="1"]')
                    first = "call"
                    break
                if bar["grab"]:
                    print("抢地主操作条（机器人先叫）:", bar["text"])
                    shot(page, "newrule-grab-bar")
                    page.click('#bidding [data-grab="1"]')
                    first = "grab"
                    break
            page.wait_for_timeout(300)
        assert first, "没有等到叫/抢操作条"

        # 如果机器人抢了，叫地主者（我）会得到一次抢回机会
        for _ in range(80):
            bar = read_bar(page)
            if bar and bar["grab"]:
                print("抢回操作条:", bar["text"])
                shot(page, "newrule-reback-bar")
                page.click('#bidding [data-grab="1"]')
                break
            if not bar and page.locator("#actions:not(.hidden) [data-act]").count():
                break
            page.wait_for_timeout(350)

        # 把这局打完，验证结算条的文案
        play_checked = False
        for _ in range(160):
            if page.locator(".modal [data-result]").count():
                break
            if page.locator("#actions:not(.hidden) [data-act]").count():
                act(page)
                if not play_checked:
                    w = page.evaluate("""() => {
                      const cs = [...document.querySelectorAll('.play-zone:not(.hidden) .card')];
                      return cs.length ? Math.max(...cs.map(e => e.getBoundingClientRect().width)) : 0;
                    }""")
                    if w:
                        print("桌面出牌尺寸:", round(w, 1))
                        assert w >= 44, f"桌面上的出牌太小 {w:.1f}"
                        play_checked = True
            page.wait_for_timeout(350)

        modal = page.locator(".modal-card")
        assert modal.count(), "没有出现结算弹窗"
        text = modal.inner_text()
        breakdown = page.locator(".result-breakdown").inner_text()
        print("结算摘要:", breakdown.replace("\n", " · "))
        print("结算弹窗:", text[:220].replace("\n", " | "))
        assert "叫地主" in breakdown, "结算里应展示叫地主信息"
        assert "底分 100" in breakdown
        shot(page, "newrule-result")
        if errors:
            print("前端错误:", errors)
            raise SystemExit(1)
        ctx.close()
        browser.close()
    print("OK")


if __name__ == "__main__":
    main()
