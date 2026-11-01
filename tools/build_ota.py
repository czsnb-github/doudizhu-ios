"""Publish the shared web/engine/AI bundle for on-device OTA updates.

The iOS shell owns only the native code (MCS, OTA/sync bridges, permissions).
Everything a release can change lives in this bundle: index.html, static UI,
static/boot.js, Pyodide/NumPy runtime, app-core.zip (Python engine + bridge)
and models.zip (DouZero weights).

Layout under `static/ota/ios`:
  manifest.json                  tiny pointer read by the app
  files/<sha256>/<relative>      content-addressed files (deduplicated)
  manifest-<version>.json        kept for auditing / rollback

Serve it with the existing production static mount:
  http://<lan-ip>:8000/static/ota/ios/manifest.json

Usage:
  python tools/build_ota.py                 # build client/www then publish
  python tools/build_ota.py --no-build      # publish the current client/www
  python tools/build_ota.py --min-shell 0.5.0
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, unquote

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
DEFAULT_WWW = ROOT / "client" / "www"
DEFAULT_OUT = ROOT / "static" / "ota" / "ios"

# 0.5.1 起，启动层和 Pyodide/NumPy 运行时也走 OTA；原生壳仍只能重装。
# 保持安装包里的完整副本作为回落，清单里缺的文件由 LocalWebServer 回落到 bundle。
REQUIRED = {"index.html", "app-core.zip", "static/boot.js"}
TEXT_SUFFIXES = {".html", ".htm", ".css", ".js", ".mjs", ".json", ".svg", ".txt"}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def iter_bundle(www: Path):
    for path in sorted(www.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        rel = path.relative_to(www).as_posix()
        if "__pycache__" in path.parts or rel.startswith("."):
            continue
        yield rel, path


def normalize_bytes(path: Path) -> bytes:
    """仓库文本按 LF 存储；Windows 工作区是 CRLF，发布时统一回 LF。

    iOS 安装包由 macOS CI 用 LF 文件构建；如果 OTA 用 CRLF 计算哈希，未变化的
    文件也会被判成新文件。这里归一化后，清单和安装包逐字节一致。
    """
    data = path.read_bytes()
    if path.suffix.lower() in TEXT_SUFFIXES:
        data = data.replace(b"\r\n", b"\n")
    return data


def safe_rel(rel: str) -> str:
    if rel.startswith("/") or ".." in Path(rel).parts or "\\" in rel:
        raise ValueError(f"unsafe path: {rel}")
    if not re.fullmatch(r"[0-9A-Za-z._\-/]+", rel, flags=re.ASCII):
        raise ValueError(f"unsupported path characters: {rel}")
    return rel


def build_manifest(www: Path, out: Path, *, min_shell: str) -> dict:
    version_file = www / "web-version.json"
    if not version_file.exists():
        raise SystemExit(f"缺少 {version_file}；先运行 tools/build_offline_www.py")
    version_meta = json.loads(version_file.read_text(encoding="utf-8"))
    version = str(version_meta.get("version") or "").strip()
    if not re.fullmatch(r"[0-9A-Za-z._-]{1,32}", version):
        raise SystemExit("web-version.json 的 version 不合法")
    min_shell = str(min_shell or version_meta.get("min_shell") or "0.5.0")
    if not re.fullmatch(r"[0-9]+(\.[0-9]+){1,2}", min_shell):
        raise SystemExit("min-shell 不合法")

    files_dir = out / "files"
    files_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    total = 0
    seen = set()
    for rel, path in iter_bundle(www):
        rel = safe_rel(rel)
        data = normalize_bytes(path)
        digest = hashlib.sha256(data).hexdigest()
        size = len(data)
        target = files_dir / digest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.read_bytes() != data:
            target.write_bytes(data)
        rows.append(
            {
                "path": rel,
                "sha256": digest,
                "size": size,
                "url": f"files/{digest}/{quote(rel)}",
            }
        )
        total += size
        seen.add(rel)
    missing = REQUIRED - seen
    if missing:
        raise SystemExit(f"bundle 缺少必需文件: {', '.join(sorted(missing))}")
    if not any(row["path"] == "web-version.json" for row in rows):
        raise SystemExit("bundle 缺少 web-version.json")

    manifest = {
        "schema": 1,
        "version": version,
        "minShell": min_shell,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "totalSize": total,
        "files": rows,
    }
    text = json.dumps(manifest, ensure_ascii=False, indent=1, sort_keys=False) + "\n"
    (out / "manifest.json").write_text(text, encoding="utf-8")
    (out / f"manifest-{version}.json").write_text(text, encoding="utf-8")
    verify_manifest(out, manifest)
    return manifest


def verify_manifest(out: Path, manifest: dict) -> None:
    """Check a published manifest and all referenced files; safe to run on the live server."""
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise SystemExit("manifest 没有 files")
    for row in files:
        if not isinstance(row, dict):
            raise SystemExit("manifest 文件项格式错误")
        path = str(row.get("path") or "")
        url = str(row.get("url") or "")
        sha = str(row.get("sha256") or "")
        size = int(row.get("size") or -1)
        safe_rel(path)
        if not sha or len(sha) != 64:
            raise SystemExit(f"manifest 校验值不合法: {path}")
        if "://" in url or url.startswith("/") or ".." in url:
            raise SystemExit(f"manifest 下载地址不合法: {url}")
        target = (out / unquote(url)).resolve()
        root = out.resolve()
        if not str(target).startswith(str(root) + os.sep):
            raise SystemExit(f"manifest 下载地址越界: {url}")
        if not target.is_file():
            raise SystemExit(f"OTA 文件缺失: {url}")
        if target.stat().st_size != size:
            raise SystemExit(f"OTA 文件大小不一致: {path}")
        if sha256_file(target) != sha:
            raise SystemExit(f"OTA 文件校验失败: {path}")


def prune_old_versions(out: Path, keep: str, *, keep_count: int = 2) -> None:
    """Keep the current manifest history and the newest few versioned manifests."""
    versions = sorted(out.glob("manifest-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in versions[keep_count:]:
        if path.name == f"manifest-{keep}.json":
            continue
        path.unlink(missing_ok=True)
    # Content-addressed files are tiny in count and shared between versions; removing
    # them safely needs reference counting, so leave them for the operator to prune.


def main() -> None:
    from tools.build_offline_www import build_www

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--www", type=Path, default=DEFAULT_WWW)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--no-build", action="store_true")
    parser.add_argument("--min-shell", default="0.5.0")
    args = parser.parse_args()

    www = args.www.resolve()
    out = args.out.resolve()
    if not args.no_build:
        build_www(www)
    manifest = build_manifest(www, out, min_shell=args.min_shell)
    prune_old_versions(out, manifest["version"])
    print(f"OTA {manifest['version']} -> {out}")
    print(f"  minShell={manifest['minShell']} files={len(manifest['files'])} total={manifest['totalSize']} bytes")
    print(f"  manifest: {out / 'manifest.json'}")
    preview = manifest["files"][:3] if len(manifest["files"]) > 8 else manifest["files"]
    for row in preview:
        print(f"  {row['path']} {row['size']} {row['sha256'][:12]}…")


if __name__ == "__main__":
    main()
