import type { JsonValueV2 } from "./types.js";

/** Wildcards are explicit array membership selectors, never object traversal. */
export function readJsonValues(root: JsonValueV2 | undefined, path: string): (JsonValueV2 | undefined)[] {
  return path.split(".").reduce<(JsonValueV2 | undefined)[]>((values, segment) => values.flatMap(value =>
    segment === "*" ? Array.isArray(value) ? [...value] : [] : [readJsonPath(value, segment)]), [root]);
}

function isJsonArray(value: JsonValueV2 | undefined): value is readonly JsonValueV2[] {
  return Array.isArray(value);
}

export function readJsonPath(
  root: JsonValueV2 | undefined,
  path: string,
): JsonValueV2 | undefined {
  let current = root;
  for (const segment of path.split(".")) {
    if (isJsonArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (current && typeof current === "object") {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}
