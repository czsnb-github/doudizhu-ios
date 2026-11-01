"""Build the offline (Pyodide) web bundle.

Output: client/www
- static/  (the same UI files)
- pyodide/ (runtime)
- packages/numpy...whl
- app-core.zip (app package + local_bridge.py + local_ai.py)
- index.html (same UI, boot.js instead of app.js)
- web-version.json (baseline used by the iOS OTA updater)

The browser and iOS builds share this one bundle. `client/web_version.json`
is the single source of truth for the web/engine/UI version; boot.js and the
index.html script query are rewritten from it so they cannot drift.
"""
from __future__ import annotations

import json
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WWW = ROOT / "client" / "www"
VERSION_FILE = ROOT / "client" / "web_version.json"
WEBASSETS = ROOT / "ios" / "Doudizhu" / "WebAssets"


def read_version() -> dict:
    data = json.loads(VERSION_FILE.read_text(encoding="utf-8"))
    version = str(data.get("version") or "").strip()
    min_shell = str(data.get("min_shell") or "0.5.0").strip()
    if not re.fullmatch(r"[0-9A-Za-z._-]{1,32}", version):
        raise SystemExit("client/web_version.json 的 version 不合法")
    if not re.fullmatch(r"[0-9]+(\.[0-9]+){1,2}", min_shell):
        raise SystemExit("client/web_version.json 的 min_shell 不合法")
    return {"version": version, "min_shell": min_shell}


def build_www(dest: Path = WWW, *, version: str | None = None) -> dict:
    meta = read_version()
    if version:
        meta["version"] = version
    shutil.rmtree(dest, ignore_errors=True)
    (dest / "static").parent.mkdir(parents=True, exist_ok=True)

    shutil.copytree(
        ROOT / "static",
        dest / "static",
        ignore=shutil.ignore_patterns("downloads", "__pycache__", "ota"),
    )
    boot = (ROOT / "client" / "boot.js").read_text(encoding="utf-8")
    boot, count = re.subn(
        r"const VERSION = '[^']*';",
        f"const VERSION = '{meta['version']}';",
        boot,
        count=1,
    )
    if count != 1:
        raise SystemExit("client/boot.js 里找不到 VERSION")
    (dest / "static" / "boot.js").write_text(boot, encoding="utf-8")

    pyodide_src = ROOT / "client" / "node_modules" / "pyodide"
    if not pyodide_src.exists():
        raise SystemExit(
            "缺少 Pyodide 运行时；先在 client 目录执行 npm install"
        )
    shutil.copytree(
        pyodide_src,
        dest / "pyodide",
        ignore=shutil.ignore_patterns("*.map"),
    )
    (dest / "packages").mkdir()
    for wheel in (ROOT / "client" / "packages").glob("*.whl"):
        shutil.copy2(wheel, dest / "packages" / wheel.name)

    index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    index, count = re.subn(
        r'<script src="/static/app\.js\?v=[^"]+"></script>',
        f'<script src="/static/boot.js?v={meta["version"]}"></script>',
        index,
    )
    if count != 1:
        raise SystemExit("找不到 app.js 脚本标签")
    (dest / "index.html").write_text(index, encoding="utf-8")

    with zipfile.ZipFile(dest / "app-core.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted((ROOT / "app").rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            z.write(path, path.relative_to(ROOT).as_posix())
        for path in sorted((ROOT / "vendor" / "douzero" / "env").glob("*.py")):
            z.write(path, ("vendor/douzero/env/" + path.name))
        z.write(ROOT / "vendor" / "douzero" / "__init__.py", "vendor/douzero/__init__.py")
        z.write(ROOT / "client" / "local_bridge.py", "local_bridge.py")
        z.write(ROOT / "client" / "local_ai.py", "local_ai.py")

    with zipfile.ZipFile(dest / "models.zip", "w", zipfile.ZIP_STORED) as z:
        for path in sorted((ROOT / "client" / "models").rglob("*.npz")):
            z.write(path, path.relative_to(ROOT / "client" / "models").as_posix())

    (dest / "web-version.json").write_text(
        json.dumps(
            {
                "version": meta["version"],
                "min_shell": meta["min_shell"],
                "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    return meta


def sync_webassets(source: Path = WWW, dest: Path = WEBASSETS) -> None:
    """把共享 bundle 原样放进 iOS 工程；不要在两边分别改文件。"""
    if not (source / "index.html").exists():
        raise SystemExit("还没有构建 client/www")
    marker = dest.with_name(dest.name + ".old")
    shutil.rmtree(marker, ignore_errors=True)
    if dest.exists():
        dest.rename(marker)
    shutil.copytree(source, dest)
    shutil.rmtree(marker, ignore_errors=True)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ios", action="store_true", help="同时同步到 ios/Doudizhu/WebAssets")
    parser.add_argument("--version", help="覆盖 web 版本号（默认读 client/web_version.json）")
    args = parser.parse_args()
    meta = build_www(version=args.version)
    if args.ios:
        sync_webassets()
        print("synced", WEBASSETS)
    print("built", WWW, meta["version"])
    for p in ("index.html", "app-core.zip", "static/boot.js", "web-version.json"):
        print(" ", p, (WWW / p).stat().st_size)


if __name__ == "__main__":
    main()
