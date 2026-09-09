import {
  CanonicalJsonError,
  canonicalJsonClone,
  canonicalSha256,
  type CanonicalJsonValue,
} from "./canonical-json.js";

export const PROVIDER_USAGE_FIELDS = [
  "providerTotalInputTokens",
  "ordinaryInputTokens",
  "cacheReadInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningOrThinkingTokens",
] as const;

export type ProviderUsageField = (typeof PROVIDER_USAGE_FIELDS)[number];

export type ProviderUsageSchema =
  | "openai.responses"
  | "openai.chat-completions"
  | "openai.codex-jsonl"
  | "anthropic.messages";

export type ProviderUsageFieldState =
  | "reported"
  | "derived"
  | "missing"
  | "unsupported"
  | "invalid";

export interface NormalizeProviderUsageInput {
  provider: "openai" | "anthropic";
  schema: ProviderUsageSchema;
  apiVersion: string;
  adapterVersion: string;
  requiredFields: readonly ProviderUsageField[];
  /** Fields frozen as unavailable for this exact provider/API/adapter contract. */
  unsupportedFields: readonly ProviderUsageField[];
  rawUsage: unknown;
}

export interface NormalizedProviderUsage {
  providerTotalInputTokens: number | null;
  ordinaryInputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  outputTokens: number | null;
  reasoningOrThinkingTokens: number | null;
  usageCompleteForRequiredFields: boolean;
  unsupportedOptionalFields: ProviderUsageField[];
}

export interface ProviderUsageInfrastructureError {
  code:
    | "PROVIDER_SCHEMA_MISMATCH"
    | "REQUIRED_USAGE_MISSING"
    | "INVALID_USAGE_VALUE"
    | "RAW_USAGE_NOT_CANONICAL_JSON"
    | "UNSUPPORTED_USAGE_FIELD_REPORTED"
    | "USAGE_IDENTITY_MISMATCH";
  field?: ProviderUsageField;
  message: string;
}

export interface ProviderUsageNormalizationResult {
  ok: boolean;
  provider: NormalizeProviderUsageInput["provider"];
  schema: ProviderUsageSchema;
  apiVersion: string;
  adapterVersion: string;
  requiredFields: ProviderUsageField[];
  unsupportedFields: ProviderUsageField[];
  rawUsageCanonicalizationStatus: "ready" | "blocked";
  rawUsageCanonicalClone: CanonicalJsonValue | null;
  rawUsageSha256: string | null;
  canonicalSha256: string;
  fieldStates: Record<ProviderUsageField, ProviderUsageFieldState>;
  usage: NormalizedProviderUsage | null;
  errors: ProviderUsageInfrastructureError[];
}

type UsageValues = Record<ProviderUsageField, number | null>;

function nestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function reportedInteger(
  record: Record<string, unknown>,
  key: string,
  field: ProviderUsageField,
  values: UsageValues,
  states: Record<ProviderUsageField, ProviderUsageFieldState>,
  errors: ProviderUsageInfrastructureError[],
): void {
  if (!(key in record)) return;
  if (states[field] === "unsupported") {
    states[field] = "invalid";
    errors.push({
      code: "UNSUPPORTED_USAGE_FIELD_REPORTED",
      field,
      message: `${key} was reported by an adapter contract that froze ${field} as unsupported`,
    });
    return;
  }
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    states[field] = "invalid";
    errors.push({
      code: "INVALID_USAGE_VALUE",
      field,
      message: `${key} must be a non-negative safe integer`,
    });
    return;
  }
  values[field] = value;
  states[field] = "reported";
}

function emptyValues(): UsageValues {
  return Object.fromEntries(PROVIDER_USAGE_FIELDS.map((field) => [field, null])) as UsageValues;
}

function emptyStates(): Record<ProviderUsageField, ProviderUsageFieldState> {
  return Object.fromEntries(PROVIDER_USAGE_FIELDS.map((field) => [field, "missing"])) as Record<ProviderUsageField, ProviderUsageFieldState>;
}

export function normalizeProviderUsage(input: NormalizeProviderUsageInput): ProviderUsageNormalizationResult {
  const values = emptyValues();
  const fieldStates = emptyStates();
  const errors: ProviderUsageInfrastructureError[] = [];
  let rawUsageCanonicalClone: CanonicalJsonValue | null = null;
  let rawUsageSha256: string | null = null;
  let rawUsageCanonicalizationStatus: "ready" | "blocked" = "ready";
  try {
    rawUsageCanonicalClone = canonicalJsonClone(input.rawUsage);
    rawUsageSha256 = canonicalSha256(rawUsageCanonicalClone);
  } catch (error) {
    if (!(error instanceof CanonicalJsonError)) throw error;
    rawUsageCanonicalizationStatus = "blocked";
    errors.push({
      code: "RAW_USAGE_NOT_CANONICAL_JSON",
      message: error.message,
    });
  }
  const expectedProvider = input.schema.startsWith("openai.") ? "openai" : "anthropic";

  for (const field of input.unsupportedFields) {
    fieldStates[field] = "unsupported";
  }

  if (input.provider !== expectedProvider) {
    errors.push({
      code: "PROVIDER_SCHEMA_MISMATCH",
      message: `schema ${input.schema} does not belong to provider ${input.provider}`,
    });
  }

  const raw = input.rawUsage !== null && typeof input.rawUsage === "object" && !Array.isArray(input.rawUsage)
    ? input.rawUsage as Record<string, unknown>
    : {};

  if (input.schema === "openai.responses") {
    reportedInteger(raw, "input_tokens", "providerTotalInputTokens", values, fieldStates, errors);
    reportedInteger(raw, "output_tokens", "outputTokens", values, fieldStates, errors);

    const inputDetails = nestedRecord(raw, "input_tokens_details");
    if (inputDetails) {
      reportedInteger(inputDetails, "cached_tokens", "cacheReadInputTokens", values, fieldStates, errors);
      if ("cache_write_tokens" in inputDetails) {
        reportedInteger(inputDetails, "cache_write_tokens", "cacheWriteInputTokens", values, fieldStates, errors);
      }
    }
    const outputDetails = nestedRecord(raw, "output_tokens_details");
    if (outputDetails) {
      reportedInteger(outputDetails, "reasoning_tokens", "reasoningOrThinkingTokens", values, fieldStates, errors);
    }
    const total = values.providerTotalInputTokens;
    const cached = values.cacheReadInputTokens;
    const writeKnown = fieldStates.cacheWriteInputTokens === "reported"
      || fieldStates.cacheWriteInputTokens === "unsupported";
    const written = values.cacheWriteInputTokens ?? 0;
    if (total !== null && cached !== null && writeKnown) {
      if (cached + written > total) {
        errors.push({
          code: "USAGE_IDENTITY_MISMATCH",
          field: "cacheReadInputTokens",
          message: "OpenAI cache read and write tokens cannot exceed total input tokens",
        });
      } else {
        values.ordinaryInputTokens = total - cached - written;
        fieldStates.ordinaryInputTokens = "derived";
      }
    }
  }

  if (input.schema === "openai.chat-completions") {
    reportedInteger(raw, "prompt_tokens", "providerTotalInputTokens", values, fieldStates, errors);
    reportedInteger(raw, "completion_tokens", "outputTokens", values, fieldStates, errors);

    const promptDetails = nestedRecord(raw, "prompt_tokens_details");
    if (promptDetails) {
      reportedInteger(promptDetails, "cached_tokens", "cacheReadInputTokens", values, fieldStates, errors);
    }
    const completionDetails = nestedRecord(raw, "completion_tokens_details");
    if (completionDetails) {
      reportedInteger(completionDetails, "reasoning_tokens", "reasoningOrThinkingTokens", values, fieldStates, errors);
    }
    const total = values.providerTotalInputTokens;
    const cached = values.cacheReadInputTokens;
    if (total !== null && cached !== null) {
      if (cached > total) {
        errors.push({
          code: "USAGE_IDENTITY_MISMATCH",
          field: "cacheReadInputTokens",
          message: "OpenAI cached input tokens cannot exceed total input tokens",
        });
      } else {
        values.ordinaryInputTokens = total - cached;
        fieldStates.ordinaryInputTokens = "derived";
      }
    }
  }

  if (input.schema === "openai.codex-jsonl") {
    reportedInteger(raw, "input_tokens", "providerTotalInputTokens", values, fieldStates, errors);
    reportedInteger(raw, "cached_input_tokens", "cacheReadInputTokens", values, fieldStates, errors);
    reportedInteger(raw, "cache_write_input_tokens", "cacheWriteInputTokens", values, fieldStates, errors);
    reportedInteger(raw, "output_tokens", "outputTokens", values, fieldStates, errors);
    reportedInteger(raw, "reasoning_output_tokens", "reasoningOrThinkingTokens", values, fieldStates, errors);

    const total = values.providerTotalInputTokens;
    const read = values.cacheReadInputTokens;
    const write = values.cacheWriteInputTokens;
    if (total !== null && read !== null && write !== null) {
      if (read + write > total) {
        errors.push({
          code: "USAGE_IDENTITY_MISMATCH",
          field: "providerTotalInputTokens",
          message: "Codex cache read and write tokens cannot exceed total input tokens",
        });
      } else {
        values.ordinaryInputTokens = total - read - write;
        fieldStates.ordinaryInputTokens = "derived";
      }
    }
  }

  if (input.schema === "anthropic.messages") {
    reportedInteger(raw, "input_tokens", "ordinaryInputTokens", values, fieldStates, errors);
    reportedInteger(raw, "cache_read_input_tokens", "cacheReadInputTokens", values, fieldStates, errors);
    reportedInteger(raw, "cache_creation_input_tokens", "cacheWriteInputTokens", values, fieldStates, errors);
    reportedInteger(raw, "output_tokens", "outputTokens", values, fieldStates, errors);
    const ordinary = values.ordinaryInputTokens;
    const read = values.cacheReadInputTokens;
    const write = values.cacheWriteInputTokens;
    if (ordinary !== null && read !== null && write !== null) {
      values.providerTotalInputTokens = ordinary + read + write;
      fieldStates.providerTotalInputTokens = "derived";
    }
  }

  const output = values.outputTokens;
  const reasoning = values.reasoningOrThinkingTokens;
  if (output !== null && reasoning !== null && reasoning > output) {
    errors.push({
      code: "USAGE_IDENTITY_MISMATCH",
      field: "reasoningOrThinkingTokens",
      message: "reasoning or thinking tokens cannot exceed output tokens",
    });
  }

  for (const field of input.requiredFields) {
    if (fieldStates[field] !== "reported" && fieldStates[field] !== "derived") {
      errors.push({
        code: "REQUIRED_USAGE_MISSING",
        field,
        message: `required usage field ${field} is ${fieldStates[field]}`,
      });
    }
  }

  const unsupportedOptionalFields = PROVIDER_USAGE_FIELDS.filter(
    (field) => fieldStates[field] === "unsupported" && !input.requiredFields.includes(field),
  );
  const ok = errors.length === 0;
  const usage = ok
    ? {
        ...values,
        usageCompleteForRequiredFields: true,
        unsupportedOptionalFields,
      }
    : null;

  const withoutCanonicalSha = {
    ok,
    provider: input.provider,
    schema: input.schema,
    apiVersion: input.apiVersion,
    adapterVersion: input.adapterVersion,
    requiredFields: [...input.requiredFields],
    unsupportedFields: [...input.unsupportedFields],
    rawUsageCanonicalizationStatus,
    rawUsageCanonicalClone,
    rawUsageSha256,
    fieldStates,
    usage,
    errors,
  };
  return {
    ...withoutCanonicalSha,
    canonicalSha256: canonicalSha256(withoutCanonicalSha),
  };
}
