import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildFormalCaseBindings,
  serializeFormalCaseBindings,
} from "./build-case-bindings.js";
import {
  buildFormalRuntimeFreezeManifest,
  serializeFormalRuntimeFreezeManifest,
} from "./build-runtime-freeze.js";
import {
  buildFormalSmokePreregistration,
  serializeFormalSmokePreregistration,
} from "./build-smoke-preregistration.js";
import { resolveFormalDataFreeze } from "./freeze.js";

const repositoryRoot = resolve(process.cwd(), "..");
const freeze = resolveFormalDataFreeze({ repositoryRoot });
const bindings = buildFormalCaseBindings({ freeze });
const smoke = buildFormalSmokePreregistration({ freeze });
const manifest = buildFormalRuntimeFreezeManifest({ freeze });

if (manifest.artifacts.caseBindings.fileSha256 !== bindings.fileSha256
  || manifest.artifacts.caseBindings.canonicalSha256 !== bindings.canonicalSha256) {
  throw new Error("rebuilt case bindings differ from runtime freeze manifest");
}
if (manifest.artifacts.devSmokePreregistration.selectionCanonicalSha256 !== smoke.sha256) {
  throw new Error("rebuilt smoke preregistration differs from runtime freeze manifest");
}

const frozenRoot = resolve(process.cwd(), "eval", "tool-prompt-bench", "formal-runtime", "frozen");
mkdirSync(frozenRoot, { recursive: true });
writeFileSync(resolve(frozenRoot, "case-bindings.jsonl"), serializeFormalCaseBindings(bindings.rows), "utf8");
writeFileSync(resolve(frozenRoot, "dev-smoke-preregistration.json"), serializeFormalSmokePreregistration(smoke), "utf8");
writeFileSync(resolve(frozenRoot, "formal-runtime-freeze.json"), serializeFormalRuntimeFreezeManifest(manifest), "utf8");

process.stdout.write(JSON.stringify({
  caseBindings: {
    count: bindings.count,
    fileSha256: bindings.fileSha256,
    canonicalSha256: bindings.canonicalSha256,
  },
  devSmoke: { count: smoke.caseIds.length, sha256: smoke.sha256 },
  formalMetricEligible: false,
}, null, 2));
