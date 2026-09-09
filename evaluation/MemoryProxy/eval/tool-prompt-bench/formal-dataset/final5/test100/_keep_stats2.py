# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

TEAMS = Path(__file__).resolve().parent.parent / "teams"


def load_jsonl(path: Path):
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def sha_stats(items):
    ends = defaultdict(list)
    for cid, c, g in items:
        pid = g.get("pair_id")
        if pid:
            ends[pid].append(g)
    complete = mem_p = skill_p = 0
    for gs in ends.values():
        calls = [x for x in gs if x.get("should_call") is True]
        nocalls = [x for x in gs if x.get("should_call") is False]
        if calls and nocalls:
            complete += 1
            fam = calls[0].get("tool_family") or ""
            if fam == "memory":
                mem_p += 1
            elif fam == "skill":
                skill_p += 1
    dist = nat = 0
    for cid, c, g in items:
        if g.get("pair_id"):
            continue
        b = g.get("no_call_basis") or ""
        if b == "distractor":
            dist += 1
        elif b == "natural_coding":
            nat += 1
    return complete, mem_p, skill_p, dist, nat, len(items)


def main():
    extra_pairs = extra_cases = 0
    print(f"{'team':32} {'p1':3} {'p2':3} {'add':3} {'keep1':4} {'keep1+2':7}")
    for team_dir in sorted(p for p in TEAMS.iterdir() if p.is_dir()):
        data = team_dir / "data"
        if not (data / "cases.jsonl").exists():
            continue
        cases = {r["case_id"]: r for r in load_jsonl(data / "cases.jsonl")}
        gold = {r["case_id"]: r for r in load_jsonl(data / "gold.jsonl")}
        by = defaultdict(list)
        for cid, c in cases.items():
            g = gold.get(cid)
            if g:
                by[c.get("base_sha") or ""].append((cid, c, g))
        ranked = []
        for sha, items in by.items():
            p, m, s, d, n, ncase = sha_stats(items)
            ranked.append((p, m, s, d, n, ncase, sha, items))
        ranked.sort(reverse=True)
        if not ranked:
            continue
        p1, m1, s1, d1, n1, c1, sha1, _ = ranked[0]
        keep1 = p1 * 2 + d1 + min(4, n1)
        add = 0
        p2 = 0
        if len(ranked) > 1:
            p2 = ranked[1][0]
            add = p2  # only extra complete pairs
        extra_pairs += add
        extra_cases += add * 2
        print(f"{team_dir.name:32} {p1:3d} {p2:3d} {add:3d} {keep1:4d} {keep1+add*2:7d}")
    print(f"\nbase keep=773  + 2nd-SHA pairs only: +{extra_pairs} pairs (+{extra_cases} cases) => {773+extra_cases}")


if __name__ == "__main__":
    main()
