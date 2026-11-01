"""观战者 + 按座位出牌区 QA（dev 8001）。

流程：两个真人 + 1 个机器人开局，真人甲叫 3 分并出牌，
然后第三个人中途加入 —— 必须成为观战者而不是顶掉机器人座位。
"""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"
URL = "http://127.0.0.1:8001/"
errors: list[str] = []


def shot(page: Page, name: str) -> None:
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    print("shot", name)


def watch(page: Page, tag: str) -> None:
    page.on("pageerror", lambda exc: errors.append(f"{tag} pageerror: {exc}"))
    page.on(
        "console",
        lambda msg: errors.append(f"{tag} console: {msg.text}")
        if msg.type == "error" else None,
    )


def join(
    browser: Browser,
    pid: str,
    viewport: dict | None = None,
) -> tuple[BrowserContext, Page]:
    ctx = browser.new_context(
        viewport=viewport or {"width": 390, "height": 844},
        device_scale_factor=2,
        locale="zh-CN",
    )
    page = ctx.new_page()
    watch(page, pid)
    page.goto(URL, wait_until="networkidle")
    page.wait_for_timeout(400)
    page.fill("#player-id", pid)
    page.click("#login-btn")
    page.wait_for_selector("#customize:not(.hidden)", timeout=15000)
    page.click("#enter-table")
    page.wait_for_timeout(1200)
    return ctx, page


def ready(page: Page) -> None:
    page.wait_for_selector("[data-ready]", timeout=8000)
    page.click("[data-ready]")


def bid_three(page: Page) -> None:
    page.wait_for_selector(
        '#bidding:not(.hidden) [data-bid="3"]:not(:disabled)', timeout=20000
    )
    page.click('#bidding [data-bid="3"]')
    page.wait_for_timeout(600)


def act(page: Page) -> str:
    """当前轮到该页出牌：点提示、等渲染，再出牌或不出。返回实际动作。"""
    hint = page.locator('#actions:not(.hidden) [data-act="hint"]')
    if not hint.count():
        return "none"
    hint.click()
    page.wait_for_timeout(480)
    play = page.locator('#actions:not(.hidden) [data-act="play"]:not(:disabled)')
    if play.count():
        play.click()
        page.wait_for_timeout(500)
        return "play"
    pas = page.locator('#actions:not(.hidden) [data-act="pass"]:not(:disabled)')
    if pas.count():
        pas.click()
        page.wait_for_timeout(500)
        return "pass"
    return "stuck"


def geo(page: Page) -> dict:
    return page.evaluate(
        """() => {
          const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
            return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width),
                    h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom)}; };
          const q = (s) => document.querySelector(s);
          const seat = (slot) => {
            const el = q('#seat-' + slot);
            return {
              wrap: r(el),
              card: r(q('#seat-' + slot + ' .seat-card')),
              name: q('#seat-' + slot + ' .seat-name') ? q('#seat-' + slot + ' .seat-name').textContent.trim() : null,
              sub: q('#seat-' + slot + ' .seat-sub') ? q('#seat-' + slot + ' .seat-sub').textContent.replace(/\\s+/g,' ').trim() : null,
              hidden: !el || el.classList.contains('hidden'),
            };
          };
          const zone = (k) => {
            const el = q('#play-' + k);
            const cards = el ? el.querySelectorAll('.card').length : 0;
            return {rect: r(el), head: r(el && el.querySelector('.play-zone-head')),
                    card: r(el && el.querySelector('.card')),
                    shown: !!(el && !el.classList.contains('hidden') && cards),
                    cards, live: !!(el && el.classList.contains('live'))};
          };
          return {
            vw: innerWidth, vh: innerHeight,
            board: r(q('.board')),
            bottomCards: r(q('#bottom-cards')),
            actions: r(q('#actions')),
            seats: {top: seat('top'), left: seat('left'), right: seat('right')},
            zones: Object.fromEntries(['top','left','right','bottom'].map(k => [k, zone(k)])),
            handEmpty: q('#hand .hand-empty') ? q('#hand .hand-empty').textContent.replace(/\\s+/g,' ').trim() : null,
            sitShown: q('#spectate-sit') ? !q('#spectate-sit').classList.contains('hidden') : null,
            readyBtn: !!q('[data-ready]'),
            round: q('#round-pill') ? q('#round-pill').textContent.trim() : null,
            status: q('#board-status') ? q('#board-status').textContent.replace(/\\s+/g,' ').trim() : null,
          };
        }"""
    )


def overlap(a: dict | None, b: dict | None) -> bool:
    if not a or not b:
        return False
    return (
        a["x"] < b["x"] + b["w"]
        and b["x"] < a["x"] + a["w"]
        and a["y"] < b["y"] + b["h"]
        and b["y"] < a["y"] + a["h"]
    )


def inspect(page: Page, tag: str, shot_name: str | None = None) -> dict:
    g = geo(page)
    print(f"\n== {tag} == {g['vw']}x{g['vh']} | {g['round']} | {g['status']}")
    for slot in ("top", "left", "right"):
        s = g["seats"][slot]
        print(f"  seat {slot:5s} hidden={s['hidden']} name={s['name']!r} wrap={s['wrap']} sub={s['sub']!r}")
    for k, z in g["zones"].items():
        print(f"  zone {k:6s} shown={z['shown']} live={z['live']} cards={z['cards']} rect={z['rect']}")
    print("  hand:", g["handEmpty"], "| sitShown:", g["sitShown"], "| readyBtn:", g["readyBtn"])
    if shot_name:
        shot(page, shot_name)
    return g


def main() -> None:
    SHOTS.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx_a, a = join(browser, "QA东家")
        ctx_b, b = join(browser, "QA南家")

        ready(a)
        ready(b)
        a.wait_for_timeout(600)
        bid_three(a)
        print("bid 3 done, phase label:", geo(a)["round"])

        # 甲（座位 0）先出第一手，保证观战者能看到顶部出牌区
        a.wait_for_selector('#actions:not(.hidden) [data-act="hint"]', timeout=20000)
        moved = act(a)
        a.wait_for_timeout(500)
        ga = geo(a)
        print("landlord first move:", moved, "| A zones:", {k: z["shown"] for k, z in ga["zones"].items()})
        assert moved == "play", "landlord should be able to play the first hand"
        assert ga["zones"]["bottom"]["shown"], "own play should show in bottom zone"

        # 中途加入的人必须观战
        ctx_d, d = join(browser, "QA观战")
        d.wait_for_timeout(1200)
        gd = inspect(d, "spectator joins mid-game", "features-spectator-real-390")

        names = [gd["seats"][s]["name"] for s in ("top", "left", "right")]
        assert all(n for n in names), f"spectator must see three seats, got {names}"
        assert gd["handEmpty"] and "观战" in gd["handEmpty"], "new player must be spectator mid-game"
        assert gd["sitShown"] is False and gd["readyBtn"] is False, "spectator cannot sit/ready mid-game"
        assert "QA东家" in names[0], f"seat 0 should be QA东家, got {names[0]}"
        assert "AI" not in (gd["seats"]["top"]["sub"] or ""), (
            "seat 0 (landlord QA东家) should still be the human, not replaced"
        )
        assert gd["seats"]["right"]["sub"] and "AI" in gd["seats"]["right"]["sub"], (
            "seat 2 must still be the bot (new player may not take over a bot hand)"
        )
        assert gd["zones"]["top"]["shown"], "spectator should see seat 0's play near the top seat"
        assert not gd["zones"]["bottom"]["shown"], "spectator has no bottom/own play zone"

        # 390 手机：三张座位卡并排可见且互不遮挡
        cards = {s: gd["seats"][s]["card"] for s in ("top", "left", "right")}
        for s, rc in cards.items():
            assert rc, f"seat {s} card missing"
            assert rc["x"] >= 0 and rc["right"] <= gd["vw"], f"seat {s} card clipped: {rc}"
            assert rc["y"] >= 0 and rc["bottom"] <= gd["vh"], f"seat {s} card clipped: {rc}"
        for s1, s2 in (("top", "left"), ("top", "right"), ("left", "right")):
            assert not overlap(cards[s1], cards[s2]), f"seat cards overlap: {s1}/{s2} {cards[s1]} {cards[s2]}"
        assert not overlap(gd["seats"]["top"]["card"], gd["zones"]["top"]["rect"]), (
            "top play zone must not cover the top seat card"
        )

        # 其他尺寸下的观战布局
        for vp, name in (
            ({"width": 360, "height": 740}, "features-spectator-360x740"),
            ({"width": 1024, "height": 768}, "features-spectator-1024x768"),
            ({"width": 768, "height": 1024}, "features-spectator-768x1024"),
            ({"width": 740, "height": 360}, "features-spectator-740x360"),
        ):
            d.set_viewport_size(vp)
            d.wait_for_timeout(700)
            gi = inspect(d, f"spectator @{vp['width']}x{vp['height']}", name)
            assert all(not gi["seats"][s]["hidden"] for s in ("top", "left", "right")), (
                f"all three seats must be visible at {vp}"
            )
            cs = {s: gi["seats"][s]["card"] for s in ("top", "left", "right")}
            for s, rc in cs.items():
                assert rc and rc["x"] >= 0 and rc["right"] <= gi["vw"], f"{s} seat clipped at {vp}"
            assert not overlap(cs["left"], cs["right"]), f"left/right seats overlap at {vp}"

        d.set_viewport_size({"width": 390, "height": 844})
        d.wait_for_timeout(500)

        # 轮到乙出牌：让 390 手机上的甲看到右侧座位的出牌区
        b.wait_for_selector('#actions:not(.hidden) [data-act="hint"]', timeout=20000)
        b_move = act(b)
        b.wait_for_timeout(700)
        print("\nB move:", b_move)
        ga = inspect(a, "player A after B moved", "features-zones-player-390")
        assert b_move in ("play", "pass")
        if b_move == "play":
            assert ga["zones"]["right"]["shown"], "A should see B's (right seat) play in the right zone"
        assert not overlap(ga["zones"]["right"]["head"], ga["bottomCards"]), (
            "right play zone must not cover the bottom cards on phone"
        )
        assert not overlap(ga["zones"]["right"]["card"], ga["bottomCards"]), (
            "right play cards must not cover the bottom cards on phone"
        )

        # 桌面尺寸下玩家视角的左右出牌区
        a.set_viewport_size({"width": 1024, "height": 768})
        a.wait_for_timeout(700)
        ga2 = inspect(a, "player A @1024x768", "features-zones-player-1024")
        if b_move == "play":
            assert ga2["zones"]["right"]["shown"], "right zone should stay at 1024"
        for k in ("left", "right"):
            z = ga2["zones"][k]
            if z["shown"]:
                assert not overlap(z["head"], ga2["bottomCards"]), (
                    f"{k} zone head must not cover the bottom cards on desktop"
                )
                assert not overlap(z["card"], ga2["bottomCards"]), (
                    f"{k} zone card must not cover the bottom cards on desktop"
                )

        # 横屏手机：出牌区也不应压住座位卡
        a.set_viewport_size({"width": 740, "height": 360})
        a.wait_for_timeout(700)
        ga3 = inspect(a, "player A @740x360", "features-zones-player-740x360")
        assert not overlap(ga3["seats"]["left"]["card"], ga3["zones"]["left"]["rect"]), (
            "left zone must not cover left seat card"
        )
        assert not overlap(ga3["seats"]["right"]["card"], ga3["zones"]["right"]["rect"]), (
            "right zone must not cover right seat card"
        )
        for k in ("left", "right"):
            z = ga3["zones"][k]
            if z["shown"]:
                assert not overlap(z["card"], ga3["bottomCards"]), (
                    f"{k} zone card must not cover the bottom cards in landscape"
                )
                if ga3["actions"]:
                    assert not overlap(z["card"], ga3["actions"]), (
                        f"{k} zone card must not cover the action bar in landscape"
                    )

        for ctx in (ctx_d, ctx_a, ctx_b):
            ctx.close()
        browser.close()
    print("\nERRORS:", errors)


if __name__ == "__main__":
    main()
