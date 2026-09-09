import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || ["formal-dataset", "runs", "node_modules"].includes(entry.name)) return [];
    const file = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(ts|mjs)$/.test(entry.name) ? [file] : [];
  });
}

it("keeps product code outside evaluation and rejects imports of the removed copy", () => {
  expect(sourceFiles(join(root, "src"))).toEqual([]);
  const staleImports: string[] = [];
  for (const file of [...sourceFiles(join(root, "eval")), ...sourceFiles(join(root, "tests"))]) {
    for (const entry of ts.preProcessFile(readFileSync(file, "utf8"), true, true).importedFiles) {
      if (!entry.fileName.startsWith(".")) continue;
      const target = resolve(dirname(file), entry.fileName);
      if (target.startsWith(join(root, "src") + sep)) {
        staleImports.push(`${relative(root, file)} -> ${entry.fileName}`);
      }
    }
  }
  expect(staleImports).toEqual([]);
}, 60000);
