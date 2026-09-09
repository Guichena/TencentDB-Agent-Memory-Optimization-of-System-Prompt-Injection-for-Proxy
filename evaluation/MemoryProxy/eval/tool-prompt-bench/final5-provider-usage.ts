import type { CaptureEvent } from "./final5-http-capture.js";
import { normalizeProviderUsage, PROVIDER_USAGE_FIELDS, type ProviderUsageSchema } from "./measurement-v2/provider-usage.js";

function decode(raw: string): any[] {
  try { return [JSON.parse(raw)]; } catch { /* SSE uses complete data frames. */ }
  return raw.replace(/\r\n/gu, "\n").split("\n\n").flatMap(frame => {
    const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return [];
    try { return [JSON.parse(data)]; } catch { return []; }
  });
}

export function providerUsageForRequest(start: CaptureEvent, end?: CaptureEvent) {
  const path = new URL(start.path!).pathname;
  const schema: ProviderUsageSchema = path.endsWith("/messages") ? "anthropic.messages" : path.endsWith("/responses") ? "openai.responses" : "openai.chat-completions";
  const frames = decode(end?.rawBody ?? "");
  const isSse = end?.contentType?.includes("text/event-stream") || /^\s*(event:|data:)/u.test(end?.rawBody ?? "");
  const protocolComplete = !isSse ? end?.type === "provider.end" : schema === "anthropic.messages"
    ? frames.some(frame => frame.type === "message_stop") : schema === "openai.responses"
      ? frames.some(frame => ["response.completed", "response.incomplete", "response.failed"].includes(frame.type))
      : /data:\s*\[DONE\]/u.test(end?.rawBody ?? "");
  const providerError = frames.some(frame => frame.type === "error" || frame.type === "response.failed" || frame.error || frame.response?.status === "failed" || frame.status === "failed");
  const succeeded = end?.type === "provider.end" && end.status !== undefined && end.status >= 200 && end.status < 300 && protocolComplete && !providerError;
  let rawUsage: any = null;
  for (const frame of frames) {
    if (schema === "anthropic.messages") {
      const usage = frame.type === "message_start" ? frame.message?.usage : frame.usage;
      if (usage) rawUsage = { ...(rawUsage ?? {}), ...usage };
    } else if (frame.response?.usage) rawUsage = frame.response.usage;
    else if (frame.usage) rawUsage = frame.usage;
  }
  const normalization = rawUsage === null ? null : normalizeProviderUsage({ provider: schema === "anthropic.messages" ? "anthropic" : "openai",
    schema, apiVersion: "captured-wire", adapterVersion: "final5-provider-v1", requiredFields: [], unsupportedFields: [], rawUsage });
  return { requestId: start.id, sessionId: start.sessionId, parentId: start.parentId, schema, firstContentDurationMs: end?.firstContentDurationMs ?? null,
    providerRequestId: end?.providerRequestId ?? null, status: end?.status ?? null,
    transportComplete: end?.type === "provider.end", protocolComplete, succeeded, normalization, durationMs: end?.durationMs ?? null };
}

/** De-duplicate capture records, never add CLI totals to the same provider requests. */
export function summarizeProviderUsage(events: readonly CaptureEvent[]) {
  const starts = new Map<string, CaptureEvent>(), ends = new Map<string, CaptureEvent>();
  for (const event of events) {
    const map = event.type === "provider.start" ? starts : event.type === "provider.end" || event.type === "provider.failed" ? ends : null;
    if (!map) continue;
    const old = map.get(event.id);
    if (old && JSON.stringify(old) !== JSON.stringify(event)) throw new Error("Conflicting provider capture for " + event.id);
    map.set(event.id, event);
  }
  for (const id of ends.keys()) if (!starts.has(id)) throw new Error("Orphan provider completion: " + id);
  const requests = [...starts.values()].map(start => providerUsageForRequest(start, ends.get(start.id)));
  return aggregateProviderUsage(requests);
}

export function aggregateProviderUsage(requests: readonly ReturnType<typeof providerUsageForRequest>[], includeFailed = false) {
  if (new Set(requests.map(row => row.requestId)).size !== requests.length) throw new Error("Duplicate provider request in aggregate");
  const selected = includeFailed ? requests : requests.filter(row => row.succeeded);
  const fields = Object.fromEntries(PROVIDER_USAGE_FIELDS.map(field => {
    const known = selected.flatMap(row => row.transportComplete && row.protocolComplete && row.normalization?.ok && row.normalization.usage?.[field] !== null && row.normalization.usage?.[field] !== undefined ? [row.normalization.usage[field] as number] : []);
    const knownSum = known.reduce((sum, value) => sum + value, 0);
    return [field, { value: selected.length > 0 && known.length === selected.length ? knownSum : null, knownSum, coveredRequests: known.length, totalRequests: selected.length }];
  })) as Record<typeof PROVIDER_USAGE_FIELDS[number], { value: number | null; knownSum: number; coveredRequests: number; totalRequests: number }>;
  const denominator = fields.providerTotalInputTokens.value, numerator = fields.cacheReadInputTokens.value;
  return { source: "provider-http-only" as const, policy: includeFailed ? "all-attempts-diagnostic" : "successful-provider-requests-only",
    requestCount: selected.length, observedRequestCount: requests.length, failedRequestCount: requests.filter(row => !row.succeeded).length,
    requests, fields,
    cacheReadRatio: numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null };
}
