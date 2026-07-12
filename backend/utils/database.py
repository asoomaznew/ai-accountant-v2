# ─────────────────────────────────────────────────────────────────────────────
# backend/utils/database.py
#
# Persistent audit-log repository for the AI-Accountant backend.
#
# Purpose
#   Every journal entry produced by the pipeline is mirrored into a local
#   SQLite database so we can:
#     • audit what the LLM generated for each uploaded statement
#     • re-export historical entries on demand
#     • guard against duplicates (same account + same date range)
#
# Design choices
#   • aiosqlite for async access (matches the FastAPI app's async stack —
#     `aiosqlite==0.22.1` is in backend/requirements.txt).
#   • Module-level connection pool: one connection per event loop, lazily
#     created on first call. The connection is reused across requests.
#   • Every public function is wrapped in `try / except` with structured
#     logging — a DB failure must never crash the HTTP handler; the caller
#     always gets a sensible default (empty list, None, False) plus a
#     logged error they can correlate by request id.
#
# Why not SQLAlchemy?
#   The rest of the backend uses raw aiosqlite + Pydantic. Introducing a
#   second ORM would add a dependency + learning curve for one table.
#   If the schema grows beyond 5 tables, swap to SQLAlchemy Core.
#
# Usage
#   from backend.utils.database import (
#       init_db, save_journal_entry, list_entries, get_entry, delete_entry,
#       count_entries, clear_all,
#   )
#   await init_db()                                  # call once at startup
#   await save_journal_entry({...})                  # persist one row
#   rows = await list_entries(account_no="KIBAA-2380", limit=50)
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Iterable, Optional

try:
    import aiosqlite as _aiosqlite_lib  # type: ignore
    aiosqlite: Any = _aiosqlite_lib
except ImportError:  # pragma: no cover - aiosqlite is in requirements.txt
    aiosqlite = None  # type: ignore[assignment]


logger = logging.getLogger(__name__)

# Where to put the SQLite file. Defaults to a sibling of the backend dir.
# Override with the ACCOUNTANT_DB_PATH env var.
_DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "accounting.db"
DB_PATH = Path(os.environ.get("ACCOUNTANT_DB_PATH", str(_DEFAULT_DB_PATH)))

# Module-level lock so two concurrent first-callers don't both try to
# initialize the schema simultaneously.
_init_lock = asyncio.Lock()
_initialized = False

# Reusable connection per process (one per event loop).
_conn: Optional["aiosqlite.Connection"] = None  # type: ignore[name-defined]


# ─────────────────────────────────────────────────────────────────────────────
# Connection management
# ─────────────────────────────────────────────────────────────────────────────

def _get_db_path() -> Path:
    """Return the resolved DB path, creating its parent directory if needed."""
    try:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.error(
            "Could not create parent dir for DB at %s: %s",
            DB_PATH.parent, exc,
        )
        # Don't raise — return the path anyway; the connect step will surface
        # a clearer error if the dir truly is unwritable.
    return DB_PATH


async def _get_connection() -> "aiosqlite.Connection":  # type: ignore[name-defined]
    """Return (and lazily create) the module-level async connection."""
    global _conn
    if _conn is not None:
        return _conn
    if aiosqlite is None:
        raise RuntimeError(
            "aiosqlite is not installed. Run `pip install aiosqlite==0.22.1`."
        )
    try:
        path = _get_db_path()
        _conn = await aiosqlite.connect(str(path))
        # aiosqlite returns an aiosqlite.Connection; cast to sqlite3.Row-friendly
        # interface for downstream code.
        _conn.row_factory = sqlite3.Row  # type: ignore[attr-defined]
        # Foreign keys + WAL for safer concurrent reads.
        await _conn.execute("PRAGMA foreign_keys = ON;")  # type: ignore[union-attr]
        await _conn.execute("PRAGMA journal_mode = WAL;")  # type: ignore[union-attr]
        logger.info("Opened accounting DB at %s", path)
        return _conn  # type: ignore[return-value]
    except (OSError, sqlite3.Error) as exc:
        logger.exception("Failed to open accounting DB: %s", exc)
        raise


@asynccontextmanager
async def transaction() -> AsyncIterator["aiosqlite.Connection"]:  # type: ignore[name-defined]
    """
    Yield a connection inside an explicit transaction.

    Commits on clean exit, rolls back on any exception. Use this when you
    need to make multiple writes atomically.

        async with transaction() as conn:
            await conn.execute("INSERT ...", (...))
            await conn.execute("UPDATE ...", (...))
    """
    conn = await _get_connection()
    try:
        await conn.execute("BEGIN")
        yield conn
        await conn.commit()
    except Exception as exc:
        try:
            await conn.rollback()
        except sqlite3.Error as rb_exc:
            logger.error("Rollback failed: %s", rb_exc)
        logger.exception("Transaction rolled back due to error: %s", exc)
        raise


# ─────────────────────────────────────────────────────────────────────────────
# Schema
# ─────────────────────────────────────────────────────────────────────────────

# Single table for now. If we add categories / users / etc., they become
# separate tables with FK references to `id` here.
SCHEMA_STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS journal_entries (
        id              TEXT PRIMARY KEY,
        account_no      TEXT NOT NULL,
        account_name    TEXT,
        source_filename TEXT,
        posting_date    TEXT NOT NULL,        -- ISO-8601 YYYY-MM-DD
        journal_name    TEXT NOT NULL,        -- e.g. 'STVINV', 'CRNOTE'
        description     TEXT,
        debit_amount    REAL,
        credit_amount   REAL,
        currency_code   TEXT DEFAULT 'KWD',
        status          TEXT NOT NULL DEFAULT 'committed',
        -- payload is the full original entry as JSON for round-trip fidelity
        payload         TEXT NOT NULL,
        request_id      TEXT,                 -- correlate with HTTP request
        created_at      INTEGER NOT NULL      -- unix epoch millis
    );
    """,
    "CREATE INDEX IF NOT EXISTS idx_entries_account      ON journal_entries(account_no);",
    "CREATE INDEX IF NOT EXISTS idx_entries_posting_date ON journal_entries(posting_date);",
    "CREATE INDEX IF NOT EXISTS idx_entries_status       ON journal_entries(status);",
    "CREATE INDEX IF NOT EXISTS idx_entries_request_id  ON journal_entries(request_id);",
)


async def init_db() -> bool:
    """
    Create the schema if it doesn't already exist.

    Safe to call multiple times — uses `CREATE TABLE IF NOT EXISTS` and is
    protected by an asyncio lock so concurrent startup races can't double-
    create or partially-create tables.

    Returns True on success, False if aiosqlite is missing or the DB file
    could not be opened.
    """
    global _initialized
    async with _init_lock:
        if _initialized:
            return True
        if aiosqlite is None:
            logger.error(
                "init_db called but aiosqlite is not installed — "
                "DB features will be unavailable."
            )
            return False
        try:
            conn = await _get_connection()
            for stmt in SCHEMA_STATEMENTS:
                await conn.execute(stmt)
            await conn.commit()
            _initialized = True
            logger.info("Initialized accounting DB schema at %s", DB_PATH)
            return True
        except (sqlite3.Error, OSError) as exc:
            logger.exception("init_db failed: %s", exc)
            return False


async def close_db() -> None:
    """Close the module-level connection. Safe to call multiple times."""
    global _conn, _initialized
    if _conn is None:
        return
    try:
        await _conn.close()
        logger.info("Closed accounting DB connection.")
    except (sqlite3.Error, OSError) as exc:
        logger.warning("Error while closing accounting DB: %s", exc)
    finally:
        _conn = None
        _initialized = False


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

REQUIRED_ENTRY_FIELDS = ("account_no", "posting_date", "journal_name")


def _validate_entry(entry: Any) -> None:
    """
    Raise ValueError if `entry` is not a usable journal row.

    The shape we expect (loose — extra fields are preserved in `payload`):

        {
          "account_no":    "KIBAA-2380",
          "posting_date":  "2025-12-31",   # ISO date
          "journal_name":  "STVINV" | "CRNOTE" | ...
          "description":   "...",           # optional
          "debit_amount":  123.45,          # optional
          "credit_amount": 0.0,             # optional
          ...
        }
    """
    if not isinstance(entry, dict):
        raise ValueError(f"entry must be a dict, got {type(entry).__name__}")
    for field in REQUIRED_ENTRY_FIELDS:
        value = entry.get(field)
        if value is None or (isinstance(value, str) and not value.strip()):
            raise ValueError(f"entry.{field} is required and must be non-empty")


# ─────────────────────────────────────────────────────────────────────────────
# CRUD
# ─────────────────────────────────────────────────────────────────────────────

async def save_journal_entry(
    entry: dict[str, Any],
    *,
    request_id: Optional[str] = None,
    status: str = "committed",
) -> Optional[str]:
    """
    Persist a single journal entry. Returns the assigned id, or None on
    failure (after logging). Never raises — DB errors must not crash the
    request handler.

    The entry's `payload` field is stored as JSON so the full original
    shape round-trips on read.
    """
    try:
        _validate_entry(entry)
    except ValueError as exc:
        # Defensive: _validate_entry may have thrown because `entry` is the
        # wrong type, so we can't safely call .get() on it. Log just the
        # fields we know about (type, repr of entry) instead.
        try:
            safe_fields = {k: entry.get(k) for k in REQUIRED_ENTRY_FIELDS}  # type: ignore[union-attr]
        except AttributeError:
            safe_fields = {"_repr": repr(entry)[:200]}
        logger.error(
            "save_journal_entry: validation failed: %s | entry=%s",
            exc, safe_fields,
        )
        return None

    new_id = entry.get("id") or str(uuid.uuid4())
    now_ms = int(time.time() * 1000)
    payload_json = json.dumps(entry, ensure_ascii=False, default=str)

    try:
        conn = await _get_connection()
        if not _initialized:
            await init_db()
        await conn.execute(
            """
            INSERT INTO journal_entries
                (id, account_no, account_name, source_filename, posting_date,
                 journal_name, description, debit_amount, credit_amount,
                 currency_code, status, payload, request_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id,
                str(entry.get("account_no") or "").strip(),
                entry.get("account_name"),
                entry.get("source_filename") or entry.get("filename"),
                str(entry.get("posting_date") or "").strip(),
                str(entry.get("journal_name") or "").strip(),
                entry.get("description"),
                _coerce_number(entry.get("debit_amount")),
                _coerce_number(entry.get("credit_amount")),
                entry.get("currency_code") or "KWD",
                status,
                payload_json,
                request_id,
                now_ms,
            ),
        )
        await conn.commit()
        logger.info(
            "save_journal_entry: stored id=%s account=%s posting_date=%s "
            "journal=%s amount=%s status=%s",
            new_id,
            entry.get("account_no"),
            entry.get("posting_date"),
            entry.get("journal_name"),
            entry.get("debit_amount") or entry.get("credit_amount"),
            status,
        )
        return new_id
    except (sqlite3.Error, OSError) as exc:
        logger.exception("save_journal_entry: DB write failed for id=%s: %s",
                         new_id, exc)
        return None


async def save_journal_entries_bulk(
    entries: Iterable[dict[str, Any]],
    *,
    request_id: Optional[str] = None,
    status: str = "committed",
) -> int:
    """
    Save many entries in one transaction. Returns the number successfully
    persisted. On full failure returns 0 and logs. Partial failures roll
    back the entire batch (atomic).
    """
    try:
        entries_list = list(entries)
    except TypeError as exc:
        logger.error("save_journal_entries_bulk: not iterable: %s", exc)
        return 0
    if not entries_list:
        return 0

    # Pre-validate so we don't half-insert a batch with bad rows.
    for idx, entry in enumerate(entries_list):
        try:
            _validate_entry(entry)
        except ValueError as exc:
            # Defensive logging — entry might not be a dict at all.
            try:
                safe_fields = {k: entry.get(k) for k in REQUIRED_ENTRY_FIELDS}  # type: ignore[union-attr]
            except AttributeError:
                safe_fields = {"_repr": repr(entry)[:200]}
            logger.error(
                "save_journal_entries_bulk: row %d validation failed: %s | entry=%s",
                idx, exc, safe_fields,
            )
            return 0

    rows: list[tuple[Any, ...]] = []
    now_ms = int(time.time() * 1000)
    for entry in entries_list:
        new_id = entry.get("id") or str(uuid.uuid4())
        rows.append((
            new_id,
            str(entry.get("account_no") or "").strip(),
            entry.get("account_name"),
            entry.get("source_filename") or entry.get("filename"),
            str(entry.get("posting_date") or "").strip(),
            str(entry.get("journal_name") or "").strip(),
            entry.get("description"),
            _coerce_number(entry.get("debit_amount")),
            _coerce_number(entry.get("credit_amount")),
            entry.get("currency_code") or "KWD",
            status,
            json.dumps(entry, ensure_ascii=False, default=str),
            request_id,
            now_ms,
        ))

    try:
        async with transaction() as conn:
            await conn.executemany(
                """
                INSERT INTO journal_entries
                    (id, account_no, account_name, source_filename, posting_date,
                     journal_name, description, debit_amount, credit_amount,
                     currency_code, status, payload, request_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
        logger.info(
            "save_journal_entries_bulk: persisted %d row(s) request_id=%s",
            len(rows), request_id,
        )
        return len(rows)
    except (sqlite3.Error, OSError) as exc:
        logger.exception(
            "save_journal_entries_bulk: failed to insert %d rows: %s",
            len(rows), exc,
        )
        return 0


async def list_entries(
    *,
    account_no: Optional[str] = None,
    start_date: Optional[str] = None,   # inclusive, ISO date
    end_date:   Optional[str] = None,   # inclusive, ISO date
    status:     Optional[str] = None,
    limit:      int = 100,
    offset:     int = 0,
) -> list[dict[str, Any]]:
    """
    Query entries with optional filters. Returns [] on failure (never
    raises). Newest first.
    """
    if limit <= 0:
        limit = 1
    if limit > 1000:
        limit = 1000
    if offset < 0:
        offset = 0

    where: list[str] = []
    params: list[Any] = []
    if account_no:
        where.append("account_no = ?")
        params.append(account_no)
    if start_date:
        where.append("posting_date >= ?")
        params.append(start_date)
    if end_date:
        where.append("posting_date <= ?")
        params.append(end_date)
    if status:
        where.append("status = ?")
        params.append(status)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    sql = (
        f"SELECT id, account_no, account_name, source_filename, posting_date, "
        f"journal_name, description, debit_amount, credit_amount, currency_code, "
        f"status, payload, request_id, created_at "
        f"FROM journal_entries {where_sql} "
        f"ORDER BY posting_date DESC, created_at DESC "
        f"LIMIT ? OFFSET ?"
    )
    params.extend([limit, offset])

    try:
        conn = await _get_connection()
        async with conn.execute(sql, params) as cur:
            rows = await cur.fetchall()
        return [_row_to_dict(r) for r in rows]
    except (sqlite3.Error, OSError) as exc:
        logger.exception("list_entries failed: %s", exc)
        return []


async def get_entry(entry_id: str) -> Optional[dict[str, Any]]:
    """Return one entry by id, or None if missing / on error."""
    if not entry_id:
        return None
    try:
        conn = await _get_connection()
        async with conn.execute(
            "SELECT * FROM journal_entries WHERE id = ?", (entry_id,),
        ) as cur:
            row = await cur.fetchone()
        return _row_to_dict(row) if row else None
    except (sqlite3.Error, OSError) as exc:
        logger.exception("get_entry(%s) failed: %s", entry_id, exc)
        return None


async def delete_entry(entry_id: str) -> bool:
    """Delete one entry by id. Returns True if a row was actually removed."""
    if not entry_id:
        logger.warning("delete_entry called with empty id")
        return False
    try:
        conn = await _get_connection()
        cur = await conn.execute(
            "DELETE FROM journal_entries WHERE id = ?", (entry_id,),
        )
        await conn.commit()
        removed = cur.rowcount > 0
        if removed:
            logger.info("delete_entry(%s): removed", entry_id)
        else:
            logger.warning("delete_entry(%s): no row matched", entry_id)
        return removed
    except (sqlite3.Error, OSError) as exc:
        logger.exception("delete_entry(%s) failed: %s", entry_id, exc)
        return False


async def count_entries(
    *,
    account_no: Optional[str] = None,
    status:     Optional[str] = None,
) -> int:
    """Return the row count for the given filters. 0 on error."""
    where: list[str] = []
    params: list[Any] = []
    if account_no:
        where.append("account_no = ?")
        params.append(account_no)
    if status:
        where.append("status = ?")
        params.append(status)
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    try:
        conn = await _get_connection()
        async with conn.execute(
            f"SELECT COUNT(*) AS n FROM journal_entries {where_sql}", params,
        ) as cur:
            row = await cur.fetchone()
        return int(row["n"]) if row else 0
    except (sqlite3.Error, OSError) as exc:
        logger.exception("count_entries failed: %s", exc)
        return 0


async def clear_all() -> int:
    """
    DANGER: wipe every entry. Returns the count that were present.
    Used by tests and the optional 'Reset cache' admin action.
    """
    try:
        conn = await _get_connection()
        before = await count_entries()
        await conn.execute("DELETE FROM journal_entries")
        await conn.commit()
        logger.warning("clear_all: wiped %d row(s) from journal_entries", before)
        return before
    except (sqlite3.Error, OSError) as exc:
        logger.exception("clear_all failed: %s", exc)
        return 0


# ─────────────────────────────────────────────────────────────────────────────
# Internals
# ─────────────────────────────────────────────────────────────────────────────

def _coerce_number(value: Any) -> Optional[float]:
    """Best-effort float coercion. Returns None for blanks / unparseable."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        logger.warning("_coerce_number: cannot coerce %r to float", value)
        return None


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any]:
    """Convert a sqlite3.Row to a plain dict and parse the JSON payload."""
    if row is None:
        return {}
    base = {key: row[key] for key in row.keys() if key != "payload"}
    try:
        base["payload"] = json.loads(row["payload"]) if row["payload"] else None
    except (TypeError, ValueError) as exc:
        logger.warning("Failed to decode payload JSON for row id=%s: %s",
                       row["id"], exc)
        base["payload"] = None
    return base


# ─────────────────────────────────────────────────────────────────────────────
# Convenience: lifespan helper for FastAPI
# ─────────────────────────────────────────────────────────────────────────────

async def lifespan_setup() -> None:
    """Call once at FastAPI startup."""
    ok = await init_db()
    if not ok:
        logger.warning(
            "Accounting DB not available — persistence calls will no-op. "
            "Set ACCOUNTANT_DB_PATH or install aiosqlite to fix."
        )


async def lifespan_teardown() -> None:
    """Call at FastAPI shutdown."""
    await close_db()