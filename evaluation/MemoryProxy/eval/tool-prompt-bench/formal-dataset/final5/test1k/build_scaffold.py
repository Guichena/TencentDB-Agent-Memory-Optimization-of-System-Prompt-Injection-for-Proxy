# -*- coding: utf-8 -*-
"""test1k batch 0: keep filter, copy 39 teams, overlay test100 100 cases."""
from __future__ import annotations

import json
import shutil
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_TEAMS = ROOT / "teams"
SRC_CATALOG = ROOT / "skill-catalog"
TEST100 = ROOT / "test100"
OUT = Path(__file__).resolve().parent

TEST100_TEAMS = [
    "DVG-THREAD-04-TEAM-01",
    "T05",
    "dvg06_banzukesurfing",
    "dvg10_ultimate_utils",
    "dvg09_playbilling",
    "dvg03_gmdh",
    "dvg03_planpal",
    "dvg09_judgegpt",
    "dvg05_pbrudny_jobsforit",
    "dvg08_temporalio_temporal",
]

HOLE_FORCE = [
    "dvg06_cookies__c001",
    "dvg06_cookies__c002",
    "dvg06_cookies__c003",
    "dvg06_cookies__c004",
]


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def dump_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows),
        encoding="utf-8",
    )


def last_user_len(case: dict) -> int:
    msgs = case.get("messages") or []
    for m in reversed(msgs):
        if m.get("role") == "user":
            return len(m.get("content") or "")
    return 0


def index_by_id(rows: list[dict], key: str = "case_id") -> dict[str, dict]:
    return {r[key]: r for r in rows}


def team_dirs() -> list[Path]:
    return sorted(p for p in SRC_TEAMS.iterdir() if p.is_dir() and (p / "data" / "cases.jsonl").exists())


def complete_pairs_on_sha(
    items: list[tuple[str, dict, dict]],
) -> dict[str, list[str]]:
    ends: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for cid, case, gold in items:
        pid = gold.get("pair_id")
        if pid:
            ends[pid].append((cid, gold))
    complete: dict[str, list[str]] = {}
    for pid, gs in ends.items():
        calls = [cid for cid, g in gs if g.get("should_call") is True]
        nocalls = [cid for cid, g in gs if g.get("should_call") is False]
        if calls and nocalls:
            complete[pid] = [cid for cid, _ in gs]
    return complete


def select_keep_for_team(team: str, cases: dict[str, dict], gold: dict[str, dict]) -> tuple[list[str], str, dict]:
    by_sha: dict[str, list[tuple[str, dict, dict]]] = defaultdict(list)
    for cid, c in cases.items():
        g = gold.get(cid)
        if not g:
            continue
        by_sha[c.get("base_sha") or ""].append((cid, c, g))

    best_sha, best_n, best_pairs = "", -1, -1
    sha_complete: dict[str, dict[str, list[str]]] = {}
    for sha, items in by_sha.items():
        complete = complete_pairs_on_sha(items)
        sha_complete[sha] = complete
        n_pairs = len(complete)
        n_cases = len(items)
        if n_pairs > best_pairs or (n_pairs == best_pairs and n_cases > best_n):
            best_pairs = n_pairs
            best_n = n_cases
            best_sha = sha

    keep: set[str] = set()
    for complete in sha_complete.values():
        for cids in complete.values():
            keep.update(cids)

    dist: list[str] = []
    nats: list[tuple[int, str, str]] = []
    for cid, case, g in by_sha.get(best_sha, []):
        if g.get("pair_id"):
            continue
        if g.get("should_call") is True:
            continue
        basis = g.get("no_call_basis") or ""
        if basis == "distractor":
            dist.append(cid)
        elif basis == "natural_coding":
            nats.append((last_user_len(case), cid, cid))
    keep.update(dist)
    nats.sort()
    keep.update(cid for _, cid, _ in nats[:4])

    stats = {
        "team": team,
        "best_sha": (best_sha or "")[:12],
        "pairs_all_sha": sum(len(v) for v in sha_complete.values()),
        "dist": len(dist),
        "nat_kept": min(4, len(nats)),
        "nat_all_best": len(nats),
    }
    return sorted(keep), best_sha, stats


def skill_name_map(assets: dict) -> dict[str, str]:
    out = {}
    for s in assets.get("skills") or []:
        sid = s.get("id")
        name = s.get("name")
        if sid and name:
            out[sid] = name
        if name:
            out[name] = name
    return out


def role_from_gold(g: dict, visible: list[str] | None, skill_name: str | None) -> str:
    if g.get("should_call") is True:
        fam = g.get("tool_family") or ""
        seq = list(g.get("expected_sequence") or [])
        if fam == "memory":
            return "memory_pos"
        if "skill_files_read" in seq:
            if "skill_search" in seq:
                return "skill_search_files_pos"
            return "skill_view_files_pos"
        if "skill_search" in seq:
            return "skill_search_pos"
        return "skill_view_pos"
    basis = g.get("no_call_basis") or ""
    if basis == "distractor":
        return "distractor"
    if basis == "natural_coding":
        return "natural"
    if basis == "pair_context":
        return "pair_neg"
    return "natural"


def neg_role(pos_role: str) -> str:
    if pos_role.endswith("_pos"):
        return pos_role[:-4] + "_neg"
    return "memory_neg"


def load_catalog_rows(path: Path, case_ids: set[str]) -> dict[str, dict]:
    out = {}
    for rec in load_jsonl(path):
        cid = rec.get("caseId") or rec.get("case_id")
        if cid in case_ids:
            out[cid] = rec
    return out


def catalog_window(rec: dict) -> dict:
    vis = rec.get("visibleSkills") or []
    own, n1, n2 = [], [], []
    for s in vis:
        name = s.get("runtimeName")
        role = s.get("sourceRole")
        if role == "own":
            own.append(name)
        elif role == "next1":
            n1.append(name)
        elif role == "next2":
            n2.append(name)
    return {
        "catalogId": rec.get("catalogId"),
        "catalogIndex": rec.get("catalogIndex"),
        "catalogCount": rec.get("catalogCount"),
        "visibleSkillNames": rec.get("visibleSkillNames") or [],
        "ownVisible": own,
        "next1Names": n1,
        "next2Names": n2,
    }


def planned_seq(role: str, gold: dict) -> list[str]:
    if role.endswith("_neg") or role in ("distractor", "natural"):
        return []
    seq = list(gold.get("expected_sequence") or [])
    if seq:
        return seq
    if role.startswith("memory"):
        return ["tdai_memory_search"]
    return []


def main() -> None:
    overlay_keep = load_jsonl(TEST100 / "keep-case-ids.jsonl")
    overlay_by_id = {r["case_id"]: r for r in overlay_keep}
    overlay_ids = set(overlay_by_id)
    if len(overlay_ids) != 100:
        raise SystemExit(f"test100 keep count {len(overlay_ids)}")

    teams = team_dirs()
    if len(teams) != 39:
        raise SystemExit(f"expected 39 teams, got {len(teams)}")

    per_team_keep: dict[str, list[str]] = {}
    merged_cases: dict[str, dict[str, dict]] = {}
    merged_gold: dict[str, dict[str, dict]] = {}
    orig_gold: dict[str, dict[str, dict]] = {}
    orig_cases: dict[str, dict[str, dict]] = {}
    orig_evid: dict[str, dict[str, dict]] = {}
    force_added: list[str] = []
    team_stats = []

    for tdir in teams:
        team = tdir.name
        data = tdir / "data"
        cases = index_by_id(load_jsonl(data / "cases.jsonl"))
        gold = index_by_id(load_jsonl(data / "gold.jsonl"))
        evid = index_by_id(load_jsonl(data / "evidence.jsonl"))
        orig_cases[team] = cases
        orig_gold[team] = gold
        orig_evid[team] = evid
        keep_ids, best_sha, stats = select_keep_for_team(team, cases, gold)
        keep_set = set(keep_ids)
        for cid in overlay_ids:
            if overlay_by_id[cid]["team_id"] == team and cid not in keep_set:
                keep_set.add(cid)
                force_added.append(cid)
        if team == "dvg06_cookies":
            for cid in HOLE_FORCE:
                if cid not in keep_set:
                    keep_set.add(cid)
                    force_added.append(cid)
        per_team_keep[team] = sorted(keep_set)
        team_stats.append(stats)

    overlay_cases: dict[str, dict] = {}
    overlay_gold: dict[str, dict] = {}
    overlay_evid: dict[str, dict] = {}
    overlay_assets: dict[str, dict] = {}
    for team in TEST100_TEAMS:
        d = TEST100 / "teams" / team / "data"
        overlay_cases.update(index_by_id(load_jsonl(d / "cases.jsonl")))
        overlay_gold.update(index_by_id(load_jsonl(d / "gold.jsonl")))
        overlay_evid.update(index_by_id(load_jsonl(d / "evidence.jsonl")))
        overlay_assets[team] = json.loads((d / "assets.json").read_text(encoding="utf-8"))

    dangling_dropped: list[str] = []
    for team, keep_ids in per_team_keep.items():
        gold = dict(orig_gold[team])
        for cid in keep_ids:
            if cid in overlay_gold:
                gold[cid] = overlay_gold[cid]
        merged_gold[team] = gold
        cases = dict(orig_cases[team])
        for cid in keep_ids:
            if cid in overlay_cases:
                cases[cid] = overlay_cases[cid]
        merged_cases[team] = cases

        by_pid: dict[str, list[str]] = defaultdict(list)
        for cid in keep_ids:
            g = gold.get(cid) or {}
            pid = g.get("pair_id")
            if pid:
                by_pid[pid].append(cid)
        drop: set[str] = set()
        for pid, cids in by_pid.items():
            calls = [c for c in cids if gold[c].get("should_call") is True]
            nocalls = [c for c in cids if gold[c].get("should_call") is False]
            if calls and nocalls:
                continue
            if calls and not nocalls:
                for c in calls:
                    if c not in overlay_ids:
                        drop.add(c)
            if nocalls and not calls:
                for c in nocalls:
                    if c not in overlay_ids:
                        drop.add(c)
        if drop:
            dangling_dropped.extend(sorted(drop))
            per_team_keep[team] = [c for c in keep_ids if c not in drop]

    all_keep: list[tuple[str, str]] = []
    for tdir in teams:
        team = tdir.name
        for cid in per_team_keep[team]:
            all_keep.append((team, cid))
    all_ids = [cid for _, cid in all_keep]
    if len(all_ids) != len(set(all_ids)):
        raise SystemExit("duplicate case_id in keep")

    src_cat = load_catalog_rows(SRC_CATALOG / "case-skill-catalog.jsonl", set(all_ids))
    t100_cat = load_catalog_rows(TEST100 / "skill-catalog" / "case-skill-catalog.jsonl", overlay_ids)
    catalog: dict[str, dict] = dict(src_cat)
    catalog.update(t100_cat)
    missing_cat = [cid for cid in all_ids if cid not in catalog]
    if missing_cat:
        raise SystemExit(f"catalog missing {missing_cat[:10]} n={len(missing_cat)}")

    teams_out = OUT / "teams"
    if teams_out.exists():
        shutil.rmtree(teams_out)
    teams_out.mkdir(parents=True)

    keep_rows: list[dict] = []
    window_rows: list[dict] = []
    totals = defaultdict(int)

    for tdir in teams:
        team = tdir.name
        src = tdir / "data"
        dst = teams_out / team / "data"
        dst.mkdir(parents=True)
        keep_ids = per_team_keep[team]
        if team in overlay_assets:
            (dst / "assets.json").write_text(
                json.dumps(overlay_assets[team], ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        else:
            shutil.copy2(src / "assets.json", dst / "assets.json")
        shutil.copy2(src / "team.json", dst / "team.json")
        team_obj = json.loads((dst / "team.json").read_text(encoding="utf-8"))
        team_obj["case_count"] = len(keep_ids)
        (dst / "team.json").write_text(
            json.dumps(team_obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

        assets = json.loads((dst / "assets.json").read_text(encoding="utf-8"))
        names = skill_name_map(assets)

        cases_out = []
        gold_out = []
        evid_out = []
        gold_now = merged_gold[team]
        cases_now = merged_cases[team]
        evid_now = dict(orig_evid[team])
        evid_now.update({cid: overlay_evid[cid] for cid in keep_ids if cid in overlay_evid})

        pair_pos_role: dict[str, str] = {}
        for cid in keep_ids:
            g = gold_now[cid]
            win = catalog_window(catalog[cid])
            skill = None
            tids = g.get("target_asset_ids") or []
            tid = tids[0] if tids else None
            if tid:
                skill = names.get(tid)
            ov = overlay_by_id.get(cid)
            if ov and ov.get("target_skill_name"):
                skill = ov["target_skill_name"]
            role = role_from_gold(g, win["visibleSkillNames"], skill)
            if ov:
                role = ov["role"]
                tid = ov.get("target_asset_id") or tid
                skill = ov.get("target_skill_name") if ov.get("target_skill_name") is not None else skill
            if role.endswith("_pos") and g.get("pair_id"):
                pair_pos_role[g["pair_id"]] = role
            # stash for second pass
            cases_now[cid]["_role_tmp"] = role
            cases_now[cid]["_tid_tmp"] = tid
            cases_now[cid]["_skill_tmp"] = skill

        for cid in keep_ids:
            g = gold_now[cid]
            c = cases_now[cid]
            e = evid_now.get(cid)
            if not e:
                raise SystemExit(f"missing evidence {cid}")
            role = c["_role_tmp"]
            if role == "pair_neg":
                pos = pair_pos_role.get(g.get("pair_id") or "")
                role = neg_role(pos or "memory_pos")
            ov = overlay_by_id.get(cid)
            notes = ""
            file_path = None
            seq = planned_seq(role, g)
            if ov:
                notes = "test100-overlay"
                extra = (ov.get("notes") or "").strip()
                if extra:
                    notes = f"test100-overlay; {extra}"
                file_path = ov.get("planned_file_path")
                seq = ov.get("planned_sequence") or seq
                role = ov["role"]
            elif g.get("target_resource_paths"):
                file_path = g["target_resource_paths"][0]

            keep_rows.append(
                {
                    "team_id": team,
                    "case_id": cid,
                    "role": role,
                    "pair_id": g.get("pair_id"),
                    "target_asset_id": c.get("_tid_tmp"),
                    "target_skill_name": c.get("_skill_tmp"),
                    "planned_sequence": seq,
                    "planned_file_path": file_path,
                    "notes": notes,
                }
            )
            win = catalog_window(catalog[cid])
            skill = c.get("_skill_tmp")
            target_visible = (skill in win["visibleSkillNames"]) if skill else None
            window_rows.append(
                {
                    "case_id": cid,
                    "team_id": team,
                    "catalogId": win["catalogId"],
                    "catalogIndex": win["catalogIndex"],
                    "visibleSkillNames": win["visibleSkillNames"],
                    "ownVisible": win["ownVisible"],
                    "next1Names": win["next1Names"],
                    "next2Names": win["next2Names"],
                    "targetSkillName": skill,
                    "targetVisible": target_visible,
                    "derivedSequence": seq,
                    "plannedFilePath": file_path,
                    "role": role,
                }
            )
            cc = {k: v for k, v in c.items() if not k.startswith("_")}
            cases_out.append(cc)
            gold_out.append(g)
            evid_out.append(e)

            totals["keep"] += 1
            if role.endswith("_pos") and role.startswith("memory"):
                totals["mem"] += 1
                totals["pairs"] += 1
            elif role.endswith("_pos") and role.startswith("skill"):
                totals["skill"] += 1
                totals["pairs"] += 1
            elif role == "distractor":
                totals["dist"] += 1
            elif role == "natural":
                totals["nat"] += 1
            if notes.startswith("test100-overlay"):
                totals["overlay"] += 1

        dump_jsonl(dst / "cases.jsonl", cases_out)
        dump_jsonl(dst / "gold.jsonl", gold_out)
        dump_jsonl(dst / "evidence.jsonl", evid_out)

    dump_jsonl(OUT / "keep-case-ids.jsonl", keep_rows)
    dump_jsonl(OUT / "case-windows.jsonl", window_rows)

    cat_out = OUT / "skill-catalog"
    if cat_out.exists():
        shutil.rmtree(cat_out)
    cat_out.mkdir()
    keep_set = set(all_ids)
    cat_lines = []
    for cid in all_ids:
        cat_lines.append(catalog[cid])
    dump_jsonl(cat_out / "case-skill-catalog.jsonl", cat_lines)
    shutil.copy2(SRC_CATALOG / "skill-catalogs.jsonl", cat_out / "skill-catalogs.jsonl")
    shutil.copy2(SRC_CATALOG / "searchable-skills.jsonl", cat_out / "searchable-skills.jsonl")
    manifest = json.loads((SRC_CATALOG / "manifest.json").read_text(encoding="utf-8"))
    manifest["counts"]["cases"] = totals["keep"]
    manifest["test1kKeep"] = True
    (cat_out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (cat_out / "README.md").write_text(
        "8 条 id/name 冻死（case_id 抽签）。description 尚未从 test1k assets 全量同步。\n"
        "评测不要用 final5/skill-catalog/。资产齐后跑 sync_listing_from_assets.py。\n",
        encoding="utf-8",
    )

    (OUT / "README.md").write_text(
        """# test1k

约 1100 条对照集。不改 `final5/teams/` 原 1560，不改冻死的 `test100/`。

## 状态

- 批 0 脚手架已完成：39 队已拷、keep 已裁、test100 十队资产 + 已完成 10 条已覆盖。
- notes 含 `test100-overlay` 的 Case **禁止再改**。
- 其余 keep 行仍是旧 Query/Gold，按 TEST1K-PLAN 批 1/2/3 改。
- listing description 尚未全量同步。

## 再生

`python test1k/build_scaffold.py` 会清空 `test1k/teams/`。资产改过之后不要重跑。
""",
        encoding="utf-8",
    )

    zero_mem = []
    zero_sk = []
    by_team = defaultdict(lambda: {"mem": 0, "sk": 0, "n": 0})
    for r in keep_rows:
        by_team[r["team_id"]]["n"] += 1
        if r["role"] == "memory_pos":
            by_team[r["team_id"]]["mem"] += 1
        if r["role"].endswith("_pos") and r["role"].startswith("skill"):
            by_team[r["team_id"]]["sk"] += 1
    for team, s in sorted(by_team.items()):
        if s["mem"] == 0:
            zero_mem.append(f"{team}:{s['n']}")
        if s["sk"] == 0:
            zero_sk.append(f"{team}:{s['n']}")

    print(f"teams={len(teams)}")
    print(
        f"keep_total={totals['keep']} pairs={totals['pairs']} "
        f"CALL memory={totals['mem']} skill={totals['skill']} "
        f"distractor={totals['dist']} natural={totals['nat']} overlay={totals['overlay']}"
    )
    print(f"force_added={len(force_added)} {force_added}")
    print(f"dangling_dropped={len(dangling_dropped)} {dangling_dropped}")
    print(f"zero_memory_pairs {zero_mem}")
    print(f"zero_skill_pairs {zero_sk}")
    if totals["keep"] < 1000 or totals["keep"] > 1250:
        raise SystemExit(f"keep_total {totals['keep']} outside 1000-1250")
    if totals["overlay"] != 100:
        raise SystemExit(f"overlay {totals['overlay']} != 100")


if __name__ == "__main__":
    main()
