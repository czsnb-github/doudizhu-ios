"""Build the offline (Pyodide) web bundle.

Output: client/www
- static/  (the same UI files)
- pyodide/ (runtime)
- packages/numpy...whl
- app-core.zip (app package + local_bridge.py)
- index.html (same UI, boot.js instead of app.js)
"""
from __future__ import annotations

import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WWW = ROOT / "client" / "www"
VERSION = "20261101c"


def main() -> None:
    shutil.rmtree(WWW, ignore_errors=True)
    (WWW / "static").parent.mkdir(parents=True, exist_ok=True)

    shutil.copytree(ROOT / "static", WWW / "static",
                    ignore=shutil.ignore_patterns("downloads", "__pycache__"))
    shutil.copy2(ROOT / "client" / "boot.js", WWW / "static" / "boot.js")

    shutil.copytree(ROOT / "client" / "node_modules" / "pyodide", WWW / "pyodide",
                    ignore=shutil.ignore_patterns("*.map"))
    (WWW / "packages").mkdir()
    for wheel in (ROOT / "client" / "packages").glob("*.whl"):
        shutil.copy2(wheel, WWW / "packages" / wheel.name)

    index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    index, count = re.subn(
        r'<script src="/static/app\.js\?v=[^"]+"></script>',
        f'<script src="/static/boot.js?v={VERSION}"></script>',
        index,
    )
    if count != 1:
        raise SystemExit("找不到 app.js 脚本标签")
    (WWW / "index.html").write_text(index, encoding="utf-8")

    with zipfile.ZipFile(WWW / "app-core.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted((ROOT / "app").rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            z.write(path, path.relative_to(ROOT).as_posix())
        for path in sorted((ROOT / "vendor" / "douzero" / "env").glob("*.py")):
            z.write(path, ("vendor/douzero/env/" + path.name))
        z.write(ROOT / "vendor" / "douzero" / "__init__.py", "vendor/douzero/__init__.py")
        z.write(ROOT / "client" / "local_bridge.py", "local_bridge.py")
        z.write(ROOT / "client" / "local_ai.py", "local_ai.py")

    with zipfile.ZipFile(WWW / "models.zip", "w", zipfile.ZIP_STORED) as z:
        for path in sorted((ROOT / "client" / "models").rglob("*.npz")):
            z.write(path, path.relative_to(ROOT / "client" / "models").as_posix())

    print("built", WWW)
    for p in ("index.html", "app-core.zip", "static/boot.js"):
        print(" ", p, (WWW / p).stat().st_size)


if __name__ == "__main__":
    main()
