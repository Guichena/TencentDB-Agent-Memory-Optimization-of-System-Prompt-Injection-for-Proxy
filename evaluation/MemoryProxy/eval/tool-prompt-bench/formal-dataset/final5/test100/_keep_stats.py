# -*- coding: utf-8 -*-
"""Count keep-SHA cases for ~1k plan. Read-only on final5/teams."""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

TEAMS = Path(__file__).resolve().parent.parent / "teams"


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def main() -> None:
    rows = []
    totals = Counter()
    mem_call = skill_call = pair_n = dist = nat = other_nocall = 0
    skill_seq = Counter()

    for team_dir in sorted(p for p in TEAMS.iterdir() if p.is_dir()):
        data = team_dir / "data"
        if not (data / "cases.jsonl").exists():
            continue
        cases = {r["case_id"]: r for r in load_jsonl(data / "cases.jsonl")}
        gold = {r["case_id"]: r for r in load_jsonl(data / "gold.jsonl")}
        by_sha: dict[str, list] = defaultdict(list)
        for cid, c in cases.items():
            g = gold.get(cid)
            if not g:
                continue
            sha = c.get("base_sha") or ""
            by_sha[sha].append((cid, c, g))

        best_sha, best_pairs, best_info = "", -1, None
        for sha, items in by_sha.items():
            ends = defaultdict(list)
            for cid, c, g in items:
                pid = g.get("pair_id")
                if pid:
                    ends[pid].append(g)
            complete = 0
            mem_p = skill_p = 0
            for pid, gs in ends.items():
                calls = [x for x in gs if x.get("should_call") is True]
                nocalls = [x for x in gs if x.get("should_call") is False]
                if len(calls) >= 1 and len(nocalls) >= 1:
                    complete += 1
                    fam = (calls[0].get("tool_family") or "")
                    if fam == "memory":
                        mem_p += 1
                    elif fam == "skill":
                        skill_p += 1
            if complete > best_pairs:
                best_pairs = complete
                best_sha = sha
                n_dist = n_nat = n_other = 0
                seqs = Counter()
                for cid, c, g in items:
                    if g.get("pair_id"):
                        continue
                    basis = g.get("no_call_basis") or ""
                    if basis == "distractor":
                        n_dist += 1
                    elif basis == "natural_coding":
                        n_nat += 1
                    elif g.get("should_call") is False:
                        n_other += 1
                for cid, c, g in items:
                    if g.get("should_call") and g.get("tool_family") == "skill":
                        seq = tuple(g.get("expected_sequence") or [])
                        seqs[str(list(seq))] += 1
                keep_nat = min(4, n_nat)
                keep_n = complete * 2 + n_dist + keep_nat
                best_info = {
                    "team": team_dir.name,
                    "sha": (best_sha or "")[:12],
                    "sha_cases": len(items),
                    "pairs": complete,
                    "mem_pairs": mem_p,
                    "skill_pairs": skill_p,
                    "distractor": n_dist,
                    "natural_all": n_nat,
                    "natural_keep": keep_nat,
                    "other_nocall": n_other,
                    "keep": keep_n,
                    "skill_seqs": seqs,
                }
        if best_info:
            rows.append(best_info)
            totals["keep"] += best_info["keep"]
            totals["pairs"] += best_info["pairs"]
            mem_call += best_info["mem_pairs"]
            skill_call += best_info["skill_pairs"]
            pair_n += best_info["pairs"]
            dist += best_info["distractor"]
            nat += best_info["natural_keep"]
            other_nocall += best_info["other_nocall"]
            skill_seq.update(best_info["skill_seqs"])

    print(f"teams={len(rows)}")
    print(f"keep_total={totals['keep']}  pairs={totals['pairs']} ({totals['pairs']*2} cases)")
    print(f"CALL memory={mem_call} skill={skill_call}  (pair CALL={mem_call+skill_call})")
    print(f"NO_CALL pair_neg={pair_n} distractor={dist} natural_keep={nat} unpaired_other={other_nocall}")
    call = mem_call + skill_call
    nocall = pair_n + dist + nat
    print(f"CALL={call} NO_CALL={nocall} ratio={call}:{nocall}")
    print("skill sequences on keep SHA (CALL rows):")
    for k, v in skill_seq.most_common():
        print(f"  {v:4d}  {k}")
    print()
    print(f"{'team':32} {'keep':4} {'pair':4} {'mem':3} {'sk':3} {'dist':4} {'nat':3} sha_cases")
    for r in sorted(rows, key=lambda x: -x["keep"]):
        print(
            f"{r['team']:32} {r['keep']:4d} {r['pairs']:4d} {r['mem_pairs']:3d} {r['skill_pairs']:3d} "
            f"{r['distractor']:4d} {r['natural_keep']:3d} {r['sha_cases']:3d}"
        )


if __name__ == "__main__":
    main()
