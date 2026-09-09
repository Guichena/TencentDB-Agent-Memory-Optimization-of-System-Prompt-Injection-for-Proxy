import {
  canonicalJson,
  canonicalSha256,
  utf8Sha256,
} from "../measurement-v2/canonical-json.js";

export { canonicalJson, canonicalSha256, utf8Sha256 };
export type { CanonicalJsonValue } from "../measurement-v2/canonical-json.js";

/** Exact UTF-8 bytes hash; no JSON parsing, sorting, or newline normalization. */
export function exactUtf8Sha256(value: string): string {
  return utf8Sha256(value);
}
