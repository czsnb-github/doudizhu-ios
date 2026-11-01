"""DouZero 出牌模型微调（DMC 自博弈，端到端，无规则层）。

从现有 douzero_WP 预训练权重继续训练；默认只在牌桌无人时启动。
产物写到 training/<xpid>/，验证通过后再安装到 models/douzero_FT/，
不会自动改动正在使用的模型。

先做 CPU 冒烟：
    python tools/finetune_play.py --smoke --no-install

正式微调（牌桌空闲时）：
    python tools/finetune_play.py --frames 500000 --lr 1e-5 --actors 4 --threads 2
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "vendor"))
sys.path.insert(0, str(ROOT))

MODELS = ROOT / "models"
TRAINING = ROOT / "training"
POSITIONS = ("landlord", "landlord_up", "landlord_down")
DEFAULT_URL = "http://127.0.0.1:8000/api/clients"


def live_clients(url: str) -> int | None:
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            data = json.load(resp)
        return int(data.get("count") or 0)
    except Exception:
        return None


def prepare_start_checkpoint(flags, source: str) -> Path:
    """把推理用的 ckpt 转成 DMC 可恢复的 model.tar（优化器是全新的）。"""
    import torch
    from douzero.dmc.models import Model
    from douzero.dmc.utils import create_optimizers

    out = Path(flags.savedir) / flags.xpid / "model.tar"
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        return out
    learner = Model(device="cpu")
    for pos in POSITIONS:
        path = MODELS / source / f"{pos}.ckpt"
        if not path.exists():
            raise FileNotFoundError(path)
        state = torch.load(path, map_location="cpu", weights_only=True)
        learner.get_model(pos).load_state_dict(state)
    optimizers = create_optimizers(flags, learner)
    torch.save({
        "model_state_dict": {
            pos: learner.get_model(pos).state_dict() for pos in POSITIONS
        },
        "optimizer_state_dict": {
            pos: optimizers[pos].state_dict() for pos in POSITIONS
        },
        "stats": {},
        "flags": vars(flags),
        "frames": 0,
        "position_frames": {pos: 0 for pos in POSITIONS},
    }, out)
    print(f"起始权重已写入 {out} (source={source})", flush=True)
    return out


def install_weights(xpid_dir: Path, dest_name: str = "douzero_FT") -> Path:
    import torch

    tar = xpid_dir / "model.tar"
    if not tar.exists():
        raise FileNotFoundError(tar)
    data = torch.load(tar, map_location="cpu", weights_only=False)
    dest = MODELS / dest_name
    dest.mkdir(parents=True, exist_ok=True)
    for pos in POSITIONS:
        torch.save(data["model_state_dict"][pos], dest / f"{pos}.ckpt")
    print(f"已安装微调权重到 {dest} (frames={data.get('frames')})", flush=True)
    return dest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="douzero_WP")
    ap.add_argument("--xpid", default="")
    ap.add_argument("--savedir", default=str(TRAINING))
    ap.add_argument("--frames", type=int, default=500_000)
    ap.add_argument("--lr", type=float, default=1e-5)
    ap.add_argument("--eps", type=float, default=0.01)
    ap.add_argument("--actors", type=int, default=4)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--batch-size", type=int, default=32)
    ap.add_argument("--unroll", type=int, default=100)
    ap.add_argument("--buffers", type=int, default=50)
    ap.add_argument("--device", default="0")
    ap.add_argument("--actor-cpu", action="store_true")
    ap.add_argument("--save-interval", type=float, default=5.0)
    ap.add_argument("--check-idle", action="store_true", default=True)
    ap.add_argument("--no-idle-check", dest="check_idle", action="store_false")
    ap.add_argument("--install", action="store_true", default=True)
    ap.add_argument("--no-install", dest="install", action="store_false")
    ap.add_argument("--client-url", default=DEFAULT_URL)
    ap.add_argument("--smoke", action="store_true")
    args = ap.parse_args()

    if args.low_priority and sys.platform == 'win32':
        import ctypes
        # BELOW_NORMAL_PRIORITY_CLASS：训练不跟牌桌抢 CPU
        ctypes.windll.kernel32.SetPriorityClass(
            ctypes.windll.kernel32.GetCurrentProcess(), 0x00004000
        )

    if args.smoke:
        args.frames = 5_000
        args.actors = 1
        args.threads = 1
        args.batch_size = 8
        args.unroll = 20
        args.buffers = 32
        args.save_interval = 0.2
        args.device = "cpu"
        args.actor_cpu = True
        args.install = False
        args.xpid = args.xpid or f"smoke-{time.strftime('%Y%m%d-%H%M%S')}"

    if args.check_idle and not args.smoke:
        n = live_clients(args.client_url)
        if n is None:
            raise SystemExit(
                "查不到线上客户端数量；确认牌桌没人后加 --no-idle-check 再跑"
            )
        if n > 0:
            raise SystemExit(
                f"线上有 {n} 个客户端，先别训练；等人走了再跑，避免影响前台"
            )

    from douzero.dmc.arguments import parser
    from douzero.dmc import dmc

    flags = parser.parse_args([])
    flags.source = args.source
    flags.xpid = args.xpid or f"ft-{args.source}-{time.strftime('%Y%m%d-%H%M%S')}"
    flags.savedir = args.savedir
    flags.total_frames = args.frames
    flags.learning_rate = args.lr
    flags.exp_epsilon = args.eps
    flags.num_actors = args.actors
    flags.num_threads = args.threads
    flags.batch_size = args.batch_size
    flags.unroll_length = args.unroll
    flags.num_buffers = args.buffers
    flags.save_interval = args.save_interval
    flags.load_model = True
    flags.objective = "wp"
    flags.training_device = args.device
    flags.actor_device_cpu = args.actor_cpu
    flags.num_actor_devices = 1
    flags.gpu_devices = "0" if args.device != "cpu" else ""
    flags.disable_checkpoint = False

    prepare_start_checkpoint(flags, args.source)
    print(
        f"开始微调: xpid={flags.xpid} frames={flags.total_frames} "
        f"device={flags.training_device} actor_cpu={flags.actor_device_cpu}",
        flush=True,
    )
    dmc.train(flags)
    xpid_dir = Path(flags.savedir) / flags.xpid
    if args.install:
        install_weights(xpid_dir)
    else:
        print(f"训练结束: {xpid_dir}", flush=True)


if __name__ == "__main__":
    main()
