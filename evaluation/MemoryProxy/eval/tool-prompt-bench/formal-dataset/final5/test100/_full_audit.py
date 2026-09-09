# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LEAK_RE = re.compile(r"tdai_|should_call|skill_view|skill_search|skill_files_read|target_asset", re.I)


def toks(s: str) -> set[str]:
    return {t.lower() for t in re.findall(r"[A-Za-z0-9_./:-]{6,}", s or "")}


def main() -> None:
    keep = [json.loads(l) for l in (ROOT / "keep-case-ids.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    windows = {json.loads(l)["case_id"]: json.loads(l) for l in (ROOT / "case-windows.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
    by = defaultdict(list)
    for k in keep:
        by[k["team_id"]].append(k)

    issues = []
    for team, rows in by.items():
        data = ROOT / "teams" / team / "data"
        cases = {json.loads(l)["case_id"]: json.loads(l) for l in (data / "cases.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
        gold = {json.loads(l)["case_id"]: json.loads(l) for l in (data / "gold.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
        evid = {json.loads(l)["case_id"]: json.loads(l) for l in (data / "evidence.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
        assets = json.loads((data / "assets.json").read_text(encoding="utf-8"))
        mem = {m["id"]: m["content"] for m in assets["memory"]}
        skills = {s["id"]: s for s in assets["skills"]}
        print("=" * 90)
        print(team)

        pairs = defaultdict(list)
        for k in rows:
            cid = k["case_id"]
            role = k["role"]
            c = cases[cid]
            g = gold[cid]
            q = c["messages"][-1]["content"]
            ctx = c["messages"][0]["content"] if len(c["messages"]) > 1 else ""
            blob = q + "\n" + ctx
            if LEAK_RE.search(blob):
                issues.append(f"{cid} tool-name leak")
            if g.get("expected_sequence") != k["planned_sequence"]:
                issues.append(f"{cid} gold seq != keep")
            if evid[cid].get("original_prompt") != q:
                issues.append(f"{cid} evidence prompt != query")
            win = windows.get(cid) or {}
            skill_name = k.get("target_skill_name")
            vis = set(win.get("visibleSkillNames") or [])
            if role.endswith("_pos") and skill_name:
                in8 = skill_name in vis
                if role.startswith("skill_view") and not in8:
                    issues.append(f"{cid} view but not in window {vis}")
                if role.startswith("skill_search") and in8:
                    issues.append(f"{cid} search but in window")

            target = k.get("target_asset_id")
            body = mem.get(target) if target in mem else (skills.get(target) or {}).get("content")
            files = (skills.get(target) or {}).get("files") or []
            att = "\n".join(f.get("content") or "" for f in files if f.get("path") != "LICENSE")

            if role.endswith("_neg") and target:
                if "files" in role:
                    if att and ctx.strip() not in att and att.strip() not in ctx:
                        # allow the tested sentence to be a subset
                        if not any(line.strip() and line.strip() in ctx for line in att.splitlines() if len(line.strip()) > 20):
                            issues.append(f"{cid} neg context not from attachment")
                elif target in mem:
                    if ctx.strip() != (body or "").strip():
                        issues.append(f"{cid} neg context != L1 content")
                else:
                    if ctx.strip() != (body or "").strip():
                        issues.append(f"{cid} neg context != skill body")

            if role.endswith("_pos") and "files" in role:
                path = k.get("planned_file_path")
                if g.get("target_resource_paths") != [path]:
                    issues.append(f"{cid} missing target_resource_paths")
                if not any(f.get("path") == path for f in files):
                    issues.append(f"{cid} assets missing {path}")
                if att and att.strip() and att.strip() in (body or ""):
                    issues.append(f"{cid} attachment copied into skill body")
                # query should not contain distinctive attachment tokens
                overlap = toks(att) & toks(q)
                # drop generic words
                overlap -= {"references", "license", "must", "never", "before", "after", "which", "exact"}
                if overlap:
                    issues.append(f"{cid} Q overlaps file tokens {sorted(overlap)[:8]}")

            if role.endswith("_pos") and target in mem and body:
                overlap = toks(body) & toks(q)
                overlap -= {"which", "locked", "forbid", "never", "must", "project", "repo"}
                heavy = [t for t in overlap if not t.startswith("http") and t not in {"unity", "forest", "code", "insights"}]
                if heavy:
                    print(f"  NOTE {cid} Q shares memory tokens {heavy[:8]}")

            if role.endswith("_pos") or role in ("distractor", "natural"):
                print(f"  [{role}] {cid}")
                print(f"    seq={g.get('expected_sequence')} Q={q[:140]}")

            if k.get("pair_id") and role not in ("distractor", "natural"):
                pairs[k["pair_id"]].append(k)

        for pid, ks in pairs.items():
            pos = next(x for x in ks if x["role"].endswith("_pos"))
            neg = next(x for x in ks if x["role"].endswith("_neg"))
            q1 = cases[pos["case_id"]]["messages"][-1]["content"]
            q2 = cases[neg["case_id"]]["messages"][-1]["content"]
            if q1 != q2:
                issues.append(f"{pid} query bytes differ")

    print("\n" + "=" * 90)
    print(f"ISSUES {len(issues)}")
    for i in issues:
        print(" -", i)


if __name__ == "__main__":
    main()
