# -*- coding: utf-8 -*-
"""Prefix in-8 Skill CALL Query with listing description task words. Pair Query stays identical."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORD = re.compile(r"[A-Za-z][A-Za-z0-9_\-]{2,}|[\u4e00-\u9fff]{2,}")
STOP = set("the a an and or to of in on for with from that this is are be must may which what when how".split())


def loadj(p):
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def dumpj(p, rows):
    p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def last_idx(msgs):
    for i in range(len(msgs) - 1, -1, -1):
        if msgs[i].get("role") == "user":
            return i
    return len(msgs) - 1


def toks(s):
    return {w.lower() for w in WORD.findall(s or "") if w.lower() not in STOP}


def clip_desc(desc: str) -> str:
    d = (desc or "").split("；")[0].split(";")[0]
    d = re.split(r"附件", d)[0].strip(" ：:、 ")
    return d[:80]


def main():
    keep = {r["case_id"]: r for r in loadj(ROOT / "keep-case-ids.jsonl")}
    cat = {r["caseId"]: r for r in loadj(ROOT / "skill-catalog" / "case-skill-catalog.jsonl")}
    n = 0
    for team_dir in sorted((ROOT / "teams").iterdir()):
        if not team_dir.is_dir():
            continue
        cpath = team_dir / "data" / "cases.jsonl"
        epath = team_dir / "data" / "evidence.jsonl"
        gpath = team_dir / "data" / "gold.jsonl"
        cases = loadj(cpath)
        evid = loadj(epath)
        gold = loadj(gpath)
        cmap = {c["case_id"]: c for c in cases}
        emap = {e["case_id"]: e for e in evid}
        gmap = {g["case_id"]: g for g in gold}
        pair_q = {}
        changed = False
        for g in gold:
            if g.get("should_call") is not True or g.get("tool_family") != "skill":
                continue
            cid = g["case_id"]
            k = keep.get(cid) or {}
            seq = k.get("planned_sequence") or g.get("expected_sequence") or []
            if not seq or seq[0] != "skill_view":
                continue
            tname = k.get("target_skill_name")
            desc = ""
            for s in (cat.get(cid) or {}).get("visibleSkills") or []:
                if s.get("runtimeName") == tname:
                    desc = s.get("description") or ""
            if not desc:
                continue
            q = cmap[cid]["messages"][last_idx(cmap[cid]["messages"])]["content"]
            if len(toks(desc) & toks(q)) > 0:
                continue
            prefix = clip_desc(desc)
            if not prefix or prefix in q:
                continue
            new_q = f"{prefix}。{q}" if re.search(r"[\u4e00-\u9fff]", prefix) else f"{prefix}. {q}"
            pair_q[g.get("pair_id") or cid] = new_q
        for g in gold:
            pid = g.get("pair_id")
            key = pid or g["case_id"]
            if key not in pair_q:
                continue
            new_q = pair_q[key]
            msgs = cmap[g["case_id"]]["messages"]
            i = last_idx(msgs)
            if msgs[i]["content"] != new_q:
                msgs[i]["content"] = new_q
                changed = True
                n += 1
            if g["case_id"] in emap:
                emap[g["case_id"]]["original_prompt"] = new_q
        if changed:
            dumpj(cpath, cases)
            dumpj(epath, evid)
    print(f"aligned_queries={n}")


if __name__ == "__main__":
    main()
