# -*- coding: utf-8 -*-
"""False-CALL: invented gold tokens found in checkout working tree (locks should never be in repo)."""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT.parent / "manifests" / "workspace-resolution-final5-manifest-v2.json"
OUT = ROOT / "false-call-report.json"

CAMEL = re.compile(r"\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b")
TICK = re.compile(r"`([^`]{3,80})`")
STAMP = re.compile(r"\b[A-Za-z][A-Za-z0-9]*#[A-Za-z0-9_\-.]+\b")
QUOTED = re.compile(r"['\"]([A-Za-z][A-Za-z0-9_\-./:]{6,60})['\"]")
CN = re.compile(r"[\u4e00-\u9fff]{1,12}号")
SKIP_DIR = {".git", "node_modules", "dist", "build", ".next", "target", "vendor", "__pycache__", "testdata", "third_party", "proto", ".github", "out"}
DENY = {
    "URLSearchParams", "NavMeshAgent", "EnemyController", "GameObject", "BillingClient",
    "TrainingArguments", "HuggingFace", "OpenTelemetry", "DOMContentLoaded", "RequestParam",
    "WorldGenerator", "Placeables", "CompareTag", "PlayBilling", "PatrolBehavior",
    "TagManager", "PlanPal", "WebSocket", "LocalStorage", "PerlinNoise", "EnemyPatrol",
}


def loadj(p: Path):
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def tokens_from(text: str) -> list[str]:
    found = []
    for rx in (TICK, STAMP, QUOTED, CN):
        found.extend(rx.findall(text or ""))
    for c in CAMEL.findall(text or ""):
        if c not in DENY and len(c) >= 7:
            found.append(c)
    out, seen = [], set()
    for t in found:
        t = t.strip("`\"' ")
        if len(t) < 6 or t in DENY or t.lower() in seen:
            continue
        seen.add(t.lower())
        out.append(t)
    return out[:6]


def iter_files(root: Path):
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if any(part in SKIP_DIR for part in p.parts):
            continue
        if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".woff", ".zip", ".gz", ".bin", ".exe"}:
            continue
        if p.stat().st_size > 2_000_000:
            continue
        yield p


def index_repo(root: Path) -> str:
    chunks = []
    n = 0
    for f in iter_files(root):
        try:
            chunks.append(f.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
        n += 1
        if n > 1500:
            break
    return "\n".join(chunks)


def main() -> None:
    bindings = {row["caseId"]: row for row in json.loads(MANIFEST.read_text(encoding="utf-8"))}
    jobs = []
    for team_dir in sorted((ROOT / "teams").iterdir()):
        if not team_dir.is_dir():
            continue
        assets = json.loads((team_dir / "data" / "assets.json").read_text(encoding="utf-8"))
        mem = {m["id"]: m for m in assets.get("memory") or []}
        skills = {s["id"]: s for s in assets.get("skills") or []}
        for s in assets.get("skills") or []:
            if s.get("name"):
                skills[s["name"]] = s
        cases = {r["case_id"]: r for r in loadj(team_dir / "data" / "cases.jsonl")}
        for g in loadj(team_dir / "data" / "gold.jsonl"):
            if g.get("should_call") is not True:
                continue
            cid = g["case_id"]
            b = bindings.get(cid)
            tid = (g.get("target_asset_ids") or [None])[0]
            blob = ""
            if g.get("tool_family") == "memory":
                blob = (mem.get(tid) or {}).get("content") or ""
            else:
                sk = skills.get(tid) or {}
                blob = (sk.get("content") or "") + "\n".join(
                    f.get("content") or "" for f in sk.get("files") or [] if f.get("path") != "LICENSE"
                )
            jobs.append(
                {
                    "case_id": cid,
                    "team": team_dir.name,
                    "path": (b or {}).get("repositoryPath"),
                    "tokens": tokens_from(blob),
                    "target": tid,
                }
            )
    by_path = defaultdict(list)
    problems = []
    for j in jobs:
        if not j["path"]:
            problems.append({"case_id": j["case_id"], "problem": "no_manifest"})
            continue
        by_path[j["path"]].append(j)
    print("call", len(jobs), "repos", len(by_path), flush=True)
    cache_path = ROOT / "false-call-repo-hits.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {"hits": [], "done": []}
    done = set(cache.get("done") or [])
    hits = list(cache.get("hits") or [])
    clean = int(cache.get("clean") or 0)
    missing = 0
    for i, (path, group) in enumerate(by_path.items(), 1):
        if path in done:
            continue
        repo = Path(path)
        print(f"[{i}/{len(by_path)}] {path}", flush=True)
        if not repo.exists():
            missing += len(group)
            for j in group:
                problems.append({"case_id": j["case_id"], "problem": "missing_path", "path": path})
            continue
        blob = index_repo(repo)
        blob_l = blob.lower()
        for j in group:
            matched = [t for t in j["tokens"] if t.lower() in blob_l]
            if matched:
                hits.append({**j, "matched": matched})
            else:
                clean += 1
        done.add(path)
        cache_path.write_text(
            json.dumps({"hits": hits, "done": sorted(done), "clean": clean}, ensure_ascii=False),
            encoding="utf-8",
        )
    summary = {
        "call": len(jobs),
        "repos": len(by_path),
        "false_call_hits": len(hits),
        "clean": clean,
        "missing_path": missing,
        "no_manifest": sum(1 for p in problems if p["problem"] == "no_manifest"),
    }
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    OUT.write_text(json.dumps({"summary": summary, "hits": hits, "problems": problems}, ensure_ascii=False, indent=2), encoding="utf-8")
    for h in hits:
        print("HIT", h["case_id"], h["matched"])


if __name__ == "__main__":
    main()
