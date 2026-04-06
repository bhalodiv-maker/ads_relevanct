#!/usr/bin/env python3
"""
Aggregate store_level_FR.csv for a fixed date window (default 2026-01-25 .. 2026-01-31).
Writes:
  - store_fr_jan25_31_2026.csv  (page_browse_store, requests, served, FR_pct, FR_bucket)
  - store_fr_jan25_31_embed.js   (STORE_FR_JAN25_31 for the comparison dashboard)

FR% = 100 * served / requests (store-day rows summed per store in window).
page_browse_store is normalized (strip, remove leading './') to match dashboard store ids.
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "store_level_FR.csv"
OUT_CSV = ROOT / "store_fr_jan25_31_2026.csv"
OUT_JS = ROOT / "store_fr_jan25_31_embed.js"

DATE_START = "2026-01-25"
DATE_END = "2026-01-31"


def norm(s: str) -> str:
    if not s:
        return ""
    s = str(s).strip()
    if s.startswith("./"):
        s = s[2:]
    return s


def bucket(fr: float | None) -> str:
    if fr is None:
        return "N/A"
    if fr < 20:
        return "0-20"
    if fr < 40:
        return "20-40"
    if fr < 50:
        return "40-50"
    if fr < 60:
        return "50-60"
    if fr < 70:
        return "60-70"
    if fr < 80:
        return "70-80"
    return "80+"


def main() -> None:
    agg: dict[str, dict[str, int]] = defaultdict(lambda: {"req": 0, "srv": 0})
    with SRC.open(newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            d = (row.get("date") or "").strip()
            if d < DATE_START or d > DATE_END:
                continue
            pid = norm(row.get("page_browse_store") or "")
            if not pid:
                continue
            try:
                req = int(float(row["requests"]))
                srv = int(float(row["served"]))
            except (KeyError, ValueError):
                continue
            agg[pid]["req"] += req
            agg[pid]["srv"] += srv

    rows: list[tuple[str, int, int, float | None, str]] = []
    embed: dict[str, dict[str, object]] = {}
    for pid, v in agg.items():
        req, srv = v["req"], v["srv"]
        if req <= 0:
            fr = None
            b = "N/A"
        else:
            fr = 100.0 * srv / req
            b = bucket(fr)
        rows.append((pid, req, srv, fr, b))
        embed[pid] = {"fr": None if fr is None else round(fr, 4), "bucket": b}

    rows.sort(key=lambda x: -x[1])

    with OUT_CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["page_browse_store", "requests", "served", "FR_pct", "FR_bucket"])
        for pid, req, srv, fr, b in rows:
            w.writerow([pid, req, srv, f"{fr:.6f}" if fr is not None else "", b])

    hdr = (
        "/* Auto-generated: FR% = 100 * served / requests; dates "
        f"{DATE_START} .. {DATE_END}; key = page_browse_store (normalized). */\n"
    )
    OUT_JS.write_text(
        hdr + "var STORE_FR_JAN25_31 = " + json.dumps(embed, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(rows)} stores -> {OUT_CSV.name}, {OUT_JS.name}")


if __name__ == "__main__":
    main()
