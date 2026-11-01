"""把 DouZero 的三个位置模型导出成 ONNX，并做数值一致性校验。

用途：给 iOS / 移动端推理做模型准备。导出的 ONNX 可以直接用
onnxruntime-mobile 或 Core ML 转换工具加载，不依赖 PyTorch。

用法：
    python tools/export_onnx.py
    python tools/export_onnx.py --out models_onnx --bench 200
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT / "vendor") not in sys.path:
    sys.path.insert(0, str(ROOT / "vendor"))

from douzero.dmc.models import FarmerLstmModel, LandlordLstmModel  # noqa: E402

MODEL_SETS = ("sl", "douzero_ADP", "douzero_WP")
POSITIONS = ("landlord", "landlord_up", "landlord_down")
X_DIM = {"landlord": 373, "landlord_up": 484, "landlord_down": 484}


class ValuesOnly(torch.nn.Module):
    """只导出 values，动作选择交给上层（与 agent.py 的用法一致）。"""

    def __init__(self, model: torch.nn.Module):
        super().__init__()
        self.model = model

    def forward(self, z: torch.Tensor, x: torch.Tensor) -> torch.Tensor:
        return self.model(z, x, return_value=True)["values"]


def build(model_name: str, position: str) -> torch.nn.Module:
    cls = LandlordLstmModel if position == "landlord" else FarmerLstmModel
    model = cls()
    state = torch.load(
        ROOT / "models" / model_name / f"{position}.ckpt",
        map_location="cpu",
        weights_only=True,
    )
    model.load_state_dict(state)
    model.eval()
    return model


def export_one(model_name: str, position: str, out_dir: Path) -> Path:
    model = ValuesOnly(build(model_name, position)).eval()
    x_dim = X_DIM[position]
    z = torch.zeros(1, 5, 162, dtype=torch.float32)
    x = torch.zeros(1, x_dim, dtype=torch.float32)
    path = out_dir / model_name / f"{position}.onnx"
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        (z, x),
        str(path),
        input_names=["z", "x"],
        output_names=["values"],
        dynamic_axes={"z": {0: "batch"}, "x": {0: "batch"}, "values": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    return path


def verify(model_name: str, position: str, path: Path, batch: int = 9) -> float:
    import onnxruntime as ort

    model = ValuesOnly(build(model_name, position)).eval()
    x_dim = X_DIM[position]
    rng = np.random.default_rng(7)
    z = rng.random((batch, 5, 162), dtype=np.float32)
    x = rng.random((batch, x_dim), dtype=np.float32)
    with torch.inference_mode():
        ref = model(torch.from_numpy(z), torch.from_numpy(x)).numpy()
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    got = sess.run(["values"], {"z": z, "x": x})[0]
    diff = float(np.max(np.abs(ref - got)))
    # 网络输出本身可能到 1e4 量级，用相对误差判断（绝对误差 0.004/14432 ≈ 2.7e-7）
    rel = diff / max(1.0, float(np.max(np.abs(ref))))
    assert rel < 1e-5, f"{model_name}/{position} 数值不一致: abs={diff} rel={rel}"
    assert np.array_equal(ref.argmax(0), got.argmax(0)), (
        f"{model_name}/{position} 选牌不一致: {ref.argmax(0)} vs {got.argmax(0)}"
    )
    return rel


def bench(path: Path, x_dim: int, batch: int, rounds: int) -> float:
    import onnxruntime as ort

    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(1)
    z = rng.random((batch, 5, 162), dtype=np.float32)
    x = rng.random((batch, x_dim), dtype=np.float32)
    for _ in range(5):
        sess.run(["values"], {"z": z, "x": x})
    t0 = time.perf_counter()
    for _ in range(rounds):
        sess.run(["values"], {"z": z, "x": x})
    return (time.perf_counter() - t0) / rounds * 1000


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="models_onnx")
    ap.add_argument("--bench", type=int, default=100, help="基准轮数，0 表示跳过")
    args = ap.parse_args()
    out_dir = ROOT / args.out

    print(f"导出目录: {out_dir}")
    total = 0.0
    for model_name in MODEL_SETS:
        for position in POSITIONS:
            path = export_one(model_name, position, out_dir)
            size = path.stat().st_size / 1024 / 1024
            total += size
            diff = verify(model_name, position, path)
            line = f"{model_name:12s} {position:12s} {size:5.2f} MB  一致性 rel={diff:.2e}"
            if args.bench:
                ms = bench(path, X_DIM[position], 50, args.bench)
                line += f"  {ms:.2f} ms/局面(50 个候选动作, CPU)"
            print(line)
    print(f"合计 {total:.1f} MB（9 个模型）")


if __name__ == "__main__":
    main()
