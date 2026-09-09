# -*- coding: utf-8 -*-
"""Align skill-pair Queries with frozen listing descriptions (C010 pattern)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# case_id of POS end -> new query (neg end shares it)
QUERIES = {
    # T04 already aligned
    "c_0c03d7a87bb604cc": "For Code Insights, when verifying provider-specific HTTP request and response behavior without live model calls, which stub URL and fixture header name and value are required?",
    "c_cfcd7dfe4c055f59": "For Code Insights, when expanding Vitest coverage across pure functions, routes, and integration-heavy modules, which snapshot glob is excluded and which package src trees does the gate score?",
    "dvg06_banzukesurfing__c013": "When creating or refactoring Jest tests for BanzukeSurfing Game components, what DOM should jsdom contain, how must a saved pick be proven, and may the test import index.html?",
    "dvg06_banzukesurfing__c027": "When tracing BanzukeSurfing localStorage key and JSON mismatches between the browser and Jest, what console prefix is required and which getItem probe key is forbidden?",
    "dvg10_ultimate_utils__s02_call": "For this HuggingFace repo's wandb hyperparameter sweep workflow (config, sweep init, and agent), which yaml key and value are required, and which project string is forbidden?",
    "dvg10_ultimate_utils__s05_call": "For Vectoring in Research planning on this HuggingFace repo, how must remaining uncertainties be ranked, and which logged metric ends a vector?",
    "dvg09_playbilling__s_pilot01_call": "For this Play Billing plugin's Unity-Kotlin bridge communication, which C# method must receive every native billing event, and what must already be true before the billing client connects?",
    "dvg09_playbilling__m04_call": "When adding purchase acknowledgement for this Unity Play Billing plugin, which internal payload string forbids acknowledgePurchase, and which callback JSON field and value must be set after Unity preflight?",
    "dvg03_gmdh__s01_call": "For large GM-DH historical person CSVs under the chunk-marker protocol, what must be snapshotted before the split, and how must tagged parts be concatenated and verified?",
    "dvg03_gmdh__s_sa01": "When cleaning GM-DH biographical person data, which date uncertainty marker is required, how must original and canonical forms be paired, and which calendar conversion is forbidden?",
    "dvg03_planpal__s01_call": "When debugging PlanPal browser cookie problems after login, which DevTools panel label is required, which console probe is forbidden, and which cookie-name suffix must the filter use?",
    "dvg03_planpal__s02_call": "When configuring PlanPal Next.js API routes and auth, which route file should read and write the auth cookie, which helper must set it, and may the route use localStorage?",
    "dvg09_judgegpt__s01_call": "When adding the JudgeGPT API-key input field, which input id, data-attribute name and value, and autocomplete value are required, and which localStorage key is forbidden?",
    "dvg09_judgegpt__s03_call": "What ordered frontend steps does JudgeGPT use to add an API-key input field, read it, and attach it to later OpenAI requests, and may the Node server hardcode that key?",
    "dvg05_pbrudny_jobsforit__s01_call": "When refactoring a jobsforit React class job-card to a function component, what named custom hook, leftover this.state comment token, and test helper does this conversion require?",
    "dvg05_pbrudny_jobsforit__s02_call": "When cleaning unused npm packages and updating jobsforit dependencies, which installer and flags must refresh the lockfile, and what sidecar header must list the dropped names?",
    "dvg08_temporalio_temporal__s019": "When renaming files in this temporalio/temporal tree with the Python os module, which directories must the walker skip, and what path form and entry-point guard are locked for os.rename?",
    "dvg08_temporalio_temporal__s021": "When converting camelCase filenames to snake_case in this temporalio/temporal tree, what does CHASM map to, and which expanded forms of HSM and CHASM are forbidden?",
}


def patch_jsonl(path: Path, case_ids: set[str], query: str, field: str | None = None) -> int:
    n = 0
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        cid = rec.get("case_id")
        if cid in case_ids:
            if field == "original_prompt":
                rec["original_prompt"] = query
                n += 1
            elif "messages" in rec:
                rec["messages"][-1]["content"] = query
                n += 1
        out.append(json.dumps(rec, ensure_ascii=False))
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    return n


def main() -> None:
    keep = [json.loads(l) for l in (ROOT / "keep-case-ids.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    pair_to_ids = {}
    for k in keep:
        if k.get("pair_id") and k["role"] not in ("distractor", "natural"):
            pair_to_ids.setdefault((k["team_id"], k["pair_id"]), []).append(k["case_id"])

    by_team_ids = {}
    for pos_id, query in QUERIES.items():
        k = next(x for x in keep if x["case_id"] == pos_id)
        ids = pair_to_ids[(k["team_id"], k["pair_id"])]
        by_team_ids.setdefault(k["team_id"], {})
        for cid in ids:
            by_team_ids[k["team_id"]][cid] = query

    for team, mapping in by_team_ids.items():
        data = ROOT / "teams" / team / "data"
        n1 = 0
        cases = []
        for line in (data / "cases.jsonl").read_text(encoding="utf-8").splitlines():
            rec = json.loads(line)
            cid = rec["case_id"]
            if cid in mapping:
                rec["messages"][-1]["content"] = mapping[cid]
                n1 += 1
            cases.append(json.dumps(rec, ensure_ascii=False))
        (data / "cases.jsonl").write_text("\n".join(cases) + "\n", encoding="utf-8")
        ev = []
        n2 = 0
        for line in (data / "evidence.jsonl").read_text(encoding="utf-8").splitlines():
            rec = json.loads(line)
            if rec["case_id"] in mapping:
                rec["original_prompt"] = mapping[rec["case_id"]]
                n2 += 1
            ev.append(json.dumps(rec, ensure_ascii=False))
        (data / "evidence.jsonl").write_text("\n".join(ev) + "\n", encoding="utf-8")
        print(team, "cases", n1, "evidence", n2)


if __name__ == "__main__":
    main()
