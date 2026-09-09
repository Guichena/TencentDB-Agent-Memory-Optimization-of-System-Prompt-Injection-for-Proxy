import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES, FIXTURES } from "./case-definitions.js";

const root = dirname(fileURLToPath(import.meta.url));

function writeJsonl(path: string, values: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}

for (const split of ["dev", "test"] as const) {
  writeJsonl(resolve(root, "cases", `${split}.jsonl`), CASES.filter((item) => item.split === split));
}

writeJsonl(resolve(root, "fixtures", "fixtures.jsonl"), FIXTURES);

const frozenFiles = [
  "cases/dev.jsonl",
  "cases/test.jsonl",
  "cases/smoke-case-ids.json",
  "fixtures/fixtures.jsonl",
  "sources/manifest.json",
];
const files = Object.fromEntries(frozenFiles.map((relativePath) => {
  // Git stores every frozen benchmark input as LF via .gitattributes. Hash the
  // same canonical bytes even if a Windows editor has temporarily written the
  // working-tree copy with CRLF before it is staged.
  const content = Buffer.from(
    readFileSync(resolve(root, relativePath), "utf8").replace(/\r\n?/g, "\n"),
    "utf8",
  );
  return [relativePath, {
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.byteLength,
  }];
}));
writeFileSync(
  resolve(root, "dataset-manifest.json"),
  `${JSON.stringify({ schemaVersion: "1.0", files }, null, 2)}\n`,
  "utf8",
);

console.log(`generated ${CASES.length} cases and ${FIXTURES.length} fixtures`);
