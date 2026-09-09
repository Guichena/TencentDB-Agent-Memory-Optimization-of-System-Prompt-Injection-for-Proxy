# -*- coding: utf-8 -*-
"""Rebuild listing from LIVE assets so 39 teams can be rewritten in parallel.

8 skill *ids/names* stay as in the original catalog (case_id freeze).
Every description is read now from:
  1) final5/teams/<Team>/data/assets.json
  2) overlay test100/teams/<Team>/data/assets.json if present

Re-run after any team assets change. Does not edit final5/skill-catalog/.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FINAL5 = ROOT.parent
SRC_CAT = FINAL5 / "skill-catalog"
OUT_CAT = ROOT / "skill-catalog"


def load_desc_map() -> dict[tuple[str, str], str]:
    desc: dict[tuple[str, str], str] = {}
    for root in (FINAL5 / "teams", ROOT / "teams"):
        if not root.exists():
            continue
        for team_dir in root.iterdir():
            path = team_dir / "data" / "assets.json"
            if not path.exists():
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            for s in data.get("skills") or []:
                sid = s.get("id")
                if sid and s.get("description"):
                    desc[(team_dir.name, sid)] = s["description"]
                    if s.get("name"):
                        desc[(team_dir.name, s["name"])] = s["description"]
    return desc


def patch_skill(obj: dict, desc: dict[tuple[str, str], str]) -> bool:
    lid = obj.get("logicalAssetId") or obj.get("id")
    name = obj.get("runtimeName") or obj.get("name")
    team = obj.get("originTeamId")
    new = desc.get((team, lid)) or desc.get((team, name))
    if new and obj.get("description") != new:
        obj["description"] = new
        return True
    return False


def main() -> None:
    keep_ids = set()
    teams = set()
    for line in (ROOT / "keep-case-ids.jsonl").read_text(encoding="utf-8").splitlines():
        rec = json.loads(line)
        keep_ids.add(rec["case_id"])
        teams.add(rec["team_id"])
    desc = load_desc_map()
    print("live descriptions", len(desc))
    OUT_CAT.mkdir(parents=True, exist_ok=True)

    n_case = patched = 0
    case_out = []
    with (SRC_CAT / "case-skill-catalog.jsonl").open(encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            if rec.get("caseId") not in keep_ids:
                continue
            for s in rec.get("visibleSkills") or []:
                if patch_skill(s, desc):
                    patched += 1
            case_out.append(json.dumps(rec, ensure_ascii=False))
            n_case += 1
    if n_case != len(keep_ids) or len({json.loads(line)["caseId"] for line in case_out}) != len(keep_ids):
        raise ValueError("Missing or duplicate case bindings")

    cat_out = []
    with (SRC_CAT / "skill-catalogs.jsonl").open(encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            if rec.get("evaluationTeamId") not in teams:
                continue
            for s in rec.get("skills") or []:
                patch_skill(s, desc)
            cat_out.append(json.dumps(rec, ensure_ascii=False))
    hashes = {}
    updated_catalogs = []
    for line in cat_out:
        rec = json.loads(line)
        payload = {key: value for key, value in rec.items() if key != "catalogSha256"}
        rec["catalogSha256"] = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        hashes[rec["catalogId"]] = rec["catalogSha256"]
        updated_catalogs.append(json.dumps(rec, ensure_ascii=False))
    updated_cases = []
    for line in case_out:
        rec = json.loads(line)
        rec["catalogSha256"] = hashes[rec["catalogId"]]
        updated_cases.append(json.dumps(rec, ensure_ascii=False))
    (OUT_CAT / "case-skill-catalog.jsonl").write_text("\n".join(updated_cases) + "\n", encoding="utf-8")
    (OUT_CAT / "skill-catalogs.jsonl").write_text("\n".join(updated_catalogs) + "\n", encoding="utf-8")

    search_out = []
    with (SRC_CAT / "searchable-skills.jsonl").open(encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            patch_skill(rec, desc)
            search_out.append(json.dumps(rec, ensure_ascii=False))
    (OUT_CAT / "searchable-skills.jsonl").write_text("\n".join(search_out) + "\n", encoding="utf-8")

    (OUT_CAT / "README.md").write_text(
        "8 条 **id/name 固定**（case_id 抽签）。\n"
        "**description 现取**：final5/teams 全量 assets，test100/teams 覆盖已改的队。\n"
        "改任何一队 assets 后重跑本脚本，邻居队 listing 会跟上，可并行改 39 队。\n"
        "python test100/sync_listing_from_assets.py\n",
        encoding="utf-8",
    )
    print("case-skill-catalog", n_case, "patched-visible", patched, "catalogs", len(cat_out))


if __name__ == "__main__":
    main()
