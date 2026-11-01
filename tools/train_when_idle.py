"""等牌桌空闲后自动跑一轮 CPU 低优先级微调。

训练结束后把候选权重装到 models/douzero_FT（隐藏评测档，不影响线上 UI）；
只有评测胜出才会暴露成正式难度。
默认要求 /api/clients 连续 60 秒为空才开跑；训练用 1 actor + 低优先级，
不占 GPU，尽量不影响牌桌。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
TRAINING = ROOT / "training"
STATUS = TRAINING / "idle_ft_status.json"


def clients(url: str) -> int | None:
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            data = json.load(resp)
        return int(data.get("count") or 0)
    except Exception:
        return None


def status(**kw):
    TRAINING.mkdir(parents=True, exist_ok=True)
    data = {"ts": time.strftime("%Y-%m-%d %H:%M:%S")}
    data.update(kw)
    STATUS.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--client-url", default="http://127.0.0.1:8000/api/clients")
    ap.add_argument("--poll", type=float, default=15.0)
    ap.add_argument("--quiet", type=float, default=60.0)
    ap.add_argument("--max-wait", type=float, default=3600.0)
    ap.add_argument("--frames", type=int, default=300_000)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    quiet_since = None
    wait_start = time.time()
    while True:
        n = clients(args.client_url)
        now = time.time()
        if n == 0:
            if quiet_since is None:
                quiet_since = now
                status(state="waiting", clients=0, note="牌桌空闲计时开始")
                print(f"[{time.strftime('%H:%M:%S')}] 空闲计时开始", flush=True)
            elif now - quiet_since >= args.quiet:
                break
        else:
            if quiet_since is not None:
                print(f"[{time.strftime('%H:%M:%S')}] 有人回来了，重新计时", flush=True)
            quiet_since = None
            status(state="waiting", clients=n, note="牌桌有人/不可达，等待")
        if now - wait_start > args.max_wait:
            status(state="gave_up", clients=n, note=f"{args.max_wait:.0f}s 内没等到连续空闲")
            print("等待超时，退出；没有启动训练", flush=True)
            return
        if args.dry_run:
            print(f"[{time.strftime('%H:%M:%S')}] dry-run clients={n} quiet_since={quiet_since}", flush=True)
            if now - wait_start > 5:
                status(state="dry_run", clients=n)
                return
        time.sleep(args.poll)

    xpid = f"ft-wp-{time.strftime('%Y%m%d-%H%M%S')}"
    log = TRAINING / f"{xpid}.log"
    TRAINING.mkdir(parents=True, exist_ok=True)
    cmd = [
        PY, "tools/finetune_play.py",
        "--frames", str(args.frames),
        "--lr", str(args.lr),
        "--actors", "1",
        "--threads", "1",
        "--batch-size", "8",
        "--unroll", "20",
        "--buffers", "32",
        "--device", "cpu",
        "--actor-cpu",
        "--low-priority",
        "--no-idle-check",
        "--install",
        "--save-interval", "2",
        "--xpid", xpid,
    ]
    print(f"[{time.strftime('%H:%M:%S')}] 牌桌已空闲，启动微调: {xpid}", flush=True)
    status(state="running", xpid=xpid, log=str(log), frames=args.frames)
    with open(log, "w", encoding="utf-8") as fh:
        proc = subprocess.Popen(
            cmd, cwd=str(ROOT), stdout=fh, stderr=subprocess.STDOUT,
        )
        status(state="running", xpid=xpid, log=str(log), frames=args.frames, pid=proc.pid)
        rc = proc.wait()
    status(state="finished" if rc == 0 else "failed", xpid=xpid, log=str(log), returncode=rc)
    print(f"[{time.strftime('%H:%M:%S')}] 训练结束 rc={rc}: {log}", flush=True)


if __name__ == "__main__":
    main()
