"""UI / 提醒 / 尺寸回归测试（Playwright Edge，独立数据）。

对着一台**干净**的实例跑（默认 8001，或 release_check 起的临时端口）：
- 1180×688 / 1133×612：手牌不能被压到 40px，提示字号不能掉到 10px；
- 390×844：触控按钮要够大，不能横向溢出；
- 轮到自己 15 秒不操作：提醒条出现、标题变化、至少 3 个提示音振荡器。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urljoin

sys.path.insert(0, str(Path(__file__).resolve().parent))

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "shots"

AUDIO_COUNTER = """(() => {
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return;
  const orig = C.prototype.createOscillator;
  C.prototype.createOscillator = function (...args) {
    window.__osc = (window.__osc || 0) + 1;
    return orig.apply(this, args);
  };
})();"""

PROBE = """() => {
  const q = (s) => document.querySelector(s);
  const cs = (s) => { const el = q(s); return el ? getComputedStyle(el) : null; };
  const box = (s) => { const el = q(s); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
  return {
    vw: innerWidth, vh: innerHeight,
    scrollW: document.documentElement.scrollWidth,
    card: box('#hand .card'),
    handTop: box('.hand-top'),
    avatar: box('.mini-avatar'),
    ram: box('.hand-ram'),
    bottomCard: box('.bottom-cards .card'),
    bottomBox: (() => { const e = q('.board-head .bottom-area'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; })(),
    boardBox: (() => { const e = q('.board'); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; })(),
    hintFont: parseFloat(cs('.hand-hint')?.fontSize || '0'),
    nameFont: parseFloat(cs('.hand-id b')?.fontSize || '0'),
    statusFont: parseFloat(cs('.board-status')?.fontSize || '0'),
    seatAvatar: box('.avatar-badge img'),
    bidBtn: box('#bidding .bid-btn'),
    bidFont: parseFloat(cs('#bidding .bid-btn')?.fontSize || '0'),
  };
}"""


def join(browser, base_url: str, pid: str, viewport: dict):
    ctx = browser.new_context(
        viewport=viewport, device_scale_factor=2, locale="zh-CN"
    )
    page = ctx.new_page()
    page.add_init_script(AUDIO_COUNTER)
    page.goto(base_url, wait_until="networkidle")
    page.wait_for_timeout(400)
    ios_links = page.locator("[data-ios-download]")
    assert ios_links.count() >= 1, "iOS 安装包下载入口缺失"
    hrefs = [ios_links.nth(i).get_attribute("href") or "" for i in range(ios_links.count())]
    assert all("/static/downloads/Doudizhu-unsigned.ipa" in h for h in hrefs), (
        f"iOS 下载链接没有全部走局域网正式服: {hrefs}"
    )
    resp = page.request.head(urljoin(base_url, hrefs[0]))
    assert resp.ok, f"局域网 iOS 安装包下载失败: HTTP {resp.status}"
    assert int(resp.headers.get("content-length", "0")) > 1_000_000, (
        "局域网 iOS 安装包不是完整 IPA"
    )
    page.fill("#player-id", pid)
    page.click("#login-btn")
    page.wait_for_selector("#customize:not(.hidden)", timeout=15000)
    page.click("#enter-table")
    page.wait_for_timeout(1200)
    return ctx, page


def check_size(page, label: str, min_card: int, min_btn_h: int, min_hint: float,
               min_hand_top: int, allow_mobile: bool = False) -> dict:
    m = page.evaluate(PROBE)
    print(label, json.dumps(m, ensure_ascii=False))
    assert m["card"], f"{label}: 没有手牌"
    assert m["card"][0] >= min_card, f"{label}: 手牌太窄 {m['card'][0]}"
    assert m["bidBtn"], f"{label}: 没有叫地主按钮"
    assert m["bidBtn"][1] >= min_btn_h, f"{label}: 按钮太矮 {m['bidBtn'][1]}"
    assert m["hintFont"] >= min_hint, f"{label}: 提示字号太小 {m['hintFont']}"
    assert m["handTop"][1] >= min_hand_top, f"{label}: 信息条太矮 {m['handTop'][1]}"
    assert m["scrollW"] <= m["vw"] + 1, f"{label}: 横向溢出 {m['scrollW']}>{m['vw']}"
    if not allow_mobile:
        assert m["avatar"][0] >= 110, f"{label}: 头像圆框太小 {m['avatar'][0]}"
        assert m["ram"][0] >= 90, f"{label}: 拉姆太小 {m['ram'][0]}"
        assert m["seatAvatar"][0] >= 62, f"{label}: 其他两家头像太小 {m['seatAvatar'][0]}"
        assert m["bottomCard"][0] >= 38, f"{label}: 底牌太小 {m['bottomCard'][0]}"
        if m.get("bottomBox") and m.get("boardBox"):
            assert m["bottomBox"][3] <= m["boardBox"][1] + 1, (
                f"{label}: 底牌被牌桌遮住 {m['bottomBox']} vs {m['boardBox']}"
            )
        assert m["statusFont"] >= 15, f"{label}: 状态条字号太小 {m['statusFont']}"
    else:
        assert m["avatar"][0] >= 88, f"{label}: 头像圆框太小 {m['avatar'][0]}"
        assert m["ram"][0] >= 64, f"{label}: 拉姆太小 {m['ram'][0]}"
        assert m["seatAvatar"][0] >= 66, f"{label}: 其他两家头像太小 {m['seatAvatar'][0]}"
        assert m["bottomCard"][0] >= 48, f"{label}: 底牌太小 {m['bottomCard'][0]}"
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8001/")
    ap.add_argument("--player", default="UI回归")
    ap.add_argument("--shots", action="store_true")
    args = ap.parse_args()
    base_url = args.url.rstrip("/") + "/"
    sys.stdout.reconfigure(encoding="utf-8")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)
        ctx, page = join(browser, base_url, args.player, {"width": 1180, "height": 688})
        try:
            page.wait_for_selector('[data-ready]', timeout=8000)
        except Exception:
            raise SystemExit("这张桌子不是候场状态；请用干净实例或临时端口跑 UI 回归")
        page.click("[data-ready]")
        page.wait_for_selector('#bidding:not(.hidden) [data-call="1"]', timeout=25000)
        page.wait_for_timeout(1200)

        check_size(page, "1180x688", 56, 38, 12.5, 70)
        if args.shots:
            page.screenshot(path=str(SHOTS / "ui-regression-1180.png"))

        # 15 秒提醒 + 声音
        before = page.evaluate("window.__osc || 0")
        page.wait_for_timeout(15500)
        after = page.evaluate("window.__osc || 0")
        state = page.evaluate("""() => ({
          glow: parseFloat(getComputedStyle(document.querySelector('#turn-glow')).opacity || '0'),
          alert: document.body.classList.contains('turn-alert'),
          title: document.title,
          old: document.querySelectorAll('#turn-remind, #turn-remind-close, .turn-remind').length,
        })""")
        print("reminder", json.dumps(state, ensure_ascii=False), "audio", before, after)
        assert state["alert"], "15 秒提醒没有触发边缘变色"
        assert state["glow"] >= 0.8, f"边缘光晕没有显示 (opacity={state['glow']})"
        assert state["old"] == 0, "旧的提醒条/按钮没有被移除"
        assert "轮到你了" in state["title"], "15 秒提醒没有改标题"
        assert after - before >= 3, f"15 秒提醒没有发声 ({after - before})"
        if args.shots:
            page.screenshot(path=str(SHOTS / "ui-regression-remind.png"))

        # 1133×612（另一台 iPad 横屏）
        page.set_viewport_size({"width": 1133, "height": 612})
        page.wait_for_timeout(900)
        check_size(page, "1133x612", 56, 36, 12.5, 70)
        if args.shots:
            page.screenshot(path=str(SHOTS / "ui-regression-1133.png"))

        # 390×844（手机竖屏）
        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(900)
        check_size(page, "390x844", 46, 40, 12, 68, allow_mobile=True)
        if args.shots:
            page.screenshot(path=str(SHOTS / "ui-regression-390.png"))

        ctx.close()
        browser.close()
    print("UI regression OK")


if __name__ == "__main__":
    main()
