#!/usr/bin/env python3
"""
From 04_march_query_level_bu_store_query.csv, compute per-store AIS as
impression-weighted mean of query-level AIS_pct, then AIS bucket distribution.

Outputs:
  - Prints bucket summary to stdout
  - Writes 04_march_store_AIS_from_query_level.csv (one row per store)
  - Writes 04_march_store_AIS_bucket_dist_from_query.csv (distribution table)
"""
from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
QUERY_CSV = ROOT / "04_march_query_level_bu_store_query.csv"
OUT_STORES = ROOT / "04_march_store_AIS_from_query_level.csv"
OUT_DIST = ROOT / "04_march_store_AIS_bucket_dist_from_query.csv"

AIS_ORDER = ["<5%", "5–15%", "15–25%", "25–30%", "30–35%", "35–40%", ">40%"]


def ais_bucket(ais_pct: float) -> str:
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


def main() -> None:
    # (bu, store_id) -> { imp_sum, ais_weighted_sum, store_name, ref_bucket, n_queries }
    agg: dict[tuple[str, str], dict] = defaultdict(
        lambda: {
            "imp": 0,
            "ais_w": 0.0,
            "store_name": "",
            "ref_bucket": "",
            "n_queries": 0,
        }
    )

    with QUERY_CSV.open(newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            bu = (row.get("BU") or "").strip()
            sid = (row.get("store_id") or "").strip()
            if not bu or not sid:
                continue
            try:
                imp = int(row["all_impressions"] or 0)
            except (TypeError, ValueError):
                imp = 0
            try:
                ais = float(row["AIS_pct"] or 0)
            except (TypeError, ValueError):
                ais = 0.0
            key = (bu, sid)
            a = agg[key]
            a["imp"] += imp
            a["ais_w"] += ais * imp
            a["n_queries"] += 1
            if not a["store_name"]:
                a["store_name"] = (row.get("store_name") or "").strip()
            if not a["ref_bucket"]:
                a["ref_bucket"] = (row.get("store_AIS_bucket") or "").strip()

    stores: list[dict] = []
    for (bu, sid), a in sorted(agg.items()):
        imp = a["imp"]
        if imp <= 0:
            continue
        ais_pct = a["ais_w"] / imp
        b = ais_bucket(ais_pct)
        stores.append(
            {
                "BU": bu,
                "store_id": sid,
                "store_name": a["store_name"],
                "AIS_pct_weighted": round(ais_pct, 4),
                "AIS_bucket": b,
                "all_impressions_total": imp,
                "query_rows": a["n_queries"],
                "store_AIS_bucket_csv": a["ref_bucket"],
            }
        )

    total_stores = len(stores)
    total_imp = sum(s["all_impressions_total"] for s in stores)

    by_bucket: dict[str, list[dict]] = defaultdict(list)
    for s in stores:
        by_bucket[s["AIS_bucket"]].append(s)

    dist_rows = []
    for bucket in AIS_ORDER:
        ss = by_bucket.get(bucket, [])
        c = len(ss)
        imp_b = sum(x["all_impressions_total"] for x in ss)
        dist_rows.append(
            {
                "AIS_bucket": bucket,
                "store_count": c,
                "store_pct": round(100.0 * c / total_stores, 2) if total_stores else 0,
                "all_impressions": imp_b,
                "impression_share_pct": round(100.0 * imp_b / total_imp, 2) if total_imp else 0,
            }
        )

    # Any bucket not in AIS_ORDER (shouldn't happen)
    extra = set(by_bucket) - set(AIS_ORDER)
    for bucket in sorted(extra):
        ss = by_bucket[bucket]
        imp_b = sum(x["all_impressions_total"] for x in ss)
        dist_rows.append(
            {
                "AIS_bucket": bucket,
                "store_count": len(ss),
                "store_pct": round(100.0 * len(ss) / total_stores, 2) if total_stores else 0,
                "all_impressions": imp_b,
                "impression_share_pct": round(100.0 * imp_b / total_imp, 2) if total_imp else 0,
            }
        )

    fieldnames = [
        "BU",
        "store_id",
        "store_name",
        "AIS_pct_weighted",
        "AIS_bucket",
        "all_impressions_total",
        "query_rows",
        "store_AIS_bucket_csv",
    ]
    with OUT_STORES.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(stores)

    dist_fields = [
        "AIS_bucket",
        "store_count",
        "store_pct",
        "all_impressions",
        "impression_share_pct",
    ]
    with OUT_DIST.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=dist_fields)
        w.writeheader()
        w.writerows(dist_rows)

    print(f"Stores (from query CSV, imp>0): {total_stores}")
    print(f"Total all_impressions (summed per store): {total_imp:,}")
    print()
    print("AIS bucket distribution (store count & impression share):")
    print(f"{'bucket':<10} {'stores':>8} {'store_%':>10} {'impressions':>16} {'impr_share_%':>14}")
    for d in dist_rows:
        print(
            f"{d['AIS_bucket']:<10} {d['store_count']:>8} {d['store_pct']:>9}% "
            f"{d['all_impressions']:>16,} {d['impression_share_pct']:>13}%"
        )
    print()
    print(f"Wrote {OUT_STORES.name}")
    print(f"Wrote {OUT_DIST.name}")

    # How often computed bucket matches CSV store_AIS_bucket
    match = sum(
        1
        for s in stores
        if s["store_AIS_bucket_csv"] and s["AIS_bucket"] == s["store_AIS_bucket_csv"]
    )
    with_ref = sum(1 for s in stores if s["store_AIS_bucket_csv"])
    if with_ref:
        print(
            f"Computed AIS_bucket matches CSV store_AIS_bucket on "
            f"{match}/{with_ref} stores ({100*match/with_ref:.1f}%)"
        )


if __name__ == "__main__":
    main()
