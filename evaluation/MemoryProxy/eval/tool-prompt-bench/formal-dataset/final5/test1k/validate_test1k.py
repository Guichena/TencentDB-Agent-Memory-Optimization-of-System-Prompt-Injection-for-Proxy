# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def last_user(case: dict) -> str:
    for m in reversed(case.get("messages") or []):
        if m.get("role") == "user":
            return m.get("content") or ""
    return ""


def main() -> None:
    keep = load_jsonl(ROOT / "keep-case-ids.jsonl")
    windows = load_jsonl(ROOT / "case-windows.jsonl")
    win_by = {w["case_id"]: w for w in windows}
    bad = []
    if len(keep) != len(windows):
        bad.append(f"keep {len(keep)} windows {len(windows)}")
    by_team = defaultdict(list)
    for k in keep:
        by_team[k["team_id"]].append(k)
    overlay = 0
    unpaired = 0
    for team, rows in by_team.items():
        data = ROOT / "teams" / team / "data"
        cases = {r["case_id"]: r for r in load_jsonl(data / "cases.jsonl")}
        gold = {r["case_id"]: r for r in load_jsonl(data / "gold.jsonl")}
        evid = {r["case_id"]: r for r in load_jsonl(data / "evidence.jsonl")}
        n = len(rows)
        if len(cases) != n or len(gold) != n or len(evid) != n:
            bad.append(f"{team} counts cases={len(cases)} gold={len(gold)} evid={len(evid)} keep={n}")
        team_obj = json.loads((data / "team.json").read_text(encoding="utf-8"))
        if team_obj.get("case_count") != n:
            bad.append(f"{team} case_count {team_obj.get('case_count')} != {n}")
        pairs = defaultdict(list)
        for k in rows:
            cid = k["case_id"]
            if cid not in cases or cid not in gold or cid not in evid or cid not in win_by:
                bad.append(f"{cid} missing file")
                continue
            g = gold[cid]
            if k["planned_sequence"] != g.get("expected_sequence"):
                bad.append(f"{cid} seq keep!=gold {k['planned_sequence']} {g.get('expected_sequence')}")
            if k["planned_sequence"] != win_by[cid].get("derivedSequence"):
                bad.append(f"{cid} seq keep!=window")
            if (k.get("notes") or "").startswith("test100-overlay"):
                overlay += 1
            if g.get("should_call") is True and not g.get("pair_id"):
                unpaired += 1
                bad.append(f"{cid} unpaired CALL")
            if k.get("pair_id") and k["role"] not in ("distractor", "natural"):
                pairs[k["pair_id"]].append(k)
        for pid, ks in pairs.items():
            pos = [x for x in ks if x["role"].endswith("_pos")]
            neg = [x for x in ks if x["role"].endswith("_neg")]
            if len(pos) != 1 or len(neg) != 1:
                bad.append(f"{team} {pid} pos={len(pos)} neg={len(neg)}")
                continue
            q1 = last_user(cases[pos[0]["case_id"]])
            q2 = last_user(cases[neg[0]["case_id"]])
            if q1 != q2:
                bad.append(f"{pid} query mismatch")
    if overlay != 100:
        bad.append(f"overlay={overlay} != 100")
    if len(by_team) != 39:
        bad.append(f"teams={len(by_team)}")
    print(f"teams={len(by_team)} keep={len(keep)} overlay={overlay} unpaired_call={unpaired} bad={len(bad)}")
    for b in bad[:40]:
        print(b)
    if len(bad) > 40:
        print(f"... {len(bad) - 40} more")
    if bad:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
