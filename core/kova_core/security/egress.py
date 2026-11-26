import select
import socket
import socketserver
import threading
from typing import Any


DEFAULT_EGRESS_HOSTS: dict[str, list[str]] = {
    "opencode": ["opencode.ai", "models.dev"],
    "claude": ["anthropic.com", "claude.ai", "claude.com", "statsig.com"],
    "gemini": ["googleapis.com", "google.com", "gstatic.com"],
    "codex": ["openai.com", "chatgpt.com", "oaistatic.com"],
}


def egress_hosts(provider: dict[str, Any]) -> list[str]:
    provider_id = str(provider.get("id") or "")
    hosts = DEFAULT_EGRESS_HOSTS.get(provider_id)
    if hosts is not None:
        return list(hosts)
    if str(provider.get("kind") or "") == "api":
        url = str(provider.get("api_url") or "")
        if url:
            from urllib.parse import urlparse

            host = (urlparse(url).hostname or "").lower()
            if host and host not in {"localhost", "127.0.0.1", "::1"}:
                return [host]
    return []


class _ProxyServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, address: tuple[str, int], guard: "EgressGuard"):
        self.guard = guard
        super().__init__(address, _ProxyHandler)


class _ProxyHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        guard = self.server.guard
        conn = self.request
        try:
            buf = b""
            while b"\r\n\r\n" not in buf and len(buf) < 65536:
                data = conn.recv(4096)
                if not data:
                    return
                buf += data
            head, _, extra = buf.partition(b"\r\n\r\n")
            lines = head.split(b"\r\n")
            if not lines:
                return
            method, target, _version = lines[0].decode("latin1").split(" ", 2)
            headers = lines[1:]
            host = target
            port = 443
            if method.upper() == "CONNECT":
                host, _, raw_port = target.partition(":")
                port = int(raw_port or 443)
            else:
                for header in headers:
                    if header.lower().startswith(b"host:"):
                        host = (
                            header.split(b":", 1)[1]
                            .strip()
                            .decode("latin1")
                            .split(":")[0]
                        )
                        break
            allowed = guard.allowed(host)
            guard.record(host, port, allowed)
            if not allowed:
                conn.sendall(
                    b"HTTP/1.1 403 Forbidden\r\n"
                    b"Content-Type: text/plain\r\n"
                    b"Content-Length: 0\r\n\r\n"
                )
                return
            try:
                upstream = socket.create_connection((host, port), timeout=20)
            except OSError:
                conn.sendall(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                return
            try:
                if method.upper() == "CONNECT":
                    conn.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                else:
                    upstream.sendall(
                        b"\r\n".join(lines) + b"\r\n\r\n" + extra
                    )
                    extra = b""
                if extra:
                    upstream.sendall(extra)
                sockets = [conn, upstream]
                while True:
                    readable, _, _ = select.select(sockets, [], [], 300)
                    if not readable:
                        return
                    for source in readable:
                        data = source.recv(65536)
                        if not data:
                            return
                        target_socket = upstream if source is conn else conn
                        target_socket.sendall(data)
            finally:
                upstream.close()
        except (OSError, ValueError):
            return


class EgressGuard:
    """Local allowlisting CONNECT/HTTP proxy for one chat run."""

    def __init__(self, hosts: list[str]):
        self.hosts = sorted({host.lower().strip(".") for host in hosts if host.strip()})
        self._events: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._server = _ProxyServer(("127.0.0.1", 0), self)
        self.port = int(self._server.server_address[1])
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def allowed(self, host: str) -> bool:
        value = host.lower().strip(".")
        return any(value == item or value.endswith("." + item) for item in self.hosts)

    def record(self, host: str, port: int, allowed: bool) -> None:
        key = f"{host.lower()}:{port}:{int(allowed)}"
        with self._lock:
            row = self._events.setdefault(
                key,
                {
                    "host": host.lower(),
                    "port": port,
                    "allowed": allowed,
                    "count": 0,
                },
            )
            row["count"] += 1

    def summary(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = [dict(item) for item in self._events.values()]
        rows.sort(key=lambda item: (not item["allowed"], item["host"]))
        return rows

    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def stop(self) -> None:
        try:
            self._server.shutdown()
        except OSError:
            pass
        try:
            self._server.server_close()
        except OSError:
            pass
        self._thread.join(timeout=2)


def apply_guard_env(env: dict[str, str], guard: EgressGuard) -> dict[str, str]:
    result = dict(env)
    proxy = guard.url()
    for key in (
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ):
        result[key] = proxy
    no_proxy = result.get("NO_PROXY") or result.get("no_proxy") or ""
    entries = [item.strip() for item in no_proxy.split(",") if item.strip()]
    for host in ("localhost", "127.0.0.1", "::1"):
        if host not in entries:
            entries.append(host)
    value = ",".join(entries)
    result["NO_PROXY"] = value
    result["no_proxy"] = value
    return result
