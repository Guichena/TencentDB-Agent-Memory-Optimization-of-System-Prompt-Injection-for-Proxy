# -*- coding: utf-8 -*-
"""Heuristic false-CALL flags. Full proof needs a git checkout at base_sha (not in this tree)."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
UNIQ = re.compile(r"\b[A-Z][A-Za-z0-9_\-]{5,}\b|`[^`]{3,}`|[A-Za-z]+#[A-Za-z0-9_\-]+|[\u4e00-\u9fff]{1,8}号")


def loadj(p):
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def main():
    n_call = n_ok = 0
    weak = []
    for team_dir in sorted((ROOT / "teams").iterdir()):
        if not team_dir.is_dir():
            continue
        assets = json.loads((team_dir / "data" / "assets.json").read_text(encoding="utf-8"))
        mem = {m["id"]: m for m in assets.get("memory") or []}
        skills = {s["id"]: s for s in assets.get("skills") or []}
        for g in loadj(team_dir / "data" / "gold.jsonl"):
            if g.get("should_call") is not True:
                continue
            n_call += 1
            tid = (g.get("target_asset_ids") or [None])[0]
            blob = ""
            if g.get("tool_family") == "memory":
                blob = (mem.get(tid) or {}).get("content") or ""
            else:
                sk = skills.get(tid)
                if not sk:
                    for s in assets.get("skills") or []:
                        if s.get("name") == tid:
                            sk = s
                            break
                if sk:
                    blob = (sk.get("content") or "") + " ".join(
                        f.get("content") or "" for f in sk.get("files") or []
                    )
            marks = UNIQ.findall(blob)
            if marks:
                n_ok += 1
            else:
                weak.append(g["case_id"])
    print(f"CALL={n_call} unique_token_ok={n_ok} weak={len(weak)}")
    for w in weak[:30]:
        print(" ", w)
    print("No git checkouts in this tree; cannot grep repos. Weak list is heuristic only.")


if __name__ == "__main__":
    main()
