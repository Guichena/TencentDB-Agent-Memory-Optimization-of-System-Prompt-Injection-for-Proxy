/** Development-only parent/child comparison of complete serialized requests.
 * This is a change-review gate, not a natural-language equivalence oracle. */
export interface ReviewedPromptRewrite { before: string; after: string; reason: string }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function assertFinalRequestEquivalent(parent: unknown, child: unknown, rewrites: readonly ReviewedPromptRewrite[] = []): void {
  let expected = canonical(parent);
  for (const rewrite of rewrites) {
    if (!rewrite.before || !rewrite.reason.trim() || rewrite.before === rewrite.after) throw new Error("rewrite needs distinct text and a review reason");
    const before = JSON.stringify(rewrite.before).slice(1, -1);
    const after = JSON.stringify(rewrite.after).slice(1, -1);
    if (expected.split(before).length !== 2) throw new Error("reviewed rewrite must identify exactly one parent fragment");
    expected = expected.replace(before, () => after);
  }
  if (expected !== canonical(child)) throw new Error("unreviewed final request delta (text, capability, binding or cache boundary)");
}
