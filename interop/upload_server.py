#!/usr/bin/env python3
"""hk-gateway 结果回传收件箱（一次性令牌，仅写不读）。部署于 /srv/inbox/upload_server.py。"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import os
import re
import urllib.parse

TOKEN = os.environ.get("HMTOKEN", "unset")
DST = "/srv/inbox"


class H(BaseHTTPRequestHandler):
    # 单次上传容量上限（512 MiB）。
    MAX_BYTES = 512 * 1024 * 1024
    # 允许写入的 filename 字符集（仅字母/数字/点/连字符/下划线，长度 1–255）。
    _NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,255}$")

    def do_POST(self):
        # 关键次序：必须先对整段 path 做 unquote，再 split+strip。否则：
        #   path = "/upload/<token>/..%2fetc%2fpasswd"
        #   parts = path.strip("/").split("/")          → parts[2] == "..%2fetc%2fpasswd"（字面，未解码）
        #   basename(unquote(parts[2]))                → "passwd"（绕过 `..` 拒绝，但仍落 DST 覆盖任意同名单文件）
        # 正确：unquote → split → 拒 parts[2] 含 `/` 或 `\` 残留 → basename → 白名单 → realpath。
        raw_path = urllib.parse.unquote(self.path)
        parts = raw_path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "upload" or parts[1] != TOKEN:
            self.send_error(403)
            return
        # 拒任何解码后仍含路径分隔符的"看似文件名其实带路径"的值：
        # 这覆盖了 `..%2fpasswd`、`foo/bar`、`foo\\bar`、空串、纯 `.`/`..`。
        if (
            not parts[2]
            or parts[2] != parts[2].strip()
            or "/" in parts[2]
            or "\\" in parts[2]
            or "\x00" in parts[2]
        ):
            self.send_error(400)
            return
        name = parts[2]
        if not self._NAME_RE.match(name) or name in (".", ".."):
            self.send_error(400)
            return
        # 防御性二次校验：拼接后的最终路径仍必须在 DST 下（防 basename 之外的越界，
        # 如绝对路径 / C:\ 残留、symlink 逃逸——以 realpath 后 DST 为锚比对）。
        target = os.path.realpath(os.path.join(DST, name))
        if not target.startswith(os.path.realpath(DST) + os.sep):
            self.send_error(400)
            return
        n = int(self.headers.get("Content-Length", "0") or 0)
        if n < 0 or n > self.MAX_BYTES:
            self.send_error(413)
            return
        os.makedirs(DST, exist_ok=True)
        with open(target, "wb") as f:
            while n > 0:
                chunk = self.rfile.read(min(65536, n))
                n -= len(chunk)
                if not chunk:
                    break
                f.write(chunk)
        if n != 0:
            # 上传未完整（截断）；丢弃半文件并返回 400。
            os.unlink(target)
            self.send_error(400)
            return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"OK")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8090), H).serve_forever()
