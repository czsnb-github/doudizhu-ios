"""Debug human play-flow on dev 8001: why turns stop advancing."""
from __future__ import annotations

from playwright.sync_api import Browser, Page, sync_playwright

URL = "http://127.0.0.1:8001/"


def join(browser: Browser, pid: str) -> Page:
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(300)
    page.fill("#player-id", pid)
    page.click("#login-btn")
    page.wait_for_selector("#customize:not(.hidden)", timeout=10000)
    page.click("#enter-table")
    page.wait_for_timeout(900)
    return page


def snap(page: Page) -> dict:
    return page.evaluate(
        """() => {
          const bar = document.querySelector('#actions');
          const bid = document.querySelector('#bidding');
          return {
            status: document.querySelector('#board-status') ? document.querySelector('#board-status').textContent.replace(/\\s+/g,' ').trim() : '',
            bid: !!(bid && !bid.classList.contains('hidden')),
            act: !!(bar && !bar.classList.contains('hidden')),
            hint: bar ? ((bar.querySelector('[data-act=hint]') || {}).disabled ?? null) : null,
            play: bar ? ((bar.querySelector('[data-act=play]') || {}).disabled ?? null) : null,
            pass: bar ? ((bar.querySelector('[data-act=pass]') || {}).disabled ?? null) : null,
            sel: bar ? (bar.querySelector('.selected') || {}).textContent : null,
            hintText: document.querySelector('#hand-hint') ? document.querySelector('#hand-hint').textContent : '',
            empty: document.querySelector('#hand .hand-empty') ? true : false,
            modal: !!document.querySelector('.modal'),
          };
        }"""
    )


def step(page: Page) -> str:
    return page.evaluate(
        """() => {
          const bid = document.querySelector('#bidding:not(.hidden) [data-bid="3"]:not(:disabled)');
          if (bid) { bid.click(); return 'bid3'; }
          const hint = document.querySelector('#actions:not(.hidden) [data-act="hint"]');
          if (hint && !hint.disabled) { hint.click(); return 'hint'; }
          const play = document.querySelector('#actions:not(.hidden) [data-act="play"]:not(:disabled)');
          if (play) { play.click(); return 'play'; }
          const pass = document.querySelector('#actions:not(.hidden) [data-act="pass"]:not(:disabled)');
          if (pass) { pass.click(); return 'pass'; }
          return 'none';
        }"""
    )


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        pages = [join(browser, f"DBG{i}") for i in range(3)]
        for pg in pages:
            pg.click("[data-ready]")
            pg.wait_for_timeout(300)
        pages[0].wait_for_timeout(1200)

        for rnd in range(24):
            line = [f"#{rnd}"]
            for i, pg in enumerate(pages):
                s = snap(pg)
                acts = []
                for _ in range(3):
                    acts.append(step(pg))
                    pg.wait_for_timeout(160)
                s2 = snap(pg)
                line.append(
                    f"P{i} st={s['status'][-14:]} bid={s['bid']} act={s['act']} "
                    f"hint={s['hint']} play={s['play']} pass={s['pass']} sel={s['sel']!r} "
                    f"=> {acts} nowAct={s2['act']} empty={s2['empty']} modal={s2['modal']}"
                )
            print("\n  ".join(line))
            pages[0].wait_for_timeout(650)

        for pg in pages:
            pg.context.close()
        browser.close()


if __name__ == "__main__":
    main()
