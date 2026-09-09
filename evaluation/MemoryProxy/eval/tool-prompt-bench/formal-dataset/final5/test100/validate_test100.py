# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> None:
    keep = [json.loads(l) for l in (ROOT / "keep-case-ids.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    by = defaultdict(list)
    for k in keep:
        by[k["team_id"]].append(k)
    bad = []
    files_pos = search_pos = 0
    for team, rows in by.items():
        data = ROOT / "teams" / team / "data"
        cases = {json.loads(l)["case_id"]: json.loads(l) for l in (data / "cases.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
        gold = {json.loads(l)["case_id"]: json.loads(l) for l in (data / "gold.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
        evid = {json.loads(l)["case_id"]: json.loads(l) for l in (data / "evidence.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
        if len(cases) != 10 or len(gold) != 10 or len(evid) != 10:
            bad.append(f"{team} counts {len(cases)} {len(gold)} {len(evid)}")
        assets = json.loads((data / "assets.json").read_text(encoding="utf-8"))
        skills = {s["id"]: s for s in assets["skills"]}
        pairs = defaultdict(list)
        for k in rows:
            cid = k["case_id"]
            g = gold[cid]
            if g["expected_sequence"] != k["planned_sequence"]:
                bad.append(f"{cid} seq mismatch")
            blob = " ".join(m["content"] for m in cases[cid]["messages"])
            if "tdai_" in blob or "should_call" in blob:
                bad.append(f"{cid} leak")
            if evid[cid].get("original_prompt") != cases[cid]["messages"][-1]["content"]:
                bad.append(f"{cid} evidence prompt")
            if k["role"].endswith("_pos") and "files" in k["role"]:
                files_pos += 1
                if g.get("target_resource_paths") != [k["planned_file_path"]]:
                    bad.append(f"{cid} files path")
                files = (skills.get(k["target_asset_id"]) or {}).get("files") or []
                if not any(f.get("path") == k["planned_file_path"] for f in files):
                    bad.append(f"{cid} asset file missing")
            if k["role"].endswith("_pos") and k["role"].startswith("skill_search"):
                search_pos += 1
            if k.get("pair_id") and k["role"] not in ("distractor", "natural"):
                pairs[k["pair_id"]].append(k)
        for pid, ks in pairs.items():
            pos = next(x for x in ks if x["role"].endswith("_pos"))
            neg = next(x for x in ks if x["role"].endswith("_neg"))
            q1 = cases[pos["case_id"]]["messages"][-1]["content"]
            q2 = cases[neg["case_id"]]["messages"][-1]["content"]
            if q1 != q2:
                bad.append(f"{pid} query")
    print(f"teams={len(by)} files_pos={files_pos} search_pos={search_pos} bad={len(bad)}")
    for b in bad:
        print(b)
    if bad:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
