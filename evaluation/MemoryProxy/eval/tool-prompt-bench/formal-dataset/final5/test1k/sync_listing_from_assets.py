# -*- coding: utf-8 -*-
"""Patch 8-listing descriptions from test1k live assets. ids/names/order frozen."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_CAT = ROOT / "skill-catalog"


def load_desc_map() -> dict[tuple[str, str], str]:
    desc: dict[tuple[str, str], str] = {}
    teams = ROOT / "teams"
    for team_dir in teams.iterdir():
        path = team_dir / "data" / "assets.json"
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for s in data.get("skills") or []:
            sid = s.get("id")
            if sid and s.get("description"):
                desc[(team_dir.name, sid)] = s["description"]
            if s.get("name") and s.get("description"):
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
    patched = 0
    case_out = []
    for rec in [json.loads(l) for l in (OUT_CAT / "case-skill-catalog.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]:
        if rec.get("caseId") not in keep_ids:
            continue
        for s in rec.get("visibleSkills") or []:
            if patch_skill(s, desc):
                patched += 1
        case_out.append(rec)
    if {r["caseId"] for r in case_out} != keep_ids:
        missing = keep_ids - {r["caseId"] for r in case_out}
        raise SystemExit(f"catalog missing {len(missing)} e.g. {list(missing)[:5]}")

    cat_out = []
    hashes = {}
    for rec in [json.loads(l) for l in (OUT_CAT / "skill-catalogs.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]:
        if rec.get("evaluationTeamId") not in teams:
            continue
        for s in rec.get("skills") or []:
            patch_skill(s, desc)
        payload = {k: v for k, v in rec.items() if k != "catalogSha256"}
        rec["catalogSha256"] = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        hashes[rec["catalogId"]] = rec["catalogSha256"]
        cat_out.append(rec)
    for rec in case_out:
        rec["catalogSha256"] = hashes[rec["catalogId"]]

    search_out = []
    for rec in [json.loads(l) for l in (OUT_CAT / "searchable-skills.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]:
        patch_skill(rec, desc)
        search_out.append(rec)

    def dump(path: Path, rows: list[dict]) -> None:
        path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")

    dump(OUT_CAT / "case-skill-catalog.jsonl", case_out)
    dump(OUT_CAT / "skill-catalogs.jsonl", cat_out)
    dump(OUT_CAT / "searchable-skills.jsonl", search_out)
    (OUT_CAT / "README.md").write_text(
        "8 条 id/name 冻死。description 已从 test1k/teams assets.json 同步。\n"
        "python test1k/sync_listing_from_assets.py\n",
        encoding="utf-8",
    )
    print(f"cases={len(case_out)} patched_visible={patched} catalogs={len(cat_out)}")


if __name__ == "__main__":
    main()
