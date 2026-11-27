"""SQLite-backed cache for project memory search.

The cache stores the same result rows the memory API exposes, plus a hidden
full-text body and activity timestamps. A cheap mtime/size fingerprint decides
whether the index must be rebuilt. FTS5 narrows candidates; the existing
synonym scorer still ranks them, so Russian/English synonyms keep working.
"""
from __future__ import annotations

import hashlib
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

INDEX_FILE = "search.sqlite3"
INDEX_VERSION = "1"


def _index_path(hub: Path) -> Path:
    return hub / ".local" / INDEX_FILE


def _source_paths(hub: Path) -> list[Path]:
    paths: list[Path] = []
    for directory in ("tasks", "assets", "chats"):
        root = hub / directory
        if root.is_dir():
            paths.extend(path for path in root.glob("*.json") if path.is_file())
    for relative in ("ledger/events.jsonl", "decisions/decisions.jsonl"):
        path = hub / relative
        if path.is_file():
            paths.append(path)
    return paths


def _fingerprint(hub: Path) -> str:
    digest = hashlib.sha256(f"{INDEX_VERSION}\n".encode())
    for path in sorted(_source_paths(hub), key=lambda item: item.as_posix()):
        try:
            stat = path.stat()
            relative = path.relative_to(hub).as_posix()
        except (OSError, ValueError):
            continue
        digest.update(f"{relative}|{stat.st_mtime_ns}|{stat.st_size}\n".encode())
    return digest.hexdigest()


def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=8)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS docs (
            uid TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            external_id TEXT NOT NULL,
            title TEXT NOT NULL,
            snippet TEXT NOT NULL,
            meta TEXT NOT NULL,
            link TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            body TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS activity (
            kind TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS counts (
            kind TEXT PRIMARY KEY,
            total INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(uid UNINDEXED, body, tokenize='unicode61')"
    )
    return connection


def _build_rows(hub: Path) -> tuple[list[dict[str, Any]], list[dict[str, str]], dict[str, int]]:
    from .memory import (
        _asset_results,
        _chat_results,
        _decision_results,
        _event_results,
        _read_jsonl,
        _task_results,
    )
    from .storage.assets import list_assets
    from .storage.tasks import list_tasks
    from .chats import list_chats

    tasks = list_tasks(hub)
    assets = list_assets(hub)
    chats = list_chats(hub)
    events = _read_jsonl(hub / "ledger" / "events.jsonl")
    decisions = _read_jsonl(hub / "decisions" / "decisions.jsonl")
    huge = 200_000
    docs: list[dict[str, Any]] = []
    docs.extend(_task_results(tasks, "", huge))
    docs.extend(_asset_results(assets, "", huge))
    docs.extend(_chat_results(chats, "", huge))
    docs.extend(_event_results(events, "", huge))
    docs.extend(_decision_results(decisions, "", huge))

    activity: list[dict[str, str]] = []
    for row in docs:
        activity.append(
            {
                "kind": str(row.get("kind") or ""),
                "updated_at": str(row.get("updated_at") or ""),
            }
        )
    counts = {
        "tasks": len(tasks),
        "assets": len(assets),
        "chats": len(chats),
        "events": len(events),
        "decisions": len(decisions),
    }
    return docs, activity, counts


def _write_index(
    connection: sqlite3.Connection,
    fingerprint: str,
    docs: list[dict[str, Any]],
    activity: list[dict[str, str]],
    counts: dict[str, int],
) -> None:
    with connection:
        connection.execute("DELETE FROM docs")
        connection.execute("DELETE FROM docs_fts")
        connection.execute("DELETE FROM activity")
        connection.execute("DELETE FROM counts")
        for row in docs:
            uid = f"{row.get('kind')}|{row.get('id')}"
            connection.execute(
                """
                INSERT OR REPLACE INTO docs
                (uid, kind, external_id, title, snippet, meta, link, updated_at, body)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    uid,
                    str(row.get("kind") or ""),
                    str(row.get("id") or ""),
                    str(row.get("title") or ""),
                    str(row.get("snippet") or ""),
                    str(row.get("meta") or ""),
                    str(row.get("link") or ""),
                    str(row.get("updated_at") or ""),
                    str(row.get("body") or ""),
                ),
            )
            connection.execute(
                "INSERT INTO docs_fts (uid, body) VALUES (?, ?)",
                (uid, str(row.get("body") or "")),
            )
        connection.executemany(
            "INSERT INTO activity (kind, updated_at) VALUES (?, ?)",
            [(row["kind"], row["updated_at"]) for row in activity],
        )
        connection.executemany(
            "INSERT INTO counts (kind, total) VALUES (?, ?)",
            list(counts.items()),
        )
        connection.execute(
            "INSERT INTO meta (key, value) VALUES ('fingerprint', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (fingerprint,),
        )


def _load_index(connection: sqlite3.Connection) -> dict[str, Any]:
    docs = [
        {
            "kind": row[0],
            "id": row[1],
            "title": row[2],
            "snippet": row[3],
            "meta": row[4],
            "link": row[5],
            "updated_at": row[6],
            "body": row[7],
        }
        for row in connection.execute(
            "SELECT kind, external_id, title, snippet, meta, link, updated_at, body FROM docs"
        )
    ]
    activity = [
        {"kind": row[0], "updated_at": row[1]}
        for row in connection.execute("SELECT kind, updated_at FROM activity")
    ]
    counts = {
        str(row[0]): int(row[1])
        for row in connection.execute("SELECT kind, total FROM counts")
    }
    return {"docs": docs, "activity": activity, "counts": counts}


def sync_index(hub: Path) -> dict[str, Any]:
    path = _index_path(hub)
    fingerprint = _fingerprint(hub)
    with closing(_connect(path)) as connection:
        row = connection.execute(
            "SELECT value FROM meta WHERE key = 'fingerprint'"
        ).fetchone()
        if row is None or str(row[0]) != fingerprint:
            docs, activity, counts = _build_rows(hub)
            _write_index(connection, fingerprint, docs, activity, counts)
        return _load_index(connection)


def candidate_uids(hub: Path, query: str) -> set[str] | None:
    """Return FTS candidate uids, or ``None`` when the query has no terms."""
    from .memory import SYNONYMS, _terms

    terms = _terms(query)
    if not terms:
        return None
    path = _index_path(hub)
    with closing(_connect(path)) as connection:
        parts = []
        for term in terms:
            variants = sorted({term, *SYNONYMS.get(term, set())})
            quoted = " OR ".join(
                '"' + variant.replace('"', '""') + '"' for variant in variants
            )
            parts.append(f"({quoted})")
        expression = " AND ".join(parts)
        try:
            rows = connection.execute(
                "SELECT uid FROM docs_fts WHERE docs_fts MATCH ?",
                (expression,),
            ).fetchall()
        except sqlite3.OperationalError:
            return None
        return {str(row[0]) for row in rows}
