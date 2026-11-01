import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from tools.build_ota import build_manifest, verify_manifest


class TestOtaBuild(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.www = self.root / "www"
        (self.www / "static").mkdir(parents=True)
        (self.www / "pyodide").mkdir()
        (self.www / "packages").mkdir()
        (self.www / "index.html").write_text("<!doctype html>ota", encoding="utf-8")
        (self.www / "app-core.zip").write_bytes(b"engine-zip")
        (self.www / "models.zip").write_bytes(b"weights")
        (self.www / "static" / "app.js").write_text("console.log(1)", encoding="utf-8")
        (self.www / "static" / "style.css").write_text("body{}", encoding="utf-8")
        (self.www / "static" / "boot.js").write_text("native-owned", encoding="utf-8")
        (self.www / "pyodide" / "pyodide.js").write_text("runtime", encoding="utf-8")
        (self.www / "packages" / "numpy.whl").write_bytes(b"wheel")
        (self.www / "web-version.json").write_text(
            json.dumps({"version": "20261102d", "min_shell": "0.5.0"}),
            encoding="utf-8",
        )
        self.out = self.root / "ota"

    def tearDown(self):
        self.tmp.cleanup()

    def test_manifest_excludes_native_runtime_and_verifies(self):
        manifest = build_manifest(self.www, self.out, min_shell="0.5.0")
        self.assertEqual(manifest["schema"], 1)
        self.assertEqual(manifest["version"], "20261102d")
        self.assertEqual(manifest["minShell"], "0.5.0")
        paths = {row["path"] for row in manifest["files"]}
        self.assertNotIn("static/boot.js", paths)
        self.assertNotIn("pyodide/pyodide.js", paths)
        self.assertNotIn("packages/numpy.whl", paths)
        self.assertIn("index.html", paths)
        self.assertIn("app-core.zip", paths)
        self.assertIn("models.zip", paths)
        self.assertIn("web-version.json", paths)
        for row in manifest["files"]:
            self.assertTrue((self.out / row["url"]).is_file())
        verify_manifest(self.out, manifest)

    def test_content_addressed_files_are_shared(self):
        first = build_manifest(self.www, self.out, min_shell="0.5.0")
        (self.www / "static" / "app.js").write_text("console.log(2)", encoding="utf-8")
        (self.www / "web-version.json").write_text(
            json.dumps({"version": "20261103a", "min_shell": "0.5.0"}),
            encoding="utf-8",
        )
        second = build_manifest(self.www, self.out, min_shell="0.5.0")
        app_rows = [row for row in second["files"] if row["path"] == "static/app.js"]
        self.assertEqual(len(app_rows), 1)
        old_app = next(row for row in first["files"] if row["path"] == "static/app.js")
        self.assertNotEqual(app_rows[0]["sha256"], old_app["sha256"])
        self.assertTrue((self.out / old_app["url"]).is_file())
        verify_manifest(self.out, second)

    def test_text_is_published_with_lf_line_endings(self):
        (self.www / "static" / "crlf.js").write_bytes(b"one\r\ntwo\r\n")
        manifest = build_manifest(self.www, self.out, min_shell="0.5.0")
        row = next(item for item in manifest["files"] if item["path"] == "static/crlf.js")
        self.assertEqual(row["sha256"], hashlib.sha256(b"one\ntwo\n").hexdigest())
        self.assertEqual((self.out / row["url"]).read_bytes(), b"one\ntwo\n")
        verify_manifest(self.out, manifest)

    def test_tampered_file_is_rejected(self):
        manifest = build_manifest(self.www, self.out, min_shell="0.5.0")
        row = next(item for item in manifest["files"] if item["path"] == "index.html")
        target = self.out / row["url"]
        target.write_text("tampered", encoding="utf-8")
        with self.assertRaises(SystemExit):
            verify_manifest(self.out, manifest)

    def test_unsafe_path_is_rejected(self):
        manifest = build_manifest(self.www, self.out, min_shell="0.5.0")
        manifest["files"][0]["path"] = "../escape.js"
        with self.assertRaises((SystemExit, ValueError)):
            verify_manifest(self.out, manifest)


if __name__ == "__main__":
    unittest.main()
