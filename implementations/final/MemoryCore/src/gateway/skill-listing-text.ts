/** Listing markup belongs to the renderer; all names/descriptions are text. */
export function renderSkillListingText(items: readonly { name: string; description: string }[], charBudget: number): string {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const open = "<available_skills>\n";
  const close = "\n</available_skills>";
  const body = items.length ? items.map(s => `- ${escape(s.name)}: ${escape(s.description)}`).join("\n") : "(none)";
  if (open.length + body.length + close.length <= charBudget) return open + body + close;
  // An explicit tiny budget cannot fit an envelope. Return no listing, never a
  // partially opened tag. The caller still reports hits independently.
  const marker = "\n... [truncated]";
  const capacity = charBudget - open.length - marker.length - close.length;
  if (capacity < 0) return "";
  let cut = body.slice(0, capacity);
  // Do not split an escaped entity or a UTF-16 surrogate pair.
  cut = cut.replace(/&[^;\s]*$/, "").replace(/[\uD800-\uDBFF]$/, "");
  return open + cut + marker + close;
}
