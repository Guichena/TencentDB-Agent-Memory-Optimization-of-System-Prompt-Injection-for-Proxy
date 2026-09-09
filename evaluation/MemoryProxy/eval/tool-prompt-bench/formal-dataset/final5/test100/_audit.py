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
    for team, rows in by.items():
        data = ROOT / "teams" / team / "data"
        cases = {json.loads(l)["case_id"]: json.loads(l) for l in (data / "cases.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
        gold = {json.loads(l)["case_id"]: json.loads(l) for l in (data / "gold.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()}
        assets = json.loads((data / "assets.json").read_text(encoding="utf-8"))
        mem = {m["id"]: m["content"] for m in assets["memory"]}
        skills = {s["id"]: s for s in assets["skills"]}
        print("=" * 88)
        print(team)
        for k in rows:
            cid = k["case_id"]
            role = k["role"]
            if not role.endswith("_pos") and role not in ("distractor", "natural"):
                continue
            c = cases[cid]
            g = gold[cid]
            msgs = c["messages"]
            query = msgs[-1]["content"]
            ctx = msgs[0]["content"] if len(msgs) > 1 else ""
            target = k.get("target_asset_id")
            body = ""
            files = []
            if target in mem:
                body = mem[target]
            elif target in skills:
                body = skills[target].get("content") or ""
                files = skills[target].get("files") or []
            print(f"\n[{role}] {cid}")
            print(f"  gold={g['expected_sequence']} target={target}")
            print(f"  Q: {query}")
            if ctx:
                print(f"  C: {ctx[:160].replace(chr(10),' / ')}")
            if body:
                print(f"  asset: {body[:180].replace(chr(10),' / ')}")
            if files:
                for f in files:
                    print(f"  file {f.get('path')}: {(f.get('content') or '')[:140].replace(chr(10),' / ')}")
            # leak heuristics
            flags = []
            qlow = query.lower()
            if target in mem:
                for token in ("forest spirit", "evil spirits", "flame keeper", "analysis.ts", "auth-token", "push_to_hub", "sweep_config.yaml"):
                    if token in qlow and token in (body or "").lower():
                        flags.append(f"Q contains memory token {token!r}")
            if "files" in role:
                if not files:
                    flags.append("NO files[]")
                else:
                    att = " ".join((f.get("content") or "") for f in files if f.get("path") != "LICENSE")
                    # query should not copy the unique line
                    for line in att.splitlines():
                        line = line.strip()
                        if len(line) > 40 and line.lower() in qlow:
                            flags.append("Q copies attachment line")
            if role.startswith("skill") and any(x in qlow for x in ("ontriggerstay", "raycast", "document.cookie", "useeffect(..., [])")):
                flags.append("Q may leak skill step")
            if flags:
                print("  FLAG:", "; ".join(flags))


if __name__ == "__main__":
    main()
