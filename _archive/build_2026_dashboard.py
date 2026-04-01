#!/usr/bin/env python3
"""
Process store_level_data_for_2026.csv and produce 2026_dashboard_data.js.

Pre-computes all metrics for 4 periods: Full (all), Jan, Feb, Mar.
The dashboard switches between these data sets via a period selector.

Filtering:
  - fold_number <= 12
  - BU in {BGM, CoreElectronics, EmergingElectronics, Furniture, Home, Large, Lifestyle}
  - Top 99% impression stores (cumulative cutoff, computed on full period)
"""

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INPUT_CSV = ROOT / "_archive" / "store_level_data_for_2026.csv"
STORE_NAME_CSV = ROOT / "_archive" / "store_to_store_name_mapping.csv"
OUTPUT_JS = ROOT / "2026_dashboard_data.js"

VALID_BUS = {"BGM", "CoreElectronics", "EmergingElectronics", "Furniture", "Home", "Large", "Lifestyle"}
R0_ORDER = ["0–25%", "25–40%", "40–50%", "50–60%", "60–70%", "70–80%", ">80%"]
AIS_ORDER = ["<5%", "5–15%", "15–25%", "25–30%", "30–35%", "35–40%", "40–45%", ">45%"]

PERIODS = {
    "all":     lambda d: True,
    "2026-01": lambda d: d.startswith("2026-01"),
    "2026-02": lambda d: d.startswith("2026-02"),
    "2026-03": lambda d: d.startswith("2026-03"),
}
PERIOD_LABELS = {"all": "Full Period", "2026-01": "January 2026", "2026-02": "February 2026", "2026-03": "March 2026"}


def r0_bucket(r0_pct):
    if r0_pct < 25: return "0–25%"
    if r0_pct < 40: return "25–40%"
    if r0_pct < 50: return "40–50%"
    if r0_pct < 60: return "50–60%"
    if r0_pct < 70: return "60–70%"
    if r0_pct < 80: return "70–80%"
    return ">80%"


def ais_bucket(ais_pct):
    if ais_pct < 5: return "<5%"
    if ais_pct < 15: return "5–15%"
    if ais_pct < 25: return "15–25%"
    if ais_pct < 30: return "25–30%"
    if ais_pct < 35: return "30–35%"
    if ais_pct < 40: return "35–40%"
    if ais_pct < 45: return "40–45%"
    return ">45%"


def compute_r0(fold_data):
    num = den = 0.0
    for fold, d in fold_data.items():
        if d["ai"] > 0 and d["oi"] > 0 and d["oc"] > 0:
            w = 1.0 / (fold * fold)
            num += w * (d["ac"] / d["ai"]) / (d["oc"] / d["oi"])
            den += w
    return (num / den * 100.0) if den else None


def safe_int(v):
    try: return int(v)
    except: return 0


def new_agg():
    return {"ac": 0, "ai": 0, "oc": 0, "oi": 0, "ak": 0, "ok": 0}


def add_agg(dst, ac, ai, oc, oi, ak, ok):
    dst["ac"] += ac; dst["ai"] += ai; dst["oc"] += oc; dst["oi"] += oi; dst["ak"] += ak; dst["ok"] += ok


def load_store_names():
    mapping = {}
    if STORE_NAME_CSV.exists():
        with STORE_NAME_CSV.open(newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                store = (row.get("store") or "").strip()
                name = (row.get("store_name") or "").strip()
                if store and name:
                    mapping[store] = name
    return mapping


def main():
    print("Loading store name mapping...")
    store_names = load_store_names()
    print(f"  Loaded {len(store_names)} store names")

    print("Pass 1: finding top-99% stores...")
    store_imp = defaultdict(int)
    store_bu = {}
    with INPUT_CSV.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            bu = (row.get("bu") or "").strip()
            if bu not in VALID_BUS: continue
            fold = safe_int(row.get("fold_number"))
            if fold < 1 or fold > 12: continue
            store = (row.get("store_path") or "").strip()
            if not store: continue
            store_imp[store] += safe_int(row.get("ads_impressions")) + safe_int(row.get("org_impressions"))
            if store not in store_bu: store_bu[store] = bu

    sorted_stores = sorted(store_imp.items(), key=lambda x: -x[1])
    total_imp_all = sum(v for _, v in sorted_stores)
    cutoff = total_imp_all * 0.99
    cumul = 0
    valid_stores = set()
    for s, imp in sorted_stores:
        cumul += imp; valid_stores.add(s)
        if cumul >= cutoff: break

    print(f"  Total stores: {len(sorted_stores)}, kept: {len(valid_stores)}")
    print(f"  Total impressions: {total_imp_all:,}")

    # Pass 2: full aggregation into period-specific buckets
    # Keys: (period, store, fold), (period, store), (period, bu, fold), (period, bu),
    #        (period, fold), (period), (date, fold), (date), (date, bu, fold), (date, bu)
    print("Pass 2: aggregating into period buckets...")

    psf = defaultdict(new_agg)   # (period, store, fold)
    ps  = defaultdict(new_agg)   # (period, store)
    pbf = defaultdict(new_agg)   # (period, bu, fold)
    pb  = defaultdict(new_agg)   # (period, bu)
    pf  = defaultdict(new_agg)   # (period, fold)
    pt  = defaultdict(new_agg)   # (period,) totals

    # daily time series
    daf = defaultdict(new_agg)   # (date, fold)
    dat = defaultdict(new_agg)   # (date,)
    dbf = defaultdict(new_agg)   # (date, bu, fold)
    dbt = defaultdict(new_agg)   # (date, bu)

    all_dates = set()

    with INPUT_CSV.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            bu = (row.get("bu") or "").strip()
            if bu not in VALID_BUS: continue
            fold = safe_int(row.get("fold_number"))
            if fold < 1 or fold > 12: continue
            store = (row.get("store_path") or "").strip()
            if not store or store not in valid_stores: continue
            date = (row.get("event_date") or "").strip()
            all_dates.add(date)

            ac = safe_int(row.get("ads_cabn"))
            ai = safe_int(row.get("ads_impressions"))
            ak = safe_int(row.get("ads_clicks"))
            oc = safe_int(row.get("org_cabn"))
            oi = safe_int(row.get("org_impressions"))
            ok = safe_int(row.get("org_clicks"))

            for pid, match_fn in PERIODS.items():
                if not match_fn(date): continue
                add_agg(psf[(pid, store, fold)], ac, ai, oc, oi, ak, ok)
                add_agg(ps[(pid, store)], ac, ai, oc, oi, ak, ok)
                add_agg(pbf[(pid, bu, fold)], ac, ai, oc, oi, ak, ok)
                add_agg(pb[(pid, bu)], ac, ai, oc, oi, ak, ok)
                add_agg(pf[(pid, fold)], ac, ai, oc, oi, ak, ok)
                add_agg(pt[(pid,)], ac, ai, oc, oi, ak, ok)

            add_agg(daf[(date, fold)], ac, ai, oc, oi, ak, ok)
            add_agg(dat[(date,)], ac, ai, oc, oi, ak, ok)
            add_agg(dbf[(date, bu, fold)], ac, ai, oc, oi, ak, ok)
            add_agg(dbt[(date, bu)], ac, ai, oc, oi, ak, ok)

    print("Computing metrics per period...")

    period_data = {}
    for pid in PERIODS:
        tot = pt.get((pid,), new_agg())
        all_imp = tot["ai"] + tot["oi"]
        overall_r0 = compute_r0({f: pf[(pid, f)] for f in range(1, 13) if (pid, f) in pf})
        n_stores = sum(1 for s in valid_stores if (pid, s) in ps)

        # dates in this period
        p_dates = sorted(d for d in all_dates if PERIODS[pid](d))

        overall = {
            "stores": n_stores,
            "all_impressions": all_imp,
            "ads_imp": tot["ai"],
            "R0": round(overall_r0, 4) if overall_r0 else 0,
            "AIS": round(100.0 * tot["ai"] / all_imp, 4) if all_imp else 0,
            "ads_CTR": round(100.0 * tot["ak"] / tot["ai"], 4) if tot["ai"] else 0,
            "org_CTR": round(100.0 * tot["ok"] / tot["oi"], 4) if tot["oi"] else 0,
            "ads_CABN_clk": round(100.0 * tot["ac"] / tot["ak"], 4) if tot["ak"] else 0,
            "org_CABN_clk": round(100.0 * tot["oc"] / tot["ok"], 4) if tot["ok"] else 0,
            "date_min": p_dates[0] if p_dates else "",
            "date_max": p_dates[-1] if p_dates else "",
            "n_days": len(p_dates),
        }

        # BU metrics
        bu_metrics = []
        for bu in sorted(VALID_BUS):
            d = pb.get((pid, bu), new_agg())
            a_imp = d["ai"] + d["oi"]
            bu_r0 = compute_r0({f: pbf[(pid, bu, f)] for f in range(1, 13) if (pid, bu, f) in pbf})
            bu_stores = sum(1 for s in valid_stores if store_bu.get(s) == bu and (pid, s) in ps)
            bu_metrics.append({
                "bu": bu, "stores": bu_stores, "all_impressions": a_imp, "ads_imp": d["ai"],
                "R0": round(bu_r0, 4) if bu_r0 else 0,
                "AIS": round(100.0 * d["ai"] / a_imp, 4) if a_imp else 0,
                "ads_CTR": round(100.0 * d["ak"] / d["ai"], 4) if d["ai"] else 0,
                "org_CTR": round(100.0 * d["ok"] / d["oi"], 4) if d["oi"] else 0,
                "ads_CABN_clk": round(100.0 * d["ac"] / d["ak"], 4) if d["ak"] else 0,
                "org_CABN_clk": round(100.0 * d["oc"] / d["ok"], 4) if d["ok"] else 0,
            })

        # Store-level metrics
        store_list = []
        for s in valid_stores:
            if (pid, s) not in ps: continue
            d = ps[(pid, s)]
            a_imp = d["ai"] + d["oi"]
            if a_imp == 0: continue
            s_r0 = compute_r0({f: psf[(pid, s, f)] for f in range(1, 13) if (pid, s, f) in psf})
            s_ais = 100.0 * d["ai"] / a_imp
            rb = r0_bucket(s_r0) if s_r0 is not None else "0–25%"
            ab = ais_bucket(s_ais)
            store_list.append({
                "b": store_bu.get(s, ""), "s": s,
                "r": round(s_r0, 2) if s_r0 is not None else 0,
                "a": round(s_ais, 2),
                "ac": round(100.0 * d["ak"] / d["ai"], 4) if d["ai"] else 0,
                "oc": round(100.0 * d["ok"] / d["oi"], 4) if d["oi"] else 0,
                "acb": round(100.0 * d["ac"] / d["ak"], 4) if d["ak"] else 0,
                "ocb": round(100.0 * d["oc"] / d["ok"], 4) if d["ok"] else 0,
                "ai": d["ai"], "oi": d["oi"], "ti": a_imp,
                "ak": d["ak"], "ok": d["ok"], "acn": d["ac"], "ocn": d["oc"],
                "rb": rb, "ab": ab,
            })
        store_list.sort(key=lambda x: -x["ti"])

        # Distributions
        def build_dist(stores_sub):
            r0m = defaultdict(lambda: {"c": 0, "i": 0})
            am = defaultdict(lambda: {"c": 0, "i": 0})
            for s in stores_sub:
                r0m[s["rb"]]["c"] += 1; r0m[s["rb"]]["i"] += s["ti"]
                am[s["ab"]]["c"] += 1; am[s["ab"]]["i"] += s["ti"]
            tc = len(stores_sub)
            ti = sum(s["ti"] for s in stores_sub)
            r0d = [{"bucket": b, "stores": r0m[b]["c"], "store_pct": round(100.0*r0m[b]["c"]/tc,2) if tc else 0,
                     "impressions": r0m[b]["i"], "impr_pct": round(100.0*r0m[b]["i"]/ti,2) if ti else 0} for b in R0_ORDER]
            aisd = [{"bucket": b, "stores": am[b]["c"], "store_pct": round(100.0*am[b]["c"]/tc,2) if tc else 0,
                      "impressions": am[b]["i"], "impr_pct": round(100.0*am[b]["i"]/ti,2) if ti else 0} for b in AIS_ORDER]
            return r0d, aisd, tc, ti

        r0_dist, ais_dist, _, _ = build_dist(store_list)

        # Crosstab
        crosstab = []
        for ab in AIS_ORDER:
            row_d = {"ais_bucket": ab}
            for rb in R0_ORDER:
                matched = [s for s in store_list if s["ab"] == ab and s["rb"] == rb]
                row_d[rb + "_count"] = len(matched)
                imp = sum(s["ti"] for s in matched)
                row_d[rb + "_imp_pct"] = round(100.0 * imp / all_imp, 2) if all_imp else 0
            crosstab.append(row_d)

        # BU × R0
        bu_r0_table = []
        for bu in sorted(VALID_BUS):
            bu_s = [s for s in store_list if s["b"] == bu]
            t_imp = sum(s["ti"] for s in bu_s)
            row_d = {"bu": bu}
            for rb in R0_ORDER:
                bs = [s for s in bu_s if s["rb"] == rb]
                row_d[rb + "_count"] = len(bs)
                imp = sum(s["ti"] for s in bs)
                row_d[rb + "_imp_pct"] = round(100.0 * imp / t_imp, 2) if t_imp else 0
            bu_r0_table.append(row_d)

        # Per-BU bucket data for charts
        bu_bucket = {"Overall": {"r0_dist": r0_dist, "ais_dist": ais_dist, "store_count": len(store_list), "total_imp": all_imp}}
        for bu in sorted(VALID_BUS):
            bu_s = [s for s in store_list if s["b"] == bu]
            rd, ad, sc, ti = build_dist(bu_s)
            bu_bucket[bu] = {"r0_dist": rd, "ais_dist": ad, "store_count": sc, "total_imp": ti}

        period_data[pid] = {
            "overall": overall, "bu_metrics": bu_metrics,
            "r0_dist": r0_dist, "ais_dist": ais_dist,
            "crosstab": crosstab, "bu_r0": bu_r0_table,
            "r0_order": R0_ORDER, "ais_order": AIS_ORDER,
            "BU_BUCKET_DATA": bu_bucket,
            "ALL_STORES": store_list,
        }
        print(f"  {pid}: {n_stores} stores, {all_imp:,} impressions, R0={overall['R0']}")

    # Daily time series
    print("Building daily time series...")
    sorted_dates = sorted(all_dates)
    ts_daily = []
    for date in sorted_dates:
        d = dat.get((date,), new_agg())
        a_imp = d["ai"] + d["oi"]
        d_r0 = compute_r0({f: daf[(date, f)] for f in range(1, 13) if (date, f) in daf})
        ts_daily.append({
            "date": date,
            "R0": round(d_r0, 2) if d_r0 else None,
            "AIS": round(100.0 * d["ai"] / a_imp, 2) if a_imp else 0,
            "all_imp": a_imp, "ads_imp": d["ai"],
            "ads_CTR": round(100.0 * d["ak"] / d["ai"], 4) if d["ai"] else 0,
            "org_CTR": round(100.0 * d["ok"] / d["oi"], 4) if d["oi"] else 0,
            "ads_CABN": round(100.0 * d["ac"] / d["ak"], 4) if d["ak"] else 0,
            "org_CABN": round(100.0 * d["oc"] / d["ok"], 4) if d["ok"] else 0,
        })

    ts_daily_bu = []
    for date in sorted_dates:
        for bu in sorted(VALID_BUS):
            if (date, bu) not in dbt: continue
            d = dbt[(date, bu)]
            a_imp = d["ai"] + d["oi"]
            d_r0 = compute_r0({f: dbf[(date, bu, f)] for f in range(1, 13) if (date, bu, f) in dbf})
            ts_daily_bu.append({
                "date": date, "bu": bu,
                "R0": round(d_r0, 2) if d_r0 else None,
                "AIS": round(100.0 * d["ai"] / a_imp, 2) if a_imp else 0,
                "all_imp": a_imp,
                "ads_CTR": round(100.0 * d["ak"] / d["ai"], 4) if d["ai"] else 0,
                "org_CTR": round(100.0 * d["ok"] / d["oi"], 4) if d["oi"] else 0,
                "ads_CABN": round(100.0 * d["ac"] / d["ak"], 4) if d["ak"] else 0,
                "org_CABN": round(100.0 * d["oc"] / d["ok"], 4) if d["ok"] else 0,
            })

    # Build store name mapping for only valid stores
    sn_map = {}
    for s in valid_stores:
        if s in store_names:
            sn_map[s] = store_names[s]
    print(f"  Store names matched: {len(sn_map)} / {len(valid_stores)}")

    # Write JS
    print("Writing JS...")
    js = "var PERIODS=" + json.dumps(period_data, separators=(",", ":")) + ";\n"
    js += "var PERIOD_LABELS=" + json.dumps(PERIOD_LABELS, separators=(",", ":")) + ";\n"
    js += "var TS_DAILY=" + json.dumps(ts_daily, separators=(",", ":")) + ";\n"
    js += "var TS_DAILY_BU=" + json.dumps(ts_daily_bu, separators=(",", ":")) + ";\n"
    js += "var STORE_NAMES=" + json.dumps(sn_map, separators=(",", ":")) + ";\n"
    OUTPUT_JS.write_text(js, encoding="utf-8")
    sz = OUTPUT_JS.stat().st_size / 1024 / 1024
    print(f"Wrote {OUTPUT_JS.name} ({sz:.1f} MB)")
    print(f"  Daily rows: {len(ts_daily)}, Daily BU rows: {len(ts_daily_bu)}")


if __name__ == "__main__":
    main()
