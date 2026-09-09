# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
keep = [json.loads(l) for l in (ROOT / "keep-case-ids.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
print("keep", len(keep), dict(Counter(k["role"] for k in keep)))
print()
for k in keep:
    if not (k["role"].endswith("_pos") or k["role"] in ("distractor", "natural")):
        continue
    team = k["team_id"]
    cid = k["case_id"]
    data = ROOT / "teams" / team / "data"
    cases = {json.loads(l)["case_id"]: json.loads(l) for l in (data / "cases.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
    gold = {json.loads(l)["case_id"]: json.loads(l) for l in (data / "gold.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
    q = cases[cid]["messages"][-1]["content"]
    g = gold[cid]
    tag = k["role"]
    tgt = k.get("target_skill_name") or k.get("target_asset_id") or ""
    print(f"{team} | {tag} | {tgt}")
    print(f"  seq={g.get('expected_sequence')} Q={q[:140]}")
    print()
