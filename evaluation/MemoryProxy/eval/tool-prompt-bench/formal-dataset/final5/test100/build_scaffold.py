# -*- coding: utf-8 -*-
"""Build test100 scaffold: copy 10 teams, trim to frozen ids, write windows."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_TEAMS = ROOT / "teams"
CATALOG = ROOT / "skill-catalog" / "case-skill-catalog.jsonl"
OUT = Path(__file__).resolve().parent

TEAMS = [
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


def seq(role: str) -> list[str]:
    pos = role.endswith("_pos")
    if role.startswith("memory"):
        return ["tdai_memory_search"] if pos else []
    if role.startswith("skill_view_files"):
        return ["skill_view", "skill_files_read"] if pos else []
    if role.startswith("skill_search_files"):
        return ["skill_search", "skill_view_by_id", "skill_files_read"] if pos else []
    if role.startswith("skill_view"):
        return ["skill_view"] if pos else []
    if role.startswith("skill_search"):
        return ["skill_search", "skill_view_by_id"] if pos else []
    return []


def K(
    case_id: str,
    role: str,
    target: str | None = None,
    skill: str | None = None,
    file_path: str | None = None,
    notes: str = "",
) -> dict:
    return {
        "case_id": case_id,
        "role": role,
        "target_asset_id": target,
        "target_skill_name": skill,
        "file_path": file_path,
        "notes": notes,
    }


KEEP: dict[str, list[dict]] = {
    "DVG-THREAD-04-TEAM-01": [
        K("DVG-T04-T01-C001", "memory_pos", "DVG-THREAD-04-TEAM-01__memory__game_concept"),
        K("DVG-T04-T01-C002", "memory_neg", "DVG-THREAD-04-TEAM-01__memory__game_concept"),
        K("DVG-T04-T01-C029", "memory_pos", "DVG-THREAD-04-TEAM-01__memory__terrain_design"),
        K("DVG-T04-T01-C030", "memory_neg", "DVG-THREAD-04-TEAM-01__memory__terrain_design"),
        K(
            "DVG-T04-T01-C032",
            "skill_view_pos",
            "DVG-THREAD-04-TEAM-01__skill__enemy_behavior",
            "unity-enemy-behavior",
            notes="in8; old gold was search",
        ),
        K(
            "DVG-T04-T01-C033",
            "skill_view_neg",
            "DVG-THREAD-04-TEAM-01__skill__enemy_behavior",
            "unity-enemy-behavior",
        ),
        K(
            "DVG-T04-T01-C010",
            "skill_view_files_pos",
            "DVG-THREAD-04-TEAM-01__skill__enemy_behavior",
            "unity-enemy-behavior",
            "references/sight-gate.md",
            notes="repurpose old memory pair_c010; files on enemy_behavior",
        ),
        K(
            "DVG-T04-T01-C011",
            "skill_view_files_neg",
            "DVG-THREAD-04-TEAM-01__skill__enemy_behavior",
            "unity-enemy-behavior",
            "references/sight-gate.md",
        ),
        K("DVG-T04-T01-C003", "distractor"),
        K("DVG-T04-T01-C006", "natural"),
    ],
    "T05": [
        K("c_05ac2a5c98a1a3a6", "memory_pos", "T05__memory__coverage_priorities"),
        K("c_0712f427d1b1435e", "memory_neg", "T05__memory__coverage_priorities"),
        K("c_fe64ad918b22bc8b", "memory_pos", "T05__memory__provider_transport"),
        K("c_d647e6e21bfc139e", "memory_neg", "T05__memory__provider_transport"),
        K(
            "c_0c03d7a87bb604cc",
            "skill_view_files_pos",
            "T05__skill__test_llm_providers",
            "test-llm-providers",
            "references/provider-fetch-checklist.md",
            notes="cat02 in8",
        ),
        K(
            "c_f21f92f9641e55da",
            "skill_view_files_neg",
            "T05__skill__test_llm_providers",
            "test-llm-providers",
            "references/provider-fetch-checklist.md",
        ),
        K(
            "c_cfcd7dfe4c055f59",
            "skill_search_pos",
            "T05__skill__test_coverage",
            "expand-vitest-coverage",
            notes="cat01 in8=false; old gold was view",
        ),
        K(
            "c_3381e45f2f915dcb",
            "skill_search_neg",
            "T05__skill__test_coverage",
            "expand-vitest-coverage",
        ),
        K("c_5e9acd1796d52837", "distractor", notes="skip live LLM tests"),
        K("c_dfee5b3f52b92c37", "natural", notes="package.json test scripts"),
    ],
    "dvg06_banzukesurfing": [
        K("dvg06_banzukesurfing__c001", "memory_pos", "dvg06_banzukesurfing__memory__localstorage_patterns"),
        K("dvg06_banzukesurfing__c002", "memory_neg", "dvg06_banzukesurfing__memory__localstorage_patterns"),
        K("dvg06_banzukesurfing__c003", "memory_pos", "dvg06_banzukesurfing__memory__jest_setup"),
        K("dvg06_banzukesurfing__c004", "memory_neg", "dvg06_banzukesurfing__memory__jest_setup"),
        K(
            "dvg06_banzukesurfing__c013",
            "skill_search_pos",
            "dvg06_banzukesurfing__skill__jest_test_refactor",
            "jest-test-refactor",
            notes="cat01 in8=false; old gold was view",
        ),
        K(
            "dvg06_banzukesurfing__c014",
            "skill_search_neg",
            "dvg06_banzukesurfing__skill__jest_test_refactor",
            "jest-test-refactor",
        ),
        K(
            "dvg06_banzukesurfing__c027",
            "skill_view_files_pos",
            "dvg06_banzukesurfing__skill__localstorage_debug",
            "localstorage-debug",
            "references/key-trace.md",
            notes="cat02 in8; files here. dropped initialize-lifecycle to fit 10",
        ),
        K(
            "dvg06_banzukesurfing__c028",
            "skill_view_files_neg",
            "dvg06_banzukesurfing__skill__localstorage_debug",
            "localstorage-debug",
            "references/key-trace.md",
        ),
        K("dvg06_banzukesurfing__c005", "distractor", notes="was memory CALL pair_m03; rewrite as distractor"),
        K("dvg06_banzukesurfing__c007", "natural", notes="was memory CALL pair_m04; rewrite as natural"),
    ],
    "dvg10_ultimate_utils": [
        K("dvg10_ultimate_utils__m01_call", "memory_pos", "mem_hf_training_preferences"),
        K("dvg10_ultimate_utils__m01_none", "memory_neg", "mem_hf_training_preferences"),
        K("dvg10_ultimate_utils__m02_call", "memory_pos", "mem_wandb_setup"),
        K("dvg10_ultimate_utils__m02_none", "memory_neg", "mem_wandb_setup"),
        K(
            "dvg10_ultimate_utils__s02_call",
            "skill_view_files_pos",
            "dvg10_ultimate_utils__skill__wandb-sweep-workflow",
            "wandb-sweep-workflow",
            "references/sweep-local.md",
            notes="cat01 in8; dropped s01 hf-training-setup case to fit 10",
        ),
        K(
            "dvg10_ultimate_utils__s02_none",
            "skill_view_files_neg",
            "dvg10_ultimate_utils__skill__wandb-sweep-workflow",
            "wandb-sweep-workflow",
            "references/sweep-local.md",
        ),
        K(
            "dvg10_ultimate_utils__s05_call",
            "skill_search_pos",
            "dvg10_ultimate_utils__skill__vectoring-research-planning",
            "vectoring-research-planning",
            notes="RETARGET from ml-patent-writing; cat02 in8=false for vectoring",
        ),
        K(
            "dvg10_ultimate_utils__s05_none",
            "skill_search_neg",
            "dvg10_ultimate_utils__skill__vectoring-research-planning",
            "vectoring-research-planning",
        ),
        K("dvg10_ultimate_utils__none_02", "distractor", notes="was natural; rewrite as similar-topic distractor"),
        K("dvg10_ultimate_utils__none_01", "natural"),
    ],
    "dvg09_playbilling": [
        K(
            "dvg09_playbilling__m01_call",
            "memory_pos",
            "mem_security_practice",
            notes="RETARGET from mem_billing_setup; lock pubkey-from-Unity",
        ),
        K("dvg09_playbilling__m01_none", "memory_neg", "mem_security_practice"),
        K("dvg09_playbilling__m03_call", "memory_pos", "mem_subscription_policy"),
        K("dvg09_playbilling__m03_none", "memory_neg", "mem_subscription_policy"),
        K(
            "dvg09_playbilling__s_pilot01_call",
            "skill_view_pos",
            "dvg09_playbilling__skill__unity-bridge-setup",
            "unity-bridge-setup",
            notes="cat02 in8; old gold was search",
        ),
        K(
            "dvg09_playbilling__s_pilot01_none",
            "skill_view_neg",
            "dvg09_playbilling__skill__unity-bridge-setup",
            "unity-bridge-setup",
        ),
        K(
            "dvg09_playbilling__m04_call",
            "skill_search_files_pos",
            "dvg09_playbilling__skill__add-acknowledgement",
            "add-acknowledgement",
            "references/ack-states.md",
            notes="cat02 in8=false; old gold was view; files on ack",
        ),
        K(
            "dvg09_playbilling__m04_none",
            "skill_search_files_neg",
            "dvg09_playbilling__skill__add-acknowledgement",
            "add-acknowledgement",
            "references/ack-states.md",
        ),
        K("dvg09_playbilling__none_nat08", "distractor", notes="plugin user sets BillingClient; similar skill"),
        K("dvg09_playbilling__none_nat01", "natural"),
    ],
    "dvg03_gmdh": [
        K("dvg03_gmdh__m01_call", "memory_pos", "mem_csv_protocol"),
        K("dvg03_gmdh__m01_none", "memory_neg", "mem_csv_protocol"),
        K("dvg03_gmdh__k03_call", "memory_pos", "mem_website_structure"),
        K("dvg03_gmdh__k03_none", "memory_neg", "mem_website_structure"),
        K(
            "dvg03_gmdh__s01_call",
            "skill_search_pos",
            "skill_csv_batch_processing",
            "csv-batch-processing",
            notes="cat02 in8=false; old gold was view. dropped biographical case to fit 10",
        ),
        K(
            "dvg03_gmdh__s01_none",
            "skill_search_neg",
            "skill_csv_batch_processing",
            "csv-batch-processing",
        ),
        K(
            "dvg03_gmdh__s_sa01",
            "skill_view_files_pos",
            "skill_dh_data_cleaning",
            "dh-data-cleaning",
            "references/date-checks.md",
            notes="cat02 in8",
        ),
        K(
            "dvg03_gmdh__none_sa02",
            "skill_view_files_neg",
            "skill_dh_data_cleaning",
            "dh-data-cleaning",
            "references/date-checks.md",
        ),
        K("dvg03_gmdh__none_sa03", "distractor"),
        K("dvg03_gmdh__none_sa05", "natural"),
    ],
    "dvg03_planpal": [
        K("dvg03_planpal__m02_call", "memory_pos", "mem_auth_strategy"),
        K("dvg03_planpal__m02_none", "memory_neg", "mem_auth_strategy"),
        K("dvg03_planpal__m03_call", "memory_pos", "mem_api_pattern"),
        K("dvg03_planpal__m03_none", "memory_neg", "mem_api_pattern"),
        K(
            "dvg03_planpal__s01_call",
            "skill_view_files_pos",
            "skill_cookie_debug",
            "cookie-debug",
            "references/httponly-trap.md",
            notes="cat01 in8",
        ),
        K(
            "dvg03_planpal__s01_none",
            "skill_view_files_neg",
            "skill_cookie_debug",
            "cookie-debug",
            "references/httponly-trap.md",
        ),
        K(
            "dvg03_planpal__s02_call",
            "skill_search_pos",
            "skill_nextjs_api_setup",
            "nextjs-api-setup",
            notes="RETARGET from nestjs-auth; cat02 in8=false for nextjs-api-setup",
        ),
        K(
            "dvg03_planpal__s02_none",
            "skill_search_neg",
            "skill_nextjs_api_setup",
            "nextjs-api-setup",
        ),
        K("dvg03_planpal__n06_none", "distractor"),
        K("dvg03_planpal__n04_none", "natural"),
    ],
    "dvg09_judgegpt": [
        K("dvg09_judgegpt__m02_call", "memory_pos", "mem_api_key_handling"),
        K("dvg09_judgegpt__m02_none", "memory_neg", "mem_api_key_handling"),
        K("dvg09_judgegpt__m04_call", "memory_pos", "mem_code_style"),
        K("dvg09_judgegpt__m04_none", "memory_neg", "mem_code_style"),
        K(
            "dvg09_judgegpt__s01_call",
            "skill_view_files_pos",
            "dvg09_judgegpt__skill__add-api-key-input",
            "add-api-key-input",
            "references/api-key-input.md",
            notes="RETARGET from setup-sqlite-db; cat01 in8",
        ),
        K(
            "dvg09_judgegpt__s01_none",
            "skill_view_files_neg",
            "dvg09_judgegpt__skill__add-api-key-input",
            "add-api-key-input",
            "references/api-key-input.md",
        ),
        K(
            "dvg09_judgegpt__s03_call",
            "skill_search_pos",
            "dvg09_judgegpt__skill__add-api-key-input",
            "add-api-key-input",
            notes="cat02 in8=false; same skill as s01",
        ),
        K(
            "dvg09_judgegpt__s03_none",
            "skill_search_neg",
            "dvg09_judgegpt__skill__add-api-key-input",
            "add-api-key-input",
        ),
        K("dvg09_judgegpt__none_nat01", "distractor"),
        K("dvg09_judgegpt__none_nat03", "natural"),
    ],
    "dvg05_pbrudny_jobsforit": [
        K("dvg05_pbrudny_jobsforit__m02_call", "memory_pos", "mem_commit_convention"),
        K("dvg05_pbrudny_jobsforit__m02_none", "memory_neg", "mem_commit_convention"),
        K("dvg05_pbrudny_jobsforit__m04_call", "memory_pos", "mem_ui_migration"),
        K("dvg05_pbrudny_jobsforit__m04_none", "memory_neg", "mem_ui_migration"),
        K(
            "dvg05_pbrudny_jobsforit__s01_call",
            "skill_view_files_pos",
            "component-refactor",
            "component-refactor",
            "references/hooks-conversion.md",
            notes="cat01 in8; files on this skill not markdown-doc (10-slot)",
        ),
        K(
            "dvg05_pbrudny_jobsforit__s01_none",
            "skill_view_files_neg",
            "component-refactor",
            "component-refactor",
            "references/hooks-conversion.md",
        ),
        K(
            "dvg05_pbrudny_jobsforit__s02_call",
            "skill_search_pos",
            "package-cleanup",
            "package-cleanup",
            notes="cat02 in8=false",
        ),
        K(
            "dvg05_pbrudny_jobsforit__s02_none",
            "skill_search_neg",
            "package-cleanup",
            "package-cleanup",
        ),
        K("dvg05_pbrudny_jobsforit__n01_none", "distractor"),
        K("dvg05_pbrudny_jobsforit__n03_none", "natural"),
    ],
    "dvg08_temporalio_temporal": [
        K("dvg08_temporalio_temporal__m009", "memory_pos", "mem_naming_convention"),
        K("dvg08_temporalio_temporal__m010", "memory_neg", "mem_naming_convention"),
        K("dvg08_temporalio_temporal__m011", "memory_pos", "mem_acronym_handling"),
        K("dvg08_temporalio_temporal__m012", "memory_neg", "mem_acronym_handling"),
        K(
            "dvg08_temporalio_temporal__s019",
            "skill_view_pos",
            "dvg08_temporalio_temporal__skill__python-file-renaming",
            "python-file-renaming",
            notes="cat01 in8",
        ),
        K(
            "dvg08_temporalio_temporal__s020",
            "skill_view_neg",
            "dvg08_temporalio_temporal__skill__python-file-renaming",
            "python-file-renaming",
        ),
        K(
            "dvg08_temporalio_temporal__s021",
            "skill_search_files_pos",
            "dvg08_temporalio_temporal__skill__camel-to-snake-conversion",
            "camel-to-snake-conversion",
            "references/acronyms.md",
            notes="cat01 in8=false; old gold was view; files=acronym table",
        ),
        K(
            "dvg08_temporalio_temporal__s022",
            "skill_search_files_neg",
            "dvg08_temporalio_temporal__skill__camel-to-snake-conversion",
            "camel-to-snake-conversion",
            "references/acronyms.md",
        ),
        K("dvg08_temporalio_temporal__n008", "distractor"),
        K("dvg08_temporalio_temporal__n001", "natural"),
    ],
}


def load_catalog(case_ids: set[str]) -> dict[str, dict]:
    out = {}
    with CATALOG.open(encoding="utf-8") as f:
        for line in f:
            rec = json.loads(line)
            cid = rec["caseId"]
            if cid not in case_ids:
                continue
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
            out[cid] = {
                "catalogId": rec.get("catalogId"),
                "catalogIndex": rec.get("catalogIndex"),
                "catalogCount": rec.get("catalogCount"),
                "visibleSkillNames": rec.get("visibleSkillNames") or [],
                "ownVisible": own,
                "next1Names": n1,
                "next2Names": n2,
            }
    return out


def load_gold_index() -> dict[str, dict]:
    idx = {}
    for team in TEAMS:
        path = SRC_TEAMS / team / "data" / "gold.jsonl"
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            rec = json.loads(line)
            idx[rec["case_id"]] = rec
    return idx


def trim_jsonl(src: Path, dst: Path, keep_ids: list[str]) -> None:
    order = {cid: i for i, cid in enumerate(keep_ids)}
    found = {}
    for line in src.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        cid = rec.get("case_id") or rec.get("caseId")
        if cid in order:
            found[cid] = line if line.endswith("\n") else line + "\n"
    missing = [cid for cid in keep_ids if cid not in found]
    if missing:
        raise SystemExit(f"{src}: missing {missing}")
    dst.write_text("".join(found[cid] for cid in keep_ids), encoding="utf-8")


def write_readme() -> None:
    text = """# test100

第一批 100 条对照集。不改 `final5/teams/` 现有 39×1560。

## 状态

- 批次 0（本目录脚手架）已完成：10 队已拷、每队 10 条已裁、id 已冻、`case-windows.jsonl` 已按 catalog 抽出。
- `assets.json` / `cases.jsonl` messages / `gold.jsonl` 正文仍是旧稿。后续按队改资产再写 Query/Gold。
- 提示词和 runner 指到本目录，不要指 `final5/teams/`。

## 10 槽模板（每队）

2 Memory pair + 1 in8 Skill pair（view 或 view+files）+ 1 不在 8 条 Skill pair（search 或 search+files）+ 1 distractor + 1 natural。

T04 三个 own Skill 全在 8 条里，没有 search；files 占用 C010/C011。

为塞进 10 槽，相对 `TEST100-PLAN.md` 原文做了这些取舍（资产仍保留，只是不出题）：

| 队 | 取舍 |
|---|---|
| banzuke | files 挂 `localstorage-debug`（c027 in8）；不出 `initialize-lifecycle` |
| ultimate_utils | files 挂 `wandb-sweep-workflow`；search 把 s05 **改靶** 到 `vectoring-research-planning`；不出 s01 hf-training-setup |
| gmdh | files 挂 `dh-data-cleaning`；不出 biographical-data-schema |
| planpal | search 把 s02 **改靶** 到 `nextjs-api-setup`（cat02 不在 8 条） |
| judgegpt | s01 **改靶** 到 `add-api-key-input` 做 view+files；s03 同技能 search |
| jobsforit | files 挂 `component-refactor`，不挂 markdown-doc |
| playbilling | m01 **改靶** `mem_security_practice`；files 挂 add-acknowledgement 的 search 链 |

## 文件

- `keep-case-ids.jsonl` 100 行：角色、计划靶、计划序列、附件 path、改靶说明
- `case-windows.jsonl` 100 行：该 case_id 的 catalog、8 名、next1/next2、`targetVisible`、`derivedSequence`
- `teams/<Team>/data/` 五文件；cases/gold/evidence 已裁成 10 行；`team.json.case_count=10`

再生：`python test100/build_scaffold.py`

## 下一批

按队改资产再写 Case。样板队：`DVG-THREAD-04-TEAM-01`。评测不要和写数据绑在一次任务里。
"""
    (OUT / "README.md").write_text(text, encoding="utf-8")


def main() -> None:
    for team, rows in KEEP.items():
        if len(rows) != 10:
            raise SystemExit(f"{team} has {len(rows)} rows")
    all_ids = [row["case_id"] for team in TEAMS for row in KEEP[team]]
    if len(all_ids) != 100 or len(set(all_ids)) != 100:
        raise SystemExit(f"id count {len(all_ids)} unique {len(set(all_ids))}")

    catalog = load_catalog(set(all_ids))
    missing_cat = [cid for cid in all_ids if cid not in catalog]
    if missing_cat:
        raise SystemExit(f"catalog missing {missing_cat}")
    gold_idx = load_gold_index()

    teams_out = OUT / "teams"
    if teams_out.exists():
        shutil.rmtree(teams_out)
    teams_out.mkdir(parents=True)

    keep_lines = []
    window_lines = []
    files_pairs = 0
    search_pairs = 0

    for team in TEAMS:
        src = SRC_TEAMS / team / "data"
        dst = teams_out / team / "data"
        dst.mkdir(parents=True)
        shutil.copy2(src / "assets.json", dst / "assets.json")
        shutil.copy2(src / "team.json", dst / "team.json")
        ids = [r["case_id"] for r in KEEP[team]]
        trim_jsonl(src / "cases.jsonl", dst / "cases.jsonl", ids)
        trim_jsonl(src / "gold.jsonl", dst / "gold.jsonl", ids)
        trim_jsonl(src / "evidence.jsonl", dst / "evidence.jsonl", ids)
        team_obj = json.loads((dst / "team.json").read_text(encoding="utf-8"))
        team_obj["case_count"] = 10
        (dst / "team.json").write_text(json.dumps(team_obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        for row in KEEP[team]:
            cid = row["case_id"]
            role = row["role"]
            cat = catalog[cid]
            gold = gold_idx.get(cid) or {}
            derived = seq(role)
            skill = row["target_skill_name"]
            target_visible = None
            if skill:
                target_visible = skill in cat["visibleSkillNames"]
                if role.endswith("_pos"):
                    if role.startswith("skill_view") and target_visible is False:
                        raise SystemExit(f"{cid} view but not visible: {skill} vs {cat['visibleSkillNames']}")
                    if role.startswith("skill_search") and target_visible is True:
                        raise SystemExit(f"{cid} search but visible: {skill}")
            if role.endswith("_pos") and "files" in role:
                files_pairs += 1
            if role.endswith("_pos") and role.startswith("skill_search"):
                search_pairs += 1
            keep_lines.append(
                json.dumps(
                    {
                        "team_id": team,
                        "case_id": cid,
                        "role": role,
                        "pair_id": gold.get("pair_id"),
                        "target_asset_id": row["target_asset_id"],
                        "target_skill_name": skill,
                        "planned_sequence": derived,
                        "planned_file_path": row["file_path"],
                        "notes": row["notes"],
                    },
                    ensure_ascii=False,
                )
            )
            window_lines.append(
                json.dumps(
                    {
                        "case_id": cid,
                        "team_id": team,
                        "catalogId": cat["catalogId"],
                        "catalogIndex": cat["catalogIndex"],
                        "visibleSkillNames": cat["visibleSkillNames"],
                        "ownVisible": cat["ownVisible"],
                        "next1Names": cat["next1Names"],
                        "next2Names": cat["next2Names"],
                        "targetSkillName": skill,
                        "targetVisible": target_visible,
                        "derivedSequence": derived,
                        "plannedFilePath": row["file_path"],
                        "role": role,
                    },
                    ensure_ascii=False,
                )
            )

    (OUT / "keep-case-ids.jsonl").write_text("\n".join(keep_lines) + "\n", encoding="utf-8")
    (OUT / "case-windows.jsonl").write_text("\n".join(window_lines) + "\n", encoding="utf-8")
    write_readme()
    print(f"keep={len(keep_lines)} windows={len(window_lines)} files_pairs={files_pairs} search_pairs={search_pairs}")
    if files_pairs != 10:
        raise SystemExit("expected 10 files pairs")
    if search_pairs != 9:
        raise SystemExit(f"expected 9 search pairs, got {search_pairs}")


if __name__ == "__main__":
    main()
