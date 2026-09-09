# -*- coding: utf-8 -*-
"""Sync keep-case-ids.jsonl + case-windows.jsonl from live gold after A/B rewrite."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def dump_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def skill_maps(assets: dict) -> tuple[dict[str, str], dict[str, str]]:
    id_to_name, name_to_id = {}, {}
    for s in assets.get("skills") or []:
        if s.get("id") and s.get("name"):
            id_to_name[s["id"]] = s["name"]
            name_to_id[s["name"]] = s["id"]
    return id_to_name, name_to_id


def pos_role(seq: list[str], family: str) -> str:
    if family == "memory":
        return "memory_pos"
    if "skill_files_read" in seq:
        if "skill_search" in seq:
            return "skill_search_files_pos"
        return "skill_view_files_pos"
    if "skill_search" in seq:
        return "skill_search_pos"
    return "skill_view_pos"


def neg_role(pos: str) -> str:
    return pos[:-4] + "_neg" if pos.endswith("_pos") else "memory_neg"


def main() -> None:
    keep = load_jsonl(ROOT / "keep-case-ids.jsonl")
    windows = load_jsonl(ROOT / "case-windows.jsonl")
    win_by = {w["case_id"]: w for w in windows}
    gold_all: dict[str, dict] = {}
    assets_by_team: dict[str, dict] = {}
    for team_dir in (ROOT / "teams").iterdir():
        if not team_dir.is_dir():
            continue
        assets_by_team[team_dir.name] = json.loads((team_dir / "data" / "assets.json").read_text(encoding="utf-8"))
        for g in load_jsonl(team_dir / "data" / "gold.jsonl"):
            gold_all[g["case_id"]] = g

    pair_pos: dict[str, str] = {}
    for row in keep:
        g = gold_all[row["case_id"]]
        if g.get("should_call") is True and g.get("pair_id"):
            seq = list(g.get("expected_sequence") or [])
            pair_pos[g["pair_id"]] = pos_role(seq, g.get("tool_family") or "")

    n_role = n_seq = n_tgt = 0
    for row in keep:
        cid = row["case_id"]
        g = gold_all[cid]
        team = row["team_id"]
        id_to_name, name_to_id = skill_maps(assets_by_team[team])
        w = win_by[cid]
        vis = list(w.get("visibleSkillNames") or [])
        old_role, old_seq, old_tid = row["role"], list(row.get("planned_sequence") or []), row.get("target_asset_id")

        if g.get("should_call") is True:
            seq = list(g.get("expected_sequence") or [])
            fam = g.get("tool_family") or ""
            role = pos_role(seq, fam)
            tid = (g.get("target_asset_ids") or [None])[0]
            skill = id_to_name.get(tid) or (tid if tid in name_to_id else row.get("target_skill_name"))
            if fam == "memory":
                skill = None
            file_path = (g.get("target_resource_paths") or [None])[0]
            row.update(
                {
                    "role": role,
                    "pair_id": g.get("pair_id"),
                    "target_asset_id": tid,
                    "target_skill_name": skill,
                    "planned_sequence": seq,
                    "planned_file_path": file_path,
                }
            )
            w["role"] = role
            w["derivedSequence"] = seq
            w["targetSkillName"] = skill
            w["targetVisible"] = (skill in vis) if skill else None
            w["plannedFilePath"] = file_path
        else:
            basis = g.get("no_call_basis") or ""
            pid = g.get("pair_id")
            if pid and pid in pair_pos:
                role = neg_role(pair_pos[pid])
                partner = next(
                    (gold_all[k["case_id"]] for k in keep if k.get("pair_id") == pid and gold_all[k["case_id"]].get("should_call") is True),
                    None,
                )
                tid = (partner.get("target_asset_ids") or [None])[0] if partner else row.get("target_asset_id")
                skill = id_to_name.get(tid) if tid else row.get("target_skill_name")
                file_path = (partner.get("target_resource_paths") or [None])[0] if partner else None
            elif basis == "distractor":
                role, tid, skill, file_path = "distractor", None, None, None
                pid = None
            elif basis == "natural_coding":
                role, tid, skill, file_path = "natural", None, None, None
                pid = None
            else:
                role, tid, skill, file_path = "natural", None, None, None
                pid = None
            row.update(
                {
                    "role": role,
                    "pair_id": pid,
                    "target_asset_id": tid,
                    "target_skill_name": skill if role.endswith("_neg") else None,
                    "planned_sequence": [],
                    "planned_file_path": file_path if role.endswith("_neg") else None,
                }
            )
            w["role"] = role
            w["derivedSequence"] = []
            w["targetSkillName"] = row.get("target_skill_name")
            w["targetVisible"] = (row["target_skill_name"] in vis) if row.get("target_skill_name") else None
            w["plannedFilePath"] = row.get("planned_file_path")

        if row["role"] != old_role:
            n_role += 1
        if row["planned_sequence"] != old_seq:
            n_seq += 1
        if row.get("target_asset_id") != old_tid:
            n_tgt += 1

    dump_jsonl(ROOT / "keep-case-ids.jsonl", keep)
    dump_jsonl(ROOT / "case-windows.jsonl", [win_by[r["case_id"]] for r in keep])
    print(f"role_changed={n_role} seq_changed={n_seq} target_changed={n_tgt} keep={len(keep)}")


if __name__ == "__main__":
    main()
