# -*- coding: utf-8 -*-
"""Apply remaining 9-team asset + case rewrites for test100."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
KEEP = ROOT / "keep-case-ids.jsonl"
TEAMS = ROOT / "teams"
LICENSE = "Adapted from public project docs. MIT-0.\n"

# memory_id -> new content; skill_id -> {content, files?}
ASSETS: dict[str, dict] = {}
# case_id -> {query, ctx, gold_reason}  ctx used as pos context or sole message
CASES: dict[str, dict] = {}


def mem(team, mid, content):
    ASSETS.setdefault(team, {}).setdefault("memory", {})[mid] = content


def sk(team, sid, content, files=None):
    ASSETS.setdefault(team, {}).setdefault("skills", {})[sid] = {
        "content": content,
        "files": files,
    }


def cq(cid, query, ctx, reason, extra=None):
    CASES[cid] = {"query": query, "ctx": ctx, "gold_reason": reason, **(extra or {})}


# ----- T05 -----
mem("T05", "T05__memory__coverage_priorities",
    "Code Insights coverage PRs must land pure normalizers and exporters before any Hono route or LLM-analysis orchestration tests; do not open a coverage PR that starts with analysis.ts.")
mem("T05", "T05__memory__provider_transport",
    "Code Insights provider adapter tests must assert Authorization is a Bearer header on fetch, never an api_key query string; live Anthropic/OpenAI calls are forbidden.")
sk("T05", "T05__skill__test_coverage",
   "1. Run Vitest coverage for Code Insights CLI and server packages.\n2. Rank gaps by mock cost.\n3. Do not count parseArgv snapshot files toward the coverage gate; only src/server and src/cli pure modules.\n4. Re-run coverage and record remaining gaps.")
sk("T05", "T05__skill__test_llm_providers",
   "1. Mock fetch at the HTTP boundary for Code Insights provider adapters.\n2. Assert URL, auth header, and role mapping from fixtures.\n3. Exact header and URL table is only in references/provider-fetch-checklist.md.",
   [{"path": "references/provider-fetch-checklist.md",
     "content": "Anthropic tests must stub fetch to https://api.anthropic.com/v1/messages and assert the x-api-key header. OpenAI stubs https://api.openai.com/v1/chat/completions with Authorization Bearer.\n"},
    {"path": "LICENSE", "content": LICENSE}])
cq("c_05ac2a5c98a1a3a6",
   "For this Code Insights repo, what order is locked for coverage PRs, and which file must not start a coverage PR?",
   "The coverage PR order lock is not in this chat.",
   "Query asks the locked coverage PR order and the forbidden starting file. Only coverage_priorities L1 states normalizers/exporters first and no analysis.ts start. Skills are test procedures, not this PR order. Next-team skills are unrelated.")
cq("c_fe64ad918b22bc8b",
   "For Code Insights provider adapter tests, where must the API key go on fetch, and are live model calls allowed?",
   "The provider-test transport lock is not in this chat.",
   "Query asks Bearer-vs-query and live-call ban. Only provider_transport L1 has that lock. test-llm-providers Skill is the mock loop, not this header rule.")
cq("c_0c03d7a87bb604cc",
   "For Code Insights Anthropic provider tests, which exact URL must fetch be stubbed to, and which header carries the key?",
   "The Anthropic stub URL and header are not in this chat.",
   "Answer is only in references/provider-fetch-checklist.md. Skill body points at that path. Target is in the 8, so skill_view then skill_files_read.",
   {"file_line": "Anthropic tests must stub fetch to https://api.anthropic.com/v1/messages and assert the x-api-key header."})
cq("c_cfcd7dfe4c055f59",
   "For Code Insights Vitest coverage, which files are excluded from the coverage gate?",
   "The coverage-gate exclusion is not in this chat.",
   "expand-vitest-coverage body excludes parseArgv snapshots. Target not in this case's 8, so skill_search then skill_view_by_id. Memory priority list is PR order, not this exclusion.")
cq("c_5e9acd1796d52837",
   "Skip live LLM provider tests this round. Write the Hono route test from the pasted createApp factory and fixtures only.",
   None,
   "Query already decides to skip provider tests and supplies the route-test method. test-llm-providers is similar-topic; no TDAI gap.")
cq("c_dfee5b3f52b92c37",
   "Confirm package.json already has test: vitest run and test:coverage: vitest run --coverage, then add a one-line comment above the coverage script only.",
   None,
   "Local package.json already has the scripts. Comment-only.")

# ----- banzuke -----
mem("dvg06_banzukesurfing", "dvg06_banzukesurfing__memory__localstorage_patterns",
    "BanzukeSurfing stores each user's picks as JSON under a localStorage key equal to the username; contest names are fields inside that JSON. Never store picks under a single picks key.")
mem("dvg06_banzukesurfing", "dvg06_banzukesurfing__memory__jest_setup",
    "BanzukeSurfing Jest must load jest-localstorage-mock and clear localStorage in afterEach, not only beforeEach. Do not switch to a fake-indexeddb harness.")
sk("dvg06_banzukesurfing", "dvg06_banzukesurfing__skill__jest_test_refactor",
   "1. Build only DOM nodes the Game method reads.\n2. Seed via localStorage.setItem(username, json) before calling.\n3. One test per public method; assert through querySelector.\n4. Do not import the production HTML document.")
sk("dvg06_banzukesurfing", "dvg06_banzukesurfing__skill__localstorage_debug",
   "1. Confirm Jest has localStorage before asserting keys.\n2. Watch getItem/setItem arguments.\n3. The current-user vs picks key split is only in references/key-trace.md.",
   [{"path": "references/key-trace.md",
     "content": "The current-user key is always the literal string user. Never JSON.parse(localStorage.user) as the picks object.\n"},
    {"path": "LICENSE", "content": LICENSE}])
cq("dvg06_banzukesurfing__c001",
   "In BanzukeSurfing, under which localStorage key are a user's contest picks stored, and is a single picks key allowed?",
   "The picks key layout lock is not in this chat.",
   "Only localstorage_patterns L1 forbids a single picks key and uses username as the JSON key. Debug Skill traces mismatches, it does not name that schema.")
cq("dvg06_banzukesurfing__c003",
   "For BanzukeSurfing Jest, when must localStorage be cleared, and may we switch to fake-indexeddb?",
   "The Jest storage-harness lock is not in this chat.",
   "Only jest_setup L1 requires afterEach clear and forbids fake-indexeddb. jest-test-refactor is how to write tests, not which harness.")
cq("dvg06_banzukesurfing__c013",
   "When adding a Jest test for a BanzukeSurfing Game method, how should records be seeded and how many tests per public method?",
   "The Jest seeding and one-test-per-method rule is not in this chat.",
   "jest-test-refactor body requires setItem seed and one test per public method. Not in this case's 8, so search then view_by_id.")
cq("dvg06_banzukesurfing__c027",
   "When tracing BanzukeSurfing localStorage, what literal key holds the current user, and may that value be parsed as the picks object?",
   "The current-user key vs picks split is not in this chat.",
   "Answer is only in references/key-trace.md. Target in the 8, so skill_view then skill_files_read.",
   {"file_line": "The current-user key is always the literal string user. Never JSON.parse(localStorage.user) as the picks object."})
cq("dvg06_banzukesurfing__c005",
   "Print Game.startPlaying's first parameter name from the open Game.js. Do not change persistence.",
   None,
   "Query already specifies a local source read. Persistence Memory/Skill are similar-topic; no TDAI gap.")
cq("dvg06_banzukesurfing__c007",
   "Add type=module to the existing script tag in index.html if it is missing. Do not edit Game.js.",
   None,
   "Local HTML attribute fix in the open file.")

# ----- ultimate -----
mem("dvg10_ultimate_utils", "mem_hf_training_preferences",
    "HuggingFace Trainer in this repo must use fp16=True, logging_steps=10, save_steps=500, and push_to_hub=False. Do not copy a README eval_steps=50 default.")
mem("dvg10_ultimate_utils", "mem_wandb_setup",
    "Local wandb sweeps with count=1 must set entity=None and project=None; the config file must be named sweep_config.yaml, not wandb.yaml.")
sk("dvg10_ultimate_utils", "dvg10_ultimate_utils__skill__wandb-sweep-workflow",
   "1. Write sweep_config.yaml (method, metric, parameters).\n2. Call wandb.sweep() then wandb.agent().\n3. Where to set local no-upload flags is only in references/sweep-local.md.",
   [{"path": "references/sweep-local.md",
     "content": "For count=1 local sweeps set entity=None and project=None inside wandb.sweep(), not as CLI flags.\n"},
    {"path": "LICENSE", "content": LICENSE}])
sk("dvg10_ultimate_utils", "dvg10_ultimate_utils__skill__vectoring-research-planning",
   "1. Write the Essential Goal.\n2. List Actions, Assumptions, and Uncertainties.\n3. Pick one vector for 1-2 weeks.\n4. Do not start a second vector until the current uncertainty is reduced.")
cq("dvg10_ultimate_utils__m01_call",
   "For this repo's HuggingFace Trainer, which fp16, logging_steps, save_steps, and push_to_hub values are locked?",
   "The Trainer hyperparameter lock is not in this chat.",
   "Only mem_hf_training_preferences has fp16/logging/save/push_to_hub. hf-training-setup Skill is load/train/save, not these numbers.")
cq("dvg10_ultimate_utils__m02_call",
   "For a count=1 local wandb sweep in this repo, which entity and project values are locked, and what is the config filename?",
   "The local wandb sweep naming lock is not in this chat.",
   "Only mem_wandb_setup names sweep_config.yaml and entity=None. The Skill is the sweep/agent procedure.")
cq("dvg10_ultimate_utils__s02_call",
   "For a count=1 local wandb sweep, where must entity=None and project=None be set?",
   "The local sweep flag placement is not in this chat.",
   "Answer is only in references/sweep-local.md (inside wandb.sweep(), not CLI). Target in the 8, so view then files_read.",
   {"file_line": "For count=1 local sweeps set entity=None and project=None inside wandb.sweep(), not as CLI flags."})
cq("dvg10_ultimate_utils__s05_call",
   "In this repo's research planning, how many vectors may run in one 1-2 week iteration?",
   "The one-vector-per-iteration rule is not in this chat.",
   "vectoring-research-planning body forbids a second vector until the current one is reduced. Not in this case's 8, so search then view_by_id. Memory only states the CS197 preference, not this gate.")
cq("dvg10_ultimate_utils__none_02",
   "Write a one-line comment that fp16 is mixed precision. Do not change TrainingArguments values already in the open script.",
   None,
   "Comment-only on an open Trainer script. hf prefs Memory is similar-topic; Query forbids changing values.")
cq("dvg10_ultimate_utils__none_01",
   "Rename a local variable in the open train script for readability. Do not change hyperparameters.",
   None,
   "Local rename in the open file.")

# ----- playbilling -----
mem("dvg09_playbilling", "mem_security_practice",
    "Play Billing purchase verification must call Security.verifyPurchase(); base64EncodedPublicKey must be passed in from Unity and must never be hardcoded in Kotlin.")
mem("dvg09_playbilling", "mem_subscription_policy",
    "This plugin supports prepaid and auto-renewable subscriptions; each subscription may have multiple plans and offers. Do not model a subscription as a single INAPP product.")
sk("dvg09_playbilling", "dvg09_playbilling__skill__unity-bridge-setup",
   "1. Import unity3d.Player and CallBack.\n2. Send events with Player.UnityCallBack and GameObject name PlayBillingManager.\n3. The C# receiver takes a JSON string.\n4. Do not rename the GameObject.")
sk("dvg09_playbilling", "dvg09_playbilling__skill__add-acknowledgement",
   "1. In onPurchasesUpdated inspect purchase state.\n2. Call acknowledgePurchase only when allowed.\n3. Which states may be acked is only in references/ack-states.md.",
   [{"path": "references/ack-states.md",
     "content": "Only PURCHASED purchases may be acknowledged. PENDING and UNSPECIFIED_STATE must not call acknowledgePurchase.\n"},
    {"path": "LICENSE", "content": LICENSE}])
cq("dvg09_playbilling__m01_call",
   "Where must this Play Billing plugin take base64EncodedPublicKey from, and may it be hardcoded in Kotlin?",
   "The public-key source lock is not in this chat.",
   "Only mem_security_practice requires Unity-passed key and forbids Kotlin hardcode. billing 6.0.1 is already in Gradle.")
cq("dvg09_playbilling__m03_call",
   "How many subscription types does this plugin lock, and may a subscription be modeled as one INAPP product?",
   "The subscription-type lock is not in this chat.",
   "Only mem_subscription_policy locks prepaid vs auto-renewable and forbids a single INAPP model. implement-subscription Skill is the queryProductDetails loop.")
cq("dvg09_playbilling__s_pilot01_call",
   "How must Kotlin billing events reach Unity in this plugin, and what GameObject name is locked?",
   "The Unity bridge procedure is not in this chat.",
   "unity-bridge-setup body locks PlayBillingManager and JSON CallBack. Target in the 8, so skill_view.")
cq("dvg09_playbilling__m04_call",
   "Which Play Billing purchase state may this plugin acknowledge, and which states must not be acked?",
   "The ack-state table is not in this chat.",
   "Answer is only in references/ack-states.md (PURCHASED only). Target not in the 8, so search, view_by_id, files_read.",
   {"file_line": "Only PURCHASED purchases may be acknowledged. PENDING and UNSPECIFIED_STATE must not call acknowledgePurchase."})
cq("dvg09_playbilling__none_nat08",
   "Let the plugin user construct BillingClient when they want. Do not add a hidden init helper.",
   None,
   "Query already chooses user-owned BillingClient setup. add-billing-feature is similar-topic; no TDAI gap.")
cq("dvg09_playbilling__none_nat01",
   "Create an empty Kotlin class file for a Unity Android plugin in the existing source set.",
   None,
   "Local empty class in the existing source set.")

# ----- gmdh -----
mem("dvg03_gmdh", "mem_csv_protocol",
    "Large GM-DH CSVs use chunk markers [START CSV \"title\" n/total]; analysis waits until n=total. Do not analyze a non-final chunk.")
mem("dvg03_gmdh", "mem_website_structure",
    "Intended first-class destinations are project home, a people-and-literature database, workshop resources, and a glossary — not only the talks/blog/video sections currently in index.html.")
sk("dvg03_gmdh", "skill_csv_batch_processing",
   "1. Record headers and row count.\n2. Tag parts [START CSV n/total].\n3. Wait on non-final parts; concatenate with one header after n=total.\n4. Do not run the webinar demo on a partial chunk.")
sk("dvg03_gmdh", "skill_dh_data_cleaning",
   "1. Unify dates and check birth-before-death.\n2. Keep original plus canonical place names.\n3. Allowed fuzzy/range date tokens are only in references/date-checks.md.",
   [{"path": "references/date-checks.md",
     "content": "Accept date tokens YYYY, YYYY-MM, and YYYY-MM-DD. Reject a death year earlier than birth year even when the death is year-only.\n"},
    {"path": "LICENSE", "content": LICENSE}])
cq("dvg03_gmdh__m01_call",
   "For GM-DH large CSVs, when may analysis start relative to the chunk markers?",
   "The chunk-wait rule is not in this chat.",
   "Only mem_csv_protocol waits until n=total. csv-batch-processing Skill is the split/concat loop.")
cq("dvg03_gmdh__k03_call",
   "Which first-class destinations are locked for the GM-DH site, besides the current talks/blog/video nav?",
   "The intended IA lock is not in this chat.",
   "Only mem_website_structure lists home, people database, workshop resources, glossary. index.html nav is talks/blog/video.")
cq("dvg03_gmdh__s01_call",
   "After tagging GM-DH CSV chunks, what must happen before analysis, and may a webinar demo run on a partial chunk?",
   "The wait-and-concat procedure is not in this chat.",
   "csv-batch-processing forbids webinar demo on a partial chunk. Not in this case's 8, so search then view_by_id.")
cq("dvg03_gmdh__s_sa01",
   "Which date tokens may GM-DH person records use, and is a year-only death before birth allowed?",
   "The date-token table is not in this chat.",
   "Answer is only in references/date-checks.md. Target in the 8, so skill_view then skill_files_read.",
   {"file_line": "Accept date tokens YYYY, YYYY-MM, and YYYY-MM-DD. Reject a death year earlier than birth year even when the death is year-only."})
cq("dvg03_gmdh__none_sa03",
   "Explain how Intersection Observer works for generic scroll-spy. Do not implement this site's sticky nav.",
   None,
   "Generic web-platform question. sticky-nav-implementation is similar-topic; Query forbids this site's recipe.")
cq("dvg03_gmdh__none_sa05",
   "Add a one-line comment above the existing loading=lazy image in index.html.",
   None,
   "Local comment on an open image tag.")

# ----- planpal -----
mem("dvg03_planpal", "mem_auth_strategy",
    "JWT must not go in localStorage; PlanPal writes an httpOnly cookie named auth-token for 7 days.")
mem("dvg03_planpal", "mem_api_pattern",
    "PlanPal backend is NestJS and frontend is Next.js; CORS must allow credentials and must not set origin to *.")
sk("dvg03_planpal", "skill_cookie_debug",
   "1. Reproduce login in Network.\n2. Check Set-Cookie flags then Application/Cookies.\n3. The httpOnly visibility trap is only in references/httponly-trap.md.",
   [{"path": "references/httponly-trap.md",
     "content": "Do not use document.cookie to decide whether an httpOnly auth-token exists; document.cookie cannot see it.\n"},
    {"path": "LICENSE", "content": LICENSE}])
sk("dvg03_planpal", "skill_nextjs_api_setup",
   "1. Put route.ts under app/api.\n2. Read cookies via cookies().\n3. Write via response.cookies.set.\n4. Do not read auth-token from localStorage in the route.")
cq("dvg03_planpal__m02_call",
   "Where does PlanPal store the JWT, what cookie name is locked, and how long does it last?",
   "The JWT storage lock is not in this chat.",
   "Only mem_auth_strategy names httpOnly auth-token for 7 days and forbids localStorage. cookie-debug Skill is the DevTools loop.")
cq("dvg03_planpal__m03_call",
   "For PlanPal CORS, may origin be *, and must credentials be allowed?",
   "The CORS origin lock is not in this chat.",
   "Only mem_api_pattern forbids origin * and requires credentials. cors-credentials Skill is the fetch/preflight procedure.")
cq("dvg03_planpal__s01_call",
   "When debugging PlanPal login cookies, may I use document.cookie to test whether auth-token exists?",
   "The httpOnly visibility trap is not in this chat.",
   "Answer is only in references/httponly-trap.md. Target in the 8, so skill_view then skill_files_read.",
   {"file_line": "Do not use document.cookie to decide whether an httpOnly auth-token exists; document.cookie cannot see it."})
cq("dvg03_planpal__s02_call",
   "In PlanPal Next.js App Router, how should a route read and set the auth cookie, and may it read localStorage?",
   "The App Router cookie route procedure is not in this chat.",
   "nextjs-api-setup forbids localStorage in the route and uses cookies()/cookies.set. Not in this case's 8, so search then view_by_id.")
cq("dvg03_planpal__n06_none",
   "Log a password hash in the Nest controller with console.log. Do not change cookie flags.",
   None,
   "Local console.log. cookie-debug is similar-looking; Query already specifies the log.")
cq("dvg03_planpal__n04_none",
   "The two GitHub URLs are already in README. Paste them into the Cod section.",
   None,
   "Local markdown copy from the open README.")

# ----- judgegpt -----
mem("dvg09_judgegpt", "mem_api_key_handling",
    "OpenAI API keys must not be hardcoded on the JudgeGPT server; the user types them in the frontend input and client JS sends them.")
mem("dvg09_judgegpt", "mem_code_style",
    "JudgeGPT source must use tab indentation, not spaces; constructors need parameter comments.")
sk("dvg09_judgegpt", "dvg09_judgegpt__skill__add-api-key-input",
   "1. Add a frontend input for the OpenAI key.\n2. Read its value in client JS; never hardcode the key on the server.\n3. Placeholder and password-type rules are only in references/api-key-input.md.",
   [{"path": "references/api-key-input.md",
     "content": "The API key input must use type=password and placeholder OpenAI API Key.\n"},
    {"path": "LICENSE", "content": LICENSE}])
cq("dvg09_judgegpt__m02_call",
   "May JudgeGPT hardcode the OpenAI key on the server, and where must the user supply it?",
   "The key-handling lock is not in this chat.",
   "Only mem_api_key_handling forbids server hardcode and requires frontend input. The Skill is the widget procedure.")
cq("dvg09_judgegpt__m04_call",
   "Does JudgeGPT lock tab or space indentation?",
   "The indentation lock is not in this chat.",
   "Only mem_code_style requires tabs. Skills mention tabs as style, not this policy.")
cq("dvg09_judgegpt__s01_call",
   "For JudgeGPT's OpenAI key field, which input type and placeholder are required?",
   "The input type and placeholder are not in this chat.",
   "Answer is only in references/api-key-input.md. Target in the 8, so skill_view then skill_files_read.",
   {"file_line": "The API key input must use type=password and placeholder OpenAI API Key."})
cq("dvg09_judgegpt__s03_call",
   "What frontend steps does JudgeGPT use to collect an OpenAI key and attach it to requests?",
   "The key-input procedure is not in this chat.",
   "add-api-key-input body is add input, read in client JS, never hardcode on the server. Not in this case's 8, so search then view_by_id.")
cq("dvg09_judgegpt__none_nat01",
   "Write a local if/else around the open sqlite exists check exactly as specified in the query. Do not invent a manager class.",
   None,
   "Local branch already specified. setup-sqlite-db is similar-topic; Query forbids inventing the manager.")
cq("dvg09_judgegpt__none_nat03",
   "Wait for the current command to finish. Do not start another process.",
   None,
   "Wait instruction fully specified.")

# ----- jobsforit -----
mem("dvg05_pbrudny_jobsforit", "mem_commit_convention",
    "Every jobsforit commit message must include a ChatGPT share link in the form: Description * shared chat: https://chat.openai.com/share/...")
mem("dvg05_pbrudny_jobsforit", "mem_ui_migration",
    "jobsforit UI kit is Material-UI (@material-ui/core); do not mix leftover antd components.")
sk("dvg05_pbrudny_jobsforit", "component-refactor",
   "1. List class state and lifecycle.\n2. Replace with useState/useEffect and drop this.\n3. Keep props and run tests.\n4. The DidMount mapping is only in references/hooks-conversion.md.",
   [{"path": "references/hooks-conversion.md",
     "content": "Map componentDidMount to useEffect(..., []). Map componentWillUnmount cleanup as the effect return. Do not use componentDidMount inside a function component.\n"},
    {"path": "LICENSE", "content": LICENSE}])
sk("dvg05_pbrudny_jobsforit", "package-cleanup",
   "1. depcheck unused packages.\n2. Search the repo before delete.\n3. yarn install to refresh yarn.lock; do not use npm install.")
cq("dvg05_pbrudny_jobsforit__m02_call",
   "What extra line must every jobsforit commit message include?",
   "The commit attribution lock is not in this chat.",
   "Only mem_commit_convention requires the ChatGPT share-link line. markdown-doc Skill is heading/list/fence, not commits.")
cq("dvg05_pbrudny_jobsforit__m04_call",
   "Which UI kit is locked for jobsforit, and may leftover antd stay mixed in?",
   "The UI-kit lock is not in this chat.",
   "Only mem_ui_migration locks Material-UI and forbids mixed antd. ui-library-migration Skill is the swap loop.")
cq("dvg05_pbrudny_jobsforit__s01_call",
   "When converting a jobsforit class component, what useEffect dependency array maps to componentDidMount?",
   "The DidMount-to-useEffect mapping is not in this chat.",
   "Answer is only in references/hooks-conversion.md. Target in the 8, so skill_view then skill_files_read.",
   {"file_line": "Map componentDidMount to useEffect(..., []). Map componentWillUnmount cleanup as the effect return."})
cq("dvg05_pbrudny_jobsforit__s02_call",
   "After removing an unused jobsforit package, which installer must refresh the lockfile?",
   "The lockfile installer rule is not in this chat.",
   "package-cleanup requires yarn install, not npm install. Not in this case's 8, so search then view_by_id.")
cq("dvg05_pbrudny_jobsforit__n01_none",
   "Keep className and Leaflet props on the open Map.js. Convert only as the query already specifies.",
   None,
   "Query already states keep-props on the open file. component-refactor is similar-topic; no TDAI gap.")
cq("dvg05_pbrudny_jobsforit__n03_none",
   "Delete the unused comment on the first line of the open file.",
   None,
   "Local comment cleanup.")

# ----- temporal -----
mem("dvg08_temporalio_temporal", "mem_naming_convention",
    "Go sources in temporalio/temporal use snake_case filenames (client_bean.go), not camelCase (clientBean.go).")
mem("dvg08_temporalio_temporal", "mem_acronym_handling",
    "Acronym nDC becomes ndc before snake_case; nDCHistoryResender.go becomes ndc_history_resender.go.")
sk("dvg08_temporalio_temporal", "dvg08_temporalio_temporal__skill__python-file-renaming",
   "1. Use os.walk to traverse the tree.\n2. Compute the snake_case name.\n3. os.rename with absolute paths.\n4. Guard with if __name__ == '__main__'.")
sk("dvg08_temporalio_temporal", "dvg08_temporalio_temporal__skill__camel-to-snake-conversion",
   "1. Replace known acronyms first.\n2. Insert underscore before uppercase that follows lowercase.\n3. The acronym table is only in references/acronyms.md.",
   [{"path": "references/acronyms.md",
     "content": "nDC maps to ndc. XML maps to xml. Do not emit x_m_l_parser for XMLParser.\n"},
    {"path": "LICENSE", "content": LICENSE}])
cq("dvg08_temporalio_temporal__m009",
   "For temporalio/temporal Go files, is camelCase or snake_case locked for filenames?",
   "The filename-case lock is not in this chat.",
   "Only mem_naming_convention locks snake_case filenames. camel-to-snake Skill is the algorithm.")
cq("dvg08_temporalio_temporal__m011",
   "How must the nDC acronym be rewritten before snake_case in this repo?",
   "The nDC rewrite lock is not in this chat.",
   "Only mem_acronym_handling states nDC→ndc with the HistoryResender example.")
cq("dvg08_temporalio_temporal__s019",
   "How should the Python rename script walk this tree and invoke os.rename?",
   "The walk-and-rename procedure is not in this chat.",
   "python-file-renaming body is os.walk, absolute os.rename, __main__ guard. Target in the 8, so skill_view.")
cq("dvg08_temporalio_temporal__s021",
   "In this repo's camel-to-snake table, what does XML map to, and is x_m_l_parser allowed for XMLParser?",
   "The acronym table is not in this chat.",
   "Answer is only in references/acronyms.md. Target not in the 8, so search, view_by_id, files_read.",
   {"file_line": "nDC maps to ndc. XML maps to xml. Do not emit x_m_l_parser for XMLParser."})
cq("dvg08_temporalio_temporal__n008",
   "Stage everything with git add -A as already written in this query. Do not look up a hidden rename recipe.",
   None,
   "Query already names git add -A. git-rename Memory/Skill are similar-topic; no TDAI gap.")
cq("dvg08_temporalio_temporal__n001",
   "Write a bash find that prints *.go paths under the current tree. Do not rename files.",
   None,
   "Local find/print scripting.")


def load_keep():
    rows = []
    for line in KEEP.read_text(encoding="utf-8").splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def patch_assets(team: str) -> None:
    spec = ASSETS.get(team)
    if not spec:
        return
    path = TEAMS / team / "data" / "assets.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    for m in data.get("memory") or []:
        if m["id"] in spec.get("memory", {}):
            m["content"] = spec["memory"][m["id"]]
    for s in data.get("skills") or []:
        if s["id"] in spec.get("skills", {}):
            rec = spec["skills"][s["id"]]
            s["content"] = rec["content"]
            if rec.get("files") is not None:
                s["files"] = rec["files"]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def rewrite_team(team: str, keeps: list[dict]) -> None:
    data = TEAMS / team / "data"
    old_cases = {}
    for line in (data / "cases.jsonl").read_text(encoding="utf-8").splitlines():
        rec = json.loads(line)
        old_cases[rec["case_id"]] = rec
    old_gold = {}
    for line in (data / "gold.jsonl").read_text(encoding="utf-8").splitlines():
        rec = json.loads(line)
        old_gold[rec["case_id"]] = rec
    old_ev = {}
    for line in (data / "evidence.jsonl").read_text(encoding="utf-8").splitlines():
        rec = json.loads(line)
        old_ev[rec["case_id"]] = rec

    pos_by_pair = {}
    for k in keeps:
        if k["role"].endswith("_pos"):
            pos_by_pair[k.get("pair_id")] = CASES.get(k["case_id"])

    case_lines, gold_lines, ev_lines = [], [], []
    for k in keeps:
        cid = k["case_id"]
        role = k["role"]
        spec = CASES.get(cid)
        if spec is None and role.endswith("_neg"):
            spec = pos_by_pair.get(k.get("pair_id"))
            if spec:
                spec = {
                    **spec,
                    "gold_reason": "Context already contains the locked asset content or the attachment line.",
                }
        if spec is None:
            raise SystemExit(f"missing case spec {cid}")
        old = old_cases[cid]
        query = spec["query"]
        if role in ("distractor", "natural"):
            messages = [{"role": "user", "content": query}]
        elif role.endswith("_neg"):
            ctx = spec.get("file_line") or spec["ctx"]
            if role.startswith("memory"):
                # exact L1 content
                ctx = None
                assets = json.loads((data / "assets.json").read_text(encoding="utf-8"))
                for m in assets["memory"]:
                    if m["id"] == k["target_asset_id"]:
                        ctx = m["content"]
                        break
                if ctx is None:
                    raise SystemExit(f"no memory content for {cid}")
            elif "files" in role:
                ctx = spec["file_line"]
            else:
                assets = json.loads((data / "assets.json").read_text(encoding="utf-8"))
                ctx = None
                for s in assets["skills"]:
                    if s["id"] == k["target_asset_id"]:
                        ctx = s["content"]
                        break
                if ctx is None:
                    raise SystemExit(f"no skill content for {cid}")
            messages = [{"role": "user", "content": ctx}, {"role": "user", "content": query}]
        else:
            messages = [{"role": "user", "content": spec["ctx"]}, {"role": "user", "content": query}]
        case_lines.append(
            json.dumps(
                {
                    "base_sha": old["base_sha"],
                    "case_id": cid,
                    "messages": messages,
                    "repo_id": old["repo_id"],
                    "repo_url": old["repo_url"],
                    "team_id": old["team_id"],
                },
                ensure_ascii=False,
            )
        )
        gold = {
            "case_id": cid,
            "expected_sequence": k["planned_sequence"],
            "gold_reason": spec["gold_reason"],
            "origin": (old_gold.get(cid) or {}).get("origin") or "pilot",
            "pair_id": None if role in ("distractor", "natural") else k.get("pair_id"),
            "should_call": bool(k["planned_sequence"]),
            "target_asset_ids": [k["target_asset_id"]] if k.get("target_asset_id") and k["planned_sequence"] else [],
            "tool_family": "none" if not k["planned_sequence"] else ("memory" if role.startswith("memory") else "skill"),
        }
        if not gold["should_call"]:
            gold["no_call_basis"] = "pair_context" if role.endswith("_neg") else ("distractor" if role == "distractor" else "natural_coding")
        if k.get("planned_file_path") and "files" in role and role.endswith("_pos"):
            gold["target_resource_paths"] = [k["planned_file_path"]]
        gold_lines.append(json.dumps(gold, ensure_ascii=False))
        ev = old_ev[cid]
        ev["original_prompt"] = query
        ev_lines.append(json.dumps(ev, ensure_ascii=False))

    (data / "cases.jsonl").write_text("\n".join(case_lines) + "\n", encoding="utf-8")
    (data / "gold.jsonl").write_text("\n".join(gold_lines) + "\n", encoding="utf-8")
    (data / "evidence.jsonl").write_text("\n".join(ev_lines) + "\n", encoding="utf-8")


def validate(keeps_by_team: dict[str, list]) -> None:
    bad = []
    for team, keeps in keeps_by_team.items():
        if team == "DVG-THREAD-04-TEAM-01":
            continue
        cases = {}
        for line in (TEAMS / team / "data" / "cases.jsonl").read_text(encoding="utf-8").splitlines():
            rec = json.loads(line)
            cases[rec["case_id"]] = rec
        pairs = {}
        for k in keeps:
            if k.get("pair_id") and k["role"] not in ("distractor", "natural"):
                pairs.setdefault(k["pair_id"], []).append(k)
        for pid, ks in pairs.items():
            pos = next(x for x in ks if x["role"].endswith("_pos"))
            neg = next(x for x in ks if x["role"].endswith("_neg"))
            q1 = cases[pos["case_id"]]["messages"][-1]["content"]
            q2 = cases[neg["case_id"]]["messages"][-1]["content"]
            if q1 != q2:
                bad.append(f"{pid} query mismatch")
            blob = q1 + cases[pos["case_id"]]["messages"][0]["content"]
            if "tdai_" in blob or "should_call" in blob:
                bad.append(f"{pos['case_id']} leaked tool")
    if bad:
        raise SystemExit("validate: " + "; ".join(bad))


def main() -> None:
    keeps = load_keep()
    by_team: dict[str, list] = {}
    for k in keeps:
        by_team.setdefault(k["team_id"], []).append(k)
    for team, rows in by_team.items():
        if team == "DVG-THREAD-04-TEAM-01":
            continue
        patch_assets(team)
        rewrite_team(team, rows)
        print("rewrote", team, len(rows))
    validate(by_team)
    print("ok")


if __name__ == "__main__":
    main()
