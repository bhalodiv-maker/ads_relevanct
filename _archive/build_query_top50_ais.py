#!/usr/bin/env python3
"""
Aggregate relevance_data_for_04_march.csv (fold<=12, 7 BUs), GROUP BY (BU, store, query).

Writes ONE CSV: rows where aggregated all_impressions >= MIN_ALL_IMPRESSIONS (default 1000).
If the file is still too large, set env QUERY_MIN_ALL_IMPRESSIONS=5000 before running.

Optional QUERY_AIS_MAX_SOURCE_ROWS=N — read only the first N data rows from the relevance CSV
(fast local sample); omit for a full scan of relevance_data_for_04_march.csv.

Regenerate dashboard preload only: python3 build_query_top50_ais.py --embed-only

Output:
  04_march_query_level_bu_store_query.csv — BU, store_id, store_name, store_AIS_bucket (from
    04_march_store_R0_AIS_metrics.csv), query, AIS_pct, AIS_bucket (query-level), all_impressions, …
    Rows are omitted if (BU, store_id) is not in that metrics file (no store_AIS_bucket).
  04_march_query_level_unique_queries_by_bu.csv — BU, unique_query_count (from the main output)
  query_ais_embed.js (if row count <= 100k) — JSON preload for the dashboard on file://
"""
from __future__ import annotations

import csv
import json
import os
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CSV_PATH = ROOT / "relevance_data_for_04_march.csv"
STORE_MAP_PATH = ROOT / "store_to_store_name_mapping.csv"
STORE_METRICS_PATH = ROOT / "04_march_store_R0_AIS_metrics.csv"
DB_PATH = ROOT / "_query_agg.sqlite"
OUT_CSV = ROOT / "04_march_query_level_bu_store_query.csv"
SUMMARY_BY_BU = ROOT / "04_march_query_level_unique_queries_by_bu.csv"
EMBED_JS = ROOT / "query_ais_embed.js"
# Cap rows embedded into query_ais_embed.js (file:// preload). Raise if your CSV grows.
MAX_EMBED_ROWS = 500_000

# Default 1000; use 5000 if output is still too heavy: QUERY_MIN_ALL_IMPRESSIONS=5000 python3 ...
MIN_ALL_IMPRESSIONS = int(os.environ.get("QUERY_MIN_ALL_IMPRESSIONS", "1000"))
# Optional: stop after this many CSV data rows (after header) for a quick local CSV; omit for full scan.
_max_src = os.environ.get("QUERY_AIS_MAX_SOURCE_ROWS", "").strip()
MAX_SOURCE_ROWS = int(_max_src) if _max_src else None

ALLOWED_BUS = {
    "BGM",
    "CoreElectronics",
    "EmergingElectronics",
    "Furniture",
    "Home",
    "Large",
    "Lifestyle",
}

BATCH = 100_000

def ais_bucket(ais_pct: float) -> str:
    """Map AIS % (0–100 scale) to dashboard AIS bucket."""
    if ais_pct < 5:
        return "<5%"
    if ais_pct < 15:
        return "5–15%"
    if ais_pct < 25:
        return "15–25%"
    if ais_pct < 30:
        return "25–30%"
    if ais_pct < 35:
        return "30–35%"
    if ais_pct <= 40:
        return "35–40%"
    return ">40%"


FIELDNAMES = [
    "BU",
    "store_id",
    "store_name",
    "store_AIS_bucket",
    "query",
    "AIS_pct",
    "AIS_bucket",
    "all_impressions",
    "ads_impressions",
    "organic_impressions",
]


def safe_int(x: str | None) -> int:
    if x is None or x == "":
        return 0
    try:
        return int(float(x))
    except ValueError:
        return 0


def load_store_mapping(map_path: Path) -> dict[str, str]:
    if not map_path.is_file():
        return {}
    out: dict[str, str] = {}
    with open(map_path, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            k = (row.get("store") or "").strip()
            if not k:
                continue
            out[k] = (row.get("store_name") or "").strip()
    return out


def load_store_ais_bucket_by_bu_store(metrics_path: Path) -> dict[tuple[str, str], str]:
    """(BU, requestStorePath) -> AIS_bucket from store-level metrics CSV."""
    if not metrics_path.is_file():
        return {}
    out: dict[tuple[str, str], str] = {}
    with open(metrics_path, newline="", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            bu = (row.get("bu") or "").strip()
            sid = (row.get("requestStorePath") or "").strip()
            bk = (row.get("AIS_bucket") or "").strip()
            if bu and sid and bk:
                out[(bu, sid)] = bk
    return out


def load_csv_to_sqlite(csv_path: Path, db_path: Path) -> None:
    if db_path.exists():
        db_path.unlink()
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=OFF")
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.execute("PRAGMA cache_size=-512000")
    conn.execute(
        """CREATE TABLE raw (
            bu TEXT NOT NULL,
            store TEXT NOT NULL,
            q TEXT NOT NULL,
            ads INTEGER NOT NULL,
            org INTEGER NOT NULL,
            alli INTEGER NOT NULL
        )"""
    )
    batch: list[tuple[str, str, str, int, int, int]] = []
    n_in = 0
    ins = "INSERT INTO raw VALUES (?,?,?,?,?,?)"
    with open(csv_path, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            n_in += 1
            if MAX_SOURCE_ROWS is not None and n_in > MAX_SOURCE_ROWS:
                n_in -= 1
                break
            if n_in % 5_000_000 == 0:
                print(f"  read {n_in:,} rows...", file=sys.stderr)
            fold = safe_int(row.get("fold"))
            if fold > 12:
                continue
            bu = (row.get("BU") or row.get("bu") or "").strip()
            if bu not in ALLOWED_BUS:
                continue
            store = (row.get("requestStorePath") or "").strip()
            if not store:
                continue
            q = row.get("query") or ""
            ads = safe_int(row.get("ads_imp"))
            org = safe_int(row.get("org_imp"))
            alli = safe_int(row.get("all_impressions"))
            batch.append((bu, store, q, ads, org, alli))
            if len(batch) >= BATCH:
                conn.executemany(ins, batch)
                batch.clear()
    if batch:
        conn.executemany(ins, batch)
    conn.commit()
    print(f"Inserted filtered rows from {n_in:,} CSV lines.", file=sys.stderr)
    print("Running GROUP BY (bu, store, query)...", file=sys.stderr)
    conn.execute(
        """CREATE TABLE agg AS
           SELECT bu, store, q,
                  SUM(ads) AS ads,
                  SUM(org) AS orgi,
                  SUM(alli) AS alli
           FROM raw
           GROUP BY bu, store, q"""
    )
    conn.execute("DROP TABLE raw")
    conn.commit()
    conn.execute("CREATE INDEX idx_agg_alli ON agg(alli)")
    conn.commit()
    conn.close()


def write_query_ais_csv(
    conn: sqlite3.Connection,
    out_path: Path,
    store_names: dict[str, str],
    store_ais_bucket: dict[tuple[str, str], str],
) -> int:
    cur = conn.execute(
        """SELECT bu, store, q, ads, orgi, alli FROM agg
           WHERE alli >= ?
           ORDER BY alli DESC""",
        (MIN_ALL_IMPRESSIONS,),
    )
    n = 0
    skipped_no_store = 0
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        w.writeheader()
        for bu, store, q, ads, orgi, alli in cur:
            sab = store_ais_bucket.get((bu, store), "")
            if not sab:
                skipped_no_store += 1
                continue
            alli = int(alli)
            ads = int(ads)
            orgi = int(orgi)
            ais = 0.0 if alli <= 0 else round(100.0 * ads / alli, 4)
            bucket = ais_bucket(ais)
            w.writerow(
                {
                    "BU": bu,
                    "store_id": store,
                    "store_name": store_names.get(store, ""),
                    "store_AIS_bucket": sab,
                    "query": q,
                    "AIS_pct": f"{ais:.4f}",
                    "AIS_bucket": bucket,
                    "all_impressions": alli,
                    "ads_impressions": ads,
                    "organic_impressions": orgi,
                }
            )
            n += 1
    if skipped_no_store:
        print(
            f"Skipped {skipped_no_store:,} (BU, store, query) groups not in {STORE_METRICS_PATH.name}.",
            file=sys.stderr,
        )
    return n


def write_query_ais_embed_js(csv_path: Path, js_path: Path) -> int:
    """Write compact JSON preload for the dashboard (same row shape as csvRecordsToQueryRows)."""
    rows: list[dict[str, object]] = []
    with open(csv_path, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if len(rows) >= MAX_EMBED_ROWS:
                break
            bu = (row.get("BU") or "").strip()
            sid = (row.get("store_id") or "").strip()
            if not bu or not sid:
                continue
            try:
                ais = float(row.get("AIS_pct") or 0)
            except ValueError:
                ais = 0.0
            try:
                alli = int(float(row.get("all_impressions") or 0))
            except ValueError:
                alli = 0
            try:
                orgi = int(float(row.get("organic_impressions") or 0))
            except ValueError:
                orgi = 0
            try:
                adsi = int(float(row.get("ads_impressions") or 0))
            except ValueError:
                adsi = 0
            bk = (row.get("AIS_bucket") or "").strip() or ais_bucket(ais)
            sab = (row.get("store_AIS_bucket") or "").strip()
            rows.append(
                {
                    "b": bu,
                    "s": sid,
                    "nm": (row.get("store_name") or "").strip(),
                    "sab": sab,
                    "q": row.get("query") or "",
                    "a": ais,
                    "ab": bk,
                    "org": orgi,
                    "ads": adsi,
                    "all": alli,
                }
            )
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("// Auto-generated by build_query_top50_ais.py — do not edit.\n")
        f.write("window.__QUERY_AIS_PRELOAD__=")
        json.dump(rows, f, separators=(",", ":"))
        f.write(";\n")
    return len(rows)


def write_bu_unique_query_summary(out_csv: Path, summary_path: Path) -> tuple[dict[str, int], int]:
    """Distinct query text per BU over rows in out_csv; also global distinct query strings."""
    by_bu: dict[str, set[str]] = defaultdict(set)
    with open(out_csv, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            bu = (row.get("BU") or "").strip()
            q = (row.get("query") or "").strip()
            if bu and q:
                by_bu[bu].add(q)
    grand: set[str] = set()
    for s in by_bu.values():
        grand |= s
    with open(summary_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["BU", "unique_query_count"])
        for bu in sorted(by_bu.keys()):
            w.writerow([bu, len(by_bu[bu])])
    counts = {bu: len(by_bu[bu]) for bu in sorted(by_bu.keys())}
    return counts, len(grand)


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--embed-only":
        if not OUT_CSV.is_file():
            print(f"Missing {OUT_CSV}", file=sys.stderr)
            sys.exit(1)
        ne = write_query_ais_embed_js(OUT_CSV, EMBED_JS)
        print(f"Wrote {ne:,} rows to {EMBED_JS} (dashboard file:// preload).", file=sys.stderr)
        return
    if not CSV_PATH.is_file():
        print(f"Missing {CSV_PATH}", file=sys.stderr)
        sys.exit(1)
    print(
        f"Min all_impressions per (BU, store, query) row: {MIN_ALL_IMPRESSIONS:,} "
        f"(set QUERY_MIN_ALL_IMPRESSIONS to change, e.g. 5000)",
        file=sys.stderr,
    )
    if MAX_SOURCE_ROWS is not None:
        print(
            f"Partial read: first {MAX_SOURCE_ROWS:,} CSV rows only "
            f"(QUERY_AIS_MAX_SOURCE_ROWS). Full run: unset that env.",
            file=sys.stderr,
        )
    store_names = load_store_mapping(STORE_MAP_PATH)
    if store_names:
        print(f"Loaded {len(store_names):,} store name mappings.", file=sys.stderr)
    else:
        print(f"No mapping at {STORE_MAP_PATH}; store_name column will be empty.", file=sys.stderr)
    store_ais_bucket = load_store_ais_bucket_by_bu_store(STORE_METRICS_PATH)
    if store_ais_bucket:
        print(
            f"Loaded {len(store_ais_bucket):,} store AIS buckets from {STORE_METRICS_PATH.name}.",
            file=sys.stderr,
        )
    else:
        print(
            f"No store AIS buckets ({STORE_METRICS_PATH.name} missing or empty); store_AIS_bucket will be blank.",
            file=sys.stderr,
        )
    load_csv_to_sqlite(CSV_PATH, DB_PATH)
    conn = sqlite3.connect(str(DB_PATH))
    n = write_query_ais_csv(conn, OUT_CSV, store_names, store_ais_bucket)
    conn.close()
    if DB_PATH.exists():
        DB_PATH.unlink()
    print(f"Wrote {n:,} rows (alli >= {MIN_ALL_IMPRESSIONS:,}) to {OUT_CSV}", file=sys.stderr)
    bu_counts, grand_uq = write_bu_unique_query_summary(OUT_CSV, SUMMARY_BY_BU)
    print(f"Wrote BU-level unique query counts to {SUMMARY_BY_BU}", file=sys.stderr)
    for bu, c in bu_counts.items():
        print(f"  {bu}: {c:,} unique queries", file=sys.stderr)
    print(f"  (distinct query text across all BUs: {grand_uq:,})", file=sys.stderr)
    if n <= MAX_EMBED_ROWS:
        ne = write_query_ais_embed_js(OUT_CSV, EMBED_JS)
        print(f"Wrote {ne:,} rows to {EMBED_JS} (dashboard file:// preload).", file=sys.stderr)
    else:
        if EMBED_JS.is_file():
            EMBED_JS.unlink()
        print(
            f"Skipped {EMBED_JS.name} ({n:,} rows > {MAX_EMBED_ROWS:,}); use CSV + http.server.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
