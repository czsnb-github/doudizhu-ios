"""出牌档位对比：0 号位用 X 档，另两家用 Y 档，N 局后看 0 号位平均得分。"""
from __future__ import annotations

import argparse
import random
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.ai.agent import ai
from app.cards import new_deck
from app.game.engine import Game, GameError


def run_one(seed, seat0_level, others_level):
    deck = new_deck()
    random.Random(seed).shuffle(deck)
    # 只比出牌：固定 0 号位当地主，另两家放弃抢，避免叫地主策略干扰
    g = Game(deck=deck, first_caller=0)
    g.call(0, True)
    while g.grab_active:
        g.grab(g.grab_turn, False)
    steps = 0
    while g.phase == "playing":
        seat = g.current
        level = seat0_level if seat == 0 else others_level
        try:
            action = ai.choose(g, seat, level)
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
            raise RuntimeError("no end")
    res = g.result or {}
    delta = (res.get("deltas") or [0, 0, 0])[0]
    return {"delta": delta, "win": delta > 0, "redeal": False}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=800)
    args = ap.parse_args()
    ai.warmup()
    configs = [
        ("master-vs-hard", "master", "hard"),
        ("hard-vs-master", "hard", "master"),
        ("normal-vs-hard", "normal", "hard"),
        ("hard-vs-hard", "hard", "hard"),
    ]
    ft_dir = Path(__file__).resolve().parent.parent / "models" / "douzero_FT"
    if ft_dir.exists():
        configs += [
            ("ft-vs-hard", "ft", "hard"),
            ("hard-vs-ft", "hard", "ft"),
        ]
    for name, a, b in configs:
        t0 = time.time()
        rows = [run_one(s, a, b) for s in range(args.games)]
        deltas = [r["delta"] for r in rows]
        win = sum(1 for r in rows if r["win"]) / len(rows)
        sd = statistics.stdev(deltas)
        se = sd / len(deltas) ** 0.5
        print(f"{name:16s} n={len(rows)} avg={statistics.mean(deltas):+7.1f} "
              f"se={se:5.1f} win={win:5.1%} redeal={sum(1 for r in rows if r['redeal'])/len(rows):4.1%} {time.time()-t0:5.1f}s")


if __name__ == "__main__":
    main()
