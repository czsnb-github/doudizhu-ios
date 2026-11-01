"""发版前一键完整检查（本地 CI）。

1) 跑全部 unittest；
2) 起一个临时服务器（独立临时数据目录、真实 static/）；
3) 跑 Playwright UI/尺寸/15s 提醒回归；
4) 再起一个临时服务器，跑完整叫地主/抢地主对局。

用法：python tools/release_check.py [--skip-browser] [--shots]
不会碰 data/、dev-data/ 或 8000 上的真实牌桌。
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_server(port: int, timeout: float = 60) -> None:
    url = f"http://127.0.0.1:{port}/api/info"
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                data = json.load(resp)
            if (data.get("ai") or {}).get("available"):
                return
            last = "AI 仍在预热"
        except Exception as exc:
            last = type(exc).__name__
        time.sleep(0.5)
    raise RuntimeError(f"服务器没有在 {timeout}s 内就绪: {last}")


def start_server(tag: str):
    tmp = tempfile.TemporaryDirectory(prefix=f"ddz-{tag}-")
    port = free_port()
    log = Path(tmp.name) / "server.log"
    env = dict(
        **os.environ,
        DOUDIZHU_DATA_DIR=tmp.name,
        DOUDIZHU_STATIC_DIR=str(ROOT / "static"),
        PORT=str(port),
        PYTHONUNBUFFERED="1",
        PYTHONIOENCODING="utf-8",
    )
    fh = open(log, "w", encoding="utf-8")
    proc = subprocess.Popen(
        [PY, "main.py"], cwd=str(ROOT), env=env,
        stdout=fh, stderr=subprocess.STDOUT,
    )
    try:
        wait_server(port)
    except Exception:
        proc.terminate()
        time.sleep(1)
        print(log.read_text(encoding="utf-8", errors="replace")[-3000:])
        raise
    return tmp, proc, port, log, fh


def stop_server(proc, fh, tmp):
    try:
        proc.terminate()
        proc.wait(timeout=8)
    except Exception:
        proc.kill()
    try:
        fh.close()
    except Exception:
        pass
    tmp.cleanup()


def run_tool(args: list[str]) -> None:
    print("\n$", " ".join(args), flush=True)
    subprocess.run(args, cwd=str(ROOT), check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-browser", action="store_true")
    ap.add_argument("--shots", action="store_true")
    opts = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    print("== 1/3 unittest ==", flush=True)
    run_tool([PY, "-m", "unittest", "discover", "-s", "tests", "-t", "."])

    if opts.skip_browser:
        print("\nALL CHECKS PASSED (unit only)")
        return

    print("\n== 2/3 UI / 15s reminder (isolated server) ==", flush=True)
    tmp, proc, port, log, fh = start_server("ui")
    try:
        cmd = [PY, "tools/ui_regression_check.py", "--url", f"http://127.0.0.1:{port}/"]
        if opts.shots:
            cmd.append("--shots")
        run_tool(cmd)
    except subprocess.CalledProcessError:
        print("\n--- server log tail ---")
        print(log.read_text(encoding="utf-8", errors="replace")[-3000:])
        raise
    finally:
        stop_server(proc, fh, tmp)

    print("\n== 3/3 call/grab full round (isolated server) ==", flush=True)
    tmp, proc, port, log, fh = start_server("grab")
    try:
        run_tool([
            PY, "tools/call_grab_check.py",
            "--url", f"http://127.0.0.1:{port}/",
            "--player", "发版检查",
        ])
    except subprocess.CalledProcessError:
        print("\n--- server log tail ---")
        print(log.read_text(encoding="utf-8", errors="replace")[-3000:])
        raise
    finally:
        stop_server(proc, fh, tmp)

    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    main()
