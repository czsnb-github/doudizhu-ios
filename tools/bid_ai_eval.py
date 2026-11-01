"""叫地主策略离线对比：轻量规则 vs DouZero-WP 价值叫地主。

固定同一批牌局，让测试座位分别使用不同叫地主策略，其余两家都用
轻量规则叫；抢地主环节本工具统一放弃（只比较“叫/不叫”）。出牌全部
由 DouZero-WP 完成。比较测试座位的平均得分、胜率、当地主率和重发率。
"""
from __future__ import annotations

import argparse
import random
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.ai.agent import ai
from app.ai.bidding_ai import ValueBidder, choose_call
from app.cards import new_deck
from app.game.engine import Game, GameError

LEVEL = "hard"


def play_out(g: Game):
    steps = 0
    while g.phase == "playing":
        seat = g.current
        try:
            action = ai.choose(g, seat, LEVEL)
        except Exception:
            action = []
        try:
            g.play(seat, action)
        except GameError:
            try:
                g.pass_turn(seat)
            except GameError:
                g.play(seat, [g.hands[seat][0]])
        steps += 1
        if steps > 400:
            raise RuntimeError("牌局没有结束")
    return g


def run_one(seed: int, policy: str, tau, samples: int, tested_seat: int = 0):
    deck = new_deck()
    random.Random(seed).shuffle(deck)
    first = seed % 3
    g = Game(deck=deck, first_caller=first)

    opp_rng = random.Random(seed * 1000 + 17)
    rule_rng = random.Random(seed * 1000 + 23)
    vbid = (
        ValueBidder(threshold=tau, samples=samples, seed=seed * 1000 + 29)
        if policy == "value" else None
    )

    while g.phase == "bidding" and not g.grab_active:
        seat = g.call_turn
        is_last = all(g.calls[s] is False for s in range(3) if s != seat)
        if seat == tested_seat:
            if policy == "value":
                want = vbid.should_call(g.hands[seat], seat)
            else:
                want = choose_call(g.hands[seat], "normal", is_last, rule_rng)
        else:
            want = choose_call(g.hands[seat], "normal", is_last, opp_rng)
        g.call(seat, want)
        if want:
            break
    tested_call = g.calls[tested_seat]
    if g.phase == "redeal":
        return {
            "seed": seed, "redeal": True, "delta": 0, "win": False,
            "landlord": False, "tested_call": tested_call,
            "caller": None, "multiplier": 1, "role": "none",
        }

    # 只比较叫地主：抢地主全部放弃
    while g.grab_active:
        g.grab(g.grab_turn, False)

    g = play_out(g)
    res = g.result or {}
    deltas = res.get("deltas") or [0, 0, 0]
    delta = deltas[tested_seat]
    return {
        "seed": seed, "redeal": False, "delta": delta, "win": delta > 0,
        "landlord": res.get("landlord") == tested_seat,
        "tested_call": tested_call,
        "caller": res.get("caller"),
        "multiplier": res.get("multiplier") or g.multiplier,
        "role": "landlord" if res.get("landlord") == tested_seat else "farmer",
    }


def summarize(name, rows, elapsed):
    n = len(rows)
    deltas = [r["delta"] for r in rows]
    redeal = sum(1 for r in rows if r["redeal"]) / n
    win = sum(1 for r in rows if r["win"]) / n
    landlord = sum(1 for r in rows if r["landlord"]) / n
    calls = [bool(r["tested_call"]) for r in rows if r["tested_call"] is not None]
    call_rate = sum(calls) / len(calls) if calls else 0
    avg_mult = statistics.mean(r["multiplier"] for r in rows if not r["redeal"]) if any(not r["redeal"] for r in rows) else 0
    print(
        f"{name:12s} n={n:4d} avg_delta={statistics.mean(deltas):+7.1f} "
        f"win={win:5.1%} landlord={landlord:5.1%} redeal={redeal:5.1%} "
        f"call={call_rate:5.1%} avg_mult={avg_mult:4.2f} {elapsed:5.1f}s"
    )
    return {
        "name": name, "n": n, "avg_delta": statistics.mean(deltas),
        "win": win, "landlord": landlord, "redeal": redeal,
        "avg_mult": avg_mult, "call_rate": call_rate,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=400)
    ap.add_argument("--samples", type=int, default=6)
    ap.add_argument("--seat", type=int, default=0)
    ap.add_argument("--seed-base", type=int, default=0)
    args = ap.parse_args()

    ai.warmup()
    base = args.seed_base
    configs = [
        ("rule", None),
        ("value--0.05", -0.05),
        ("value-0.00", 0.00),
        ("value-0.05", 0.05),
    ]
    results = []
    all_rows = {}
    for name, tau in configs:
        t0 = time.time()
        rows = []
        for seed in range(base, base + args.games):
            try:
                rows.append(run_one(
                    seed, "value" if tau is not None else "rule",
                    tau, args.samples, args.seat,
                ))
            except Exception as exc:
                print("skip seed", seed, type(exc).__name__, exc)
        all_rows[name] = {r["seed"]: r for r in rows}
        results.append(summarize(name, rows, time.time() - t0))

    base_rows = all_rows.get("rule")
    if base_rows:
        print("\npaired vs rule (same seed):")
        for name, rows in all_rows.items():
            if name == "rule":
                continue
            diffs = [rows[s]["delta"] - base_rows[s]["delta"] for s in sorted(rows) if s in base_rows]
            n = len(diffs)
            if n < 2:
                continue
            mean = statistics.mean(diffs)
            sd = statistics.stdev(diffs)
            se = sd / (n ** 0.5)
            t = mean / se if se else 0.0
            print(f"  {name:12s} n={n:4d} mean_diff={mean:+7.1f} sd={sd:6.1f} se={se:5.1f} t={t:5.2f}")

    best = max(results, key=lambda r: r["avg_delta"])
    print("\nbest by avg_delta:", best["name"], round(best["avg_delta"], 1))


if __name__ == "__main__":
    main()
