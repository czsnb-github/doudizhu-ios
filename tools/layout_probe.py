"""精确量一下底牌/状态条/座位/出牌区的位置，供布局调参。dev 8001。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

from spectator_check import act, bid_three, join, ready

URL = "http://127.0.0.1:8001/"


def rects(page):
    return page.evaluate(
        """() => {
          const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
            return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width),
                    h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom)}; };
          const q = (s) => document.querySelector(s);
          const zone = (k) => {
            const z = q('#play-' + k);
            return {box: r(z), head: r(z && z.querySelector('.play-zone-head')),
                    card: r(z && z.querySelector('.card')),
                    shown: !!(z && !z.classList.contains('hidden'))};
          };
          return {
            vw: innerWidth, vh: innerHeight,
            board: r(q('.board')), head: r(q('.board-head')),
            status: r(q('#board-status')), bottom: r(q('#bottom-area')),
            bottomCards: r(q('#bottom-cards')),
            seats: {top: r(q('#seat-top .seat-card')), left: r(q('#seat-left .seat-card')),
                    right: r(q('#seat-right .seat-card'))},
            zones: {top: zone('top'), left: zone('left'), right: zone('right'), bottom: zone('bottom')},
          };
        }"""
    )


def show(tag, page):
    d = rects(page)
    print(f"\n== {tag} {d['vw']}x{d['vh']}")
    for k in ("board", "head", "status", "bottom", "bottomCards"):
        print(f"  {k:12s} {d[k]}")
    for k, v in d["seats"].items():
        print(f"  seat {k:6s} {v}")
    for k, v in d["zones"].items():
        print(f"  zone {k:6s} shown={v['shown']} head={v['head']} card={v['card']}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx_a, a = join(browser, "探针东", {"width": 1024, "height": 768})
        ctx_b, b = join(browser, "探针南", {"width": 1024, "height": 768})
        ready(a)
        ready(b)
        a.wait_for_timeout(700)
        bid_three(a)
        a.wait_for_selector('#actions:not(.hidden) [data-act="hint"]', timeout=20000)
        print("A moved:", act(a))
        a.wait_for_timeout(600)
        ctx_d, d = join(browser, "探针观", {"width": 1024, "height": 768})
        d.wait_for_timeout(1000)
        show("spectator 1024x768", d)
        d.set_viewport_size({"width": 740, "height": 360})
        d.wait_for_timeout(600)
        show("spectator 740x360", d)
        d.set_viewport_size({"width": 390, "height": 844})
        d.wait_for_timeout(600)
        show("spectator 390x844", d)

        # 玩家视角：等乙出牌后，右家出牌区出现
        b.wait_for_selector('#actions:not(.hidden) [data-act="hint"]', timeout=20000)
        print("B moved:", act(b))
        a.wait_for_timeout(700)
        a.set_viewport_size({"width": 1024, "height": 768})
        a.wait_for_timeout(500)
        show("player 1024x768", a)
        a.set_viewport_size({"width": 390, "height": 844})
        a.wait_for_timeout(500)
        show("player 390x844", a)
        a.set_viewport_size({"width": 740, "height": 360})
        a.wait_for_timeout(500)
        show("player 740x360", a)

        for c in (ctx_d, ctx_a, ctx_b):
            c.close()
        browser.close()


if __name__ == "__main__":
    main()
