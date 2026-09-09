import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function readClaudeEnv(path: string): Record<string, string> {
  const values = parseEnv(readFileSync(path, "utf8"));
  const allowed = ["TDAI_CLAUDE_UPSTREAM_URL", "TDAI_CLAUDE_PROVIDER_API_KEY", "TDAI_CLAUDE_MODEL", "TDAI_CLAUDE_PROXY_PORT"];
  const unknown = Object.keys(values).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error("Claude env only accepts URL, provider key and model; unexpected: " + unknown.join(", "));
  return Object.fromEntries(
    allowed.flatMap((key) => {
      const value = values[key];
      return typeof value === "string" ? [[key, value]] : [];
    }),
  );
}
