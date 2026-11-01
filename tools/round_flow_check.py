"""一个真人 + 两个 AI 打完整一局，验证结算弹窗、经验与“准备下一局”。dev 8001。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

from spectator_check import geo, join, shot, watch

URL = "http://127.0.0.1:8001/"


def try_bid(page) -> bool:
    btn = page.locator('#bidding:not(.hidden) [data-bid="3"]:not(:disabled)')
    if btn.count():
        btn.click()
        print("  bid 3")
        return True
    return False


def try_act(page) -> str:
    hint = page.locator('#actions:not(.hidden) [data-act="hint"]')
    if not hint.count() or hint.is_disabled():
        return "none"
    hint.click()
    page.wait_for_timeout(420)
    play = page.locator('#actions:not(.hidden) [data-act="play"]:not(:disabled)')
    if play.count():
        play.click()
        page.wait_for_timeout(420)
        return "play"
    pas = page.locator('#actions:not(.hidden) [data-act="pass"]:not(:disabled)')
    if pas.count():
        pas.click()
        page.wait_for_timeout(420)
        return "pass"
    return "stuck"


def main() -> None:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx, a = join(browser, "单局甲")
        watch_page = a
        watch_page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
        # 用 hard 档顺便验证：强难度机器人走 DouZero-WP 估值叫分
        a.evaluate("""() => { const b=document.querySelector('[data-diff="hard"]'); if (b) b.click(); }""")
        a.wait_for_timeout(300)
        before = geo(a)
        print("before:", before["round"], "| xp:", a.evaluate(
            """() => document.querySelector('#hand-xp') && document.querySelector('#hand-xp').style.width"""
        ))

        a.click("[data-ready]")
        a.wait_for_selector('#bidding:not(.hidden), #actions:not(.hidden)', timeout=30000)
        print("started, bidding…")
        # 中途加入的观战者：结束时也应看到三家剩牌
        ctx_d, d = join(browser, "单局观", {"width": 390, "height": 844})
        d.wait_for_timeout(1000)
        print("spectator hand:", geo(d)["handEmpty"])
        # AI 座位卡显示共用等级 Lv.N
        lv = a.evaluate(
            """() => Array.from(document.querySelectorAll('#seat-left .lv-tag, #seat-right .lv-tag')).map(e => e.textContent.trim())"""
        )
        print("lv tags:", lv)
        assert any(t.startswith("Lv.") for t in lv), lv
        bid_done = False
        last_status = None
        for i in range(240):
            if a.locator('[data-result="again"]').count():
                print(f"[{i}] result modal appeared")
                break
            if not bid_done:
                bid_done = try_bid(a)
            moved = try_act(a)
            if moved in ("play", "pass"):
                print(f"[{i}] A {moved}")
            g = geo(a)
            if g["status"] != last_status:
                last_status = g["status"]
                print("  status:", last_status)
            a.wait_for_timeout(320)
        else:
            raise SystemExit("game did not finish in time")

        a.wait_for_timeout(500)
        modal = a.evaluate(
            """() => {
              const m = document.querySelector('[data-modal] .modal-card');
              if (!m) return null;
              return {
                kicker: (m.querySelector('.modal-kicker')||{}).textContent || '',
                title: (m.querySelector('.modal-title')||{}).textContent || '',
                banner: (m.querySelector('.result-banner')||{}).textContent || '',
                xp: (m.querySelector('.rb-xp')||{}).textContent || '',
                rows: Array.from(m.querySelectorAll('.result-row')).map(r => r.textContent.replace(/\\s+/g,' ').trim()),
                hasAgain: !!m.querySelector('[data-result="again"]'),
                leftTitle: m.querySelector('.rl-title') ? m.querySelector('.rl-title').textContent.trim() : '',
                leftRows: Array.from(m.querySelectorAll('.rl-row')).map(r => ({
                  name: (r.querySelector('.rl-name')||{}).textContent.replace(/\\s+/g,' ').trim() || '',
                  cards: r.querySelectorAll('.rl-cards .card').length,
                  empty: !!r.querySelector('.rl-empty'),
                })),
              };
            }"""
        )
        print("RESULT MODAL:", modal)
        assert modal and modal["hasAgain"], "result modal should offer 准备下一局"
        assert "第 2 局" not in (modal["kicker"] or ""), "modal should describe the finished round"
        assert modal["leftTitle"] == "大家剩的牌", "result modal should list remaining cards"
        assert len(modal["leftRows"]) == 3, modal["leftRows"]
        assert sum(r["cards"] for r in modal["leftRows"]) > 0, modal["leftRows"]
        assert any(r["empty"] for r in modal["leftRows"]), "winner row should say 出完了"
        shot(a, "features-result-modal")
        shot(a, "features-result-left")

        # 观战者：结算里和桌面上都应看到三家的剩牌
        d.wait_for_selector('.rl-title', timeout=10000)
        d_modal = d.evaluate(
            """() => ({
              title: document.querySelector('.rl-title') ? document.querySelector('.rl-title').textContent.trim() : '',
              rows: Array.from(document.querySelectorAll('.rl-row')).map(r => ({
                cards: r.querySelectorAll('.rl-cards .card').length,
                empty: !!r.querySelector('.rl-empty'),
              })),
            })"""
        )
        print("SPECTATOR MODAL:", d_modal)
        assert d_modal["title"] == "大家剩的牌", d_modal
        assert len(d_modal["rows"]) == 3, d_modal
        assert sum(r["cards"] for r in d_modal["rows"]) > 0, d_modal
        shot(d, "features-result-left-spectator")
        d.click('[data-result="close"]')
        d.wait_for_timeout(700)
        d_reveal = d.evaluate(
            """() => Array.from(document.querySelectorAll('.play-zone.reveal:not(.hidden), .play-zone.winner:not(.hidden)')).map(z => ({
              id: z.id,
              head: (z.querySelector('.play-zone-head')||{}).textContent.replace(/\\s+/g,' ').trim() || '',
              cards: z.querySelectorAll('.card').length,
            }))"""
        )
        print("spectator reveal:", d_reveal)
        assert len(d_reveal) >= 2, "spectator should see every remaining hand on the table"
        assert any("胜" in x["head"] or "剩" in x["head"] for x in d_reveal), d_reveal
        shot(d, "features-table-left-spectator-390")

        # 关掉结算看牌桌：候场面板收起，对手没出的牌摊在各自座位前
        a.click('[data-result="close"]')
        a.wait_for_timeout(600)
        peek = a.evaluate(
            """() => ({
              lobbyHidden: document.querySelector('#lobby-panel').classList.contains('hidden'),
              next: document.querySelector('#hand-next') ? {
                hidden: document.querySelector('#hand-next').classList.contains('hidden'),
                text: document.querySelector('#hand-next').textContent.trim(),
              } : null,
              reveal: Array.from(document.querySelectorAll('.play-zone.reveal:not(.hidden), .play-zone.winner:not(.hidden)')).map(z => ({
                id: z.id,
                head: (z.querySelector('.play-zone-head')||{}).textContent.replace(/\\s+/g,' ').trim() || '',
                cards: z.querySelectorAll('.card').length,
              })),
            })"""
        )
        print("peek table:", peek)
        assert peek["lobbyHidden"], "看看牌桌 should hide the waiting panel"
        assert peek["reveal"] and any(x["cards"] > 0 for x in peek["reveal"]), (
            "opponents' remaining cards should show on table"
        )
        assert any("剩" in x["head"] or "胜" in x["head"] for x in peek["reveal"]), peek
        assert peek["next"] and not peek["next"]["hidden"], "hand dock should offer 准备下一局"
        shot(a, "features-table-left-390")

        # 手牌栏的“准备下一局”开下一局
        a.click("#hand-next")
        a.wait_for_timeout(500)
        try:
            a.wait_for_selector('#bidding:not(.hidden), #actions:not(.hidden)', timeout=20000)
        except Exception:
            pass
        g = geo(a)
        print("after hand-next:", g["round"], "| status:", g["status"])
        assert "第 2 局" in (g["round"] or ""), f"should start round 2, got {g['round']}"
        shot(a, "features-next-round-started")

        # 机器人详情：共用 AI 等级 + 胜率
        hit = a.evaluate(
            """() => { const boxes = Array.from(document.querySelectorAll('#seat-left, #seat-right'));
                       const b = boxes.find(x => /AI/.test(x.textContent)); if (b) b.click(); return !!b; }"""
        )
        assert hit, "bot seat not found"
        a.wait_for_selector(".pm-head", timeout=6000)
        a.wait_for_timeout(400)
        pm = a.evaluate("() => (document.querySelector('.modal-card')||{}).textContent || ''")
        assert "胜率" in pm and "AI" in pm, pm[:200]
        shot(a, "features-ai-modal")
        a.click(".modal-close")
        a.wait_for_timeout(300)

        # 抽屉：胜率 + 奶白拉姆
        a.click("#hand-me")
        a.wait_for_selector(".drawer-panel", timeout=5000)
        drawer = a.evaluate("() => (document.querySelector('.drawer-panel')||{}).textContent || ''")
        assert "胜率" in drawer, drawer[:200]
        a.click('#drawer-colors .color-dot[data-color="cream"]')
        a.wait_for_timeout(800)
        color_id = a.evaluate(
            """async () => (await (await fetch('/api/profile/' + encodeURIComponent('单局甲'))).json()).ram.color_id"""
        )
        print("ram color after cream:", color_id)
        assert color_id == "cream", color_id
        shot(a, "features-cream-ram")
        a.click("[data-drawer-close]")
        a.wait_for_timeout(300)

        # 头像圆框放大
        sizes = a.evaluate(
            """() => ({seat: (document.querySelector('#seat-left .avatar-badge img')||{}).getBoundingClientRect ? document.querySelector('#seat-left .avatar-badge img').getBoundingClientRect().width : null,
                       mini: (document.querySelector('.mini-avatar')||{}).getBoundingClientRect ? document.querySelector('.mini-avatar').getBoundingClientRect().width : null})"""
        )
        print("avatar sizes:", sizes)
        assert sizes["seat"] and sizes["seat"] >= 56, sizes
        assert sizes["mini"] and sizes["mini"] >= 48, sizes
        ctx.close()
        ctx_d.close()
        browser.close()
    print("ERRORS:", errors)


if __name__ == "__main__":
    main()
