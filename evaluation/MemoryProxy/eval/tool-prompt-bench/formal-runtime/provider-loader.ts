import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ProviderVisibleCase } from "../worlds/formal-schema.js";
import { canonicalSha256 } from "../worlds/formal-snapshot.js";
import type { FormalDataFreeze } from "./freeze.js";
import {
  loadRepoBackedSelection,
  repoBackedFilePath,
  REPO_BACKED_COUNTS,
} from "./repo-backed-selection.js";

export type FormalProviderSplit = "dev" | "hidden_test";
export type FormalReadText = (path: string) => string;

export interface LoadFormalProviderSplitInput {
  readonly freeze: FormalDataFreeze;
  readonly split: FormalProviderSplit;
  readonly allowHiddenTest?: true;
  readonly readText?: FormalReadText;
  readonly projection?: "repo-backed-v2.1";
}

export interface FormalProviderSplitData {
  readonly split: FormalProviderSplit;
  readonly count: number;
  readonly cases: readonly ProviderVisibleCase[];
  readonly fileSha256: string;
  readonly canonicalSha256: string;
  readonly formalMetricEligible: false;
}

const PROVIDER_KEYS = new Set(["caseId", "contextMessages", "language", "query"]);
const MESSAGE_KEYS = new Set(["content", "role"]);

function assertExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} has unexpected key: ${key}`);
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`${label} is missing key: ${key}`);
    }
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseProviderRow(value: unknown, lineNumber: number): ProviderVisibleCase {
  const label = `provider row ${lineNumber}`;
  const row = asRecord(value, label);
  assertExactKeys(row, PROVIDER_KEYS, "provider row");
  if (typeof row.caseId !== "string" || row.caseId.length === 0) {
    throw new Error(`${label}.caseId must be a non-empty string`);
  }
  if (row.language !== "zh" && row.language !== "en") {
    throw new Error(`${label}.language must be zh or en`);
  }
  if (!Array.isArray(row.contextMessages)) {
    throw new Error(`${label}.contextMessages must be an array`);
  }
  const contextMessages: ProviderVisibleCase["contextMessages"] = row.contextMessages.map((item, index) => {
    const message = asRecord(item, `${label}.contextMessages[${index}]`);
    assertExactKeys(message, MESSAGE_KEYS, `${label}.contextMessages[${index}]`);
    if (message.role !== "user" && message.role !== "assistant") {
      throw new Error(`${label}.contextMessages[${index}].role is invalid`);
    }
    if (typeof message.content !== "string") {
      throw new Error(`${label}.contextMessages[${index}].content must be a string`);
    }
    return {
      role: message.role as "user" | "assistant",
      content: message.content,
    };
  });
  contextMessages.forEach((message) => Object.freeze(message));
  Object.freeze(contextMessages);
  if (typeof row.query !== "string" || row.query.length === 0) {
    throw new Error(`${label}.query must be a non-empty string`);
  }
  const result: ProviderVisibleCase = {
    caseId: row.caseId,
    language: row.language,
    contextMessages,
    query: row.query,
  };
  return Object.freeze(result);
}

function providerPath(
  freeze: FormalDataFreeze,
  split: FormalProviderSplit,
  projection?: "repo-backed-v2.1",
): string {
  if (projection === "repo-backed-v2.1") {
    return repoBackedFilePath(
      freeze.datasetRoot,
      split === "dev" ? "provider-dev" : "provider-hidden",
    );
  }
  const fileName = split === "dev" ? "dev.jsonl" : "hidden.sealed.jsonl";
  return resolve(freeze.datasetRoot, "revisions", "formal-v2", "provider", fileName);
}

/**
 * Public/provider boundary. This function has no path to private Gold or Pair data.
 * Hidden authorization is checked before invoking the supplied reader.
 */
export function loadFormalProviderSplit(input: LoadFormalProviderSplitInput): FormalProviderSplitData {
  if (input.split === "hidden_test" && input.allowHiddenTest !== true) {
    throw new Error("hidden_test provider access is not authorized");
  }
  const readText = input.readText ?? ((path: string) => readFileSync(path, "utf8"));
  const path = providerPath(input.freeze, input.split, input.projection);
  const text = readText(path);
  const cases = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      try {
        return parseProviderRow(JSON.parse(line) as unknown, index + 1);
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(`provider row ${index + 1} is invalid JSON`, { cause: error });
        }
        throw error;
      }
    });
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.caseId)) throw new Error(`provider duplicate caseId: ${item.caseId}`);
    ids.add(item.caseId);
  }
  const fileSha256 = createHash("sha256").update(text.replace(/\r\n/gu, "\n"), "utf8").digest("hex");
  if (input.projection === "repo-backed-v2.1") {
    const selection = loadRepoBackedSelection({ datasetRoot: input.freeze.datasetRoot, readText });
    const fileId = input.split === "dev" ? "provider-dev" : "provider-hidden";
    if (cases.length !== REPO_BACKED_COUNTS[input.split === "dev" ? "dev" : "hiddenTest"]
      || fileSha256 !== selection.files[fileId].activeFileSha256) {
      throw new Error(`${fileId} does not match the repo-backed selection`);
    }
  }
  return Object.freeze({
    split: input.split,
    count: cases.length,
    cases: Object.freeze(cases),
    // Git may materialize JSONL with CRLF. The frozen data hash is over LF bytes.
    fileSha256,
    canonicalSha256: canonicalSha256(cases),
    formalMetricEligible: false as const,
  });
}
