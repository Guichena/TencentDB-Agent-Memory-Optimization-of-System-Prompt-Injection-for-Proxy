import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

/** Shared catch category for all canonical JSON contract violations. */
export class CanonicalJsonError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

/** Persisted M1 validation identity retained for backwards compatibility. */
export class CanonicalJsonValidationError extends CanonicalJsonError {
  readonly code = "INVALID_CANONICAL_JSON_VALUE" as const;

  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonValidationError";
  }
}

function invalidCanonicalJson(message: string): never {
  throw new CanonicalJsonValidationError(message);
}

function cloneCanonical(
  value: unknown,
  ancestors: WeakSet<object>,
): CanonicalJsonValue {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      return invalidCanonicalJson(
        "canonical JSON numbers must be finite and must not be negative zero",
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    return invalidCanonicalJson(
      "canonical JSON accepts only JSON scalar, array, and record values",
    );
  }
  if (nodeTypes.isProxy(value)) {
    return invalidCanonicalJson("canonical JSON must not inspect Proxy values");
  }
  if (ancestors.has(value)) {
    return invalidCanonicalJson("canonical JSON must not contain cycles");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        return invalidCanonicalJson("canonical JSON arrays must use Array.prototype");
      }
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== value.length + 1) {
        return invalidCanonicalJson("canonical JSON arrays must be dense and undecorated");
      }
      if (ownKeys.some((key) => (
        typeof key !== "string"
        || (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key))
      ))) {
        return invalidCanonicalJson("canonical JSON arrays must not have decorated properties");
      }

      const result: CanonicalJsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined
          || !descriptor.enumerable
          || !("value" in descriptor)
        ) {
          return invalidCanonicalJson(
            "canonical JSON arrays must contain dense enumerable data properties",
          );
        }
        result.push(cloneCanonical(descriptor.value, ancestors));
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidCanonicalJson(
        "canonical JSON records must use Object.prototype or a null prototype",
      );
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      return invalidCanonicalJson("canonical JSON records must not contain symbol keys");
    }

    const result = Object.create(null) as { [key: string]: CanonicalJsonValue };
    for (const key of (ownKeys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || !descriptor.enumerable
        || !("value" in descriptor)
      ) {
        return invalidCanonicalJson(
          "canonical JSON records require enumerable data properties",
        );
      }
      Object.defineProperty(result, key, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: cloneCanonical(descriptor.value, ancestors),
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function freezeCanonical(value: CanonicalJsonValue): CanonicalJsonValue {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeCanonical(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Produce a detached, recursively frozen JSON clone. Runtime-only values and
 * lossy JSON shapes fail closed so distinct inputs cannot share an identity.
 */
export function canonicalJsonClone(value: unknown): CanonicalJsonValue {
  try {
    return freezeCanonical(cloneCanonical(value, new WeakSet()));
  } catch (error) {
    if (error instanceof CanonicalJsonValidationError) throw error;
    throw new CanonicalJsonValidationError(
      "canonical JSON validation could not inspect the runtime value",
    );
  }
}

function serializeCanonical(value: CanonicalJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeCanonical(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeCanonical(value[key])}`)
    .join(",")}}`;
}

export function canonicalJson(value: unknown): string {
  return serializeCanonical(canonicalJsonClone(value));
}

/** M1-compatible name for the shared canonical serializer. */
export function canonicalJsonV2(value: unknown): string {
  return canonicalJson(value);
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** M1-compatible name for the shared canonical digest. */
export function sha256CanonicalJsonV2(value: unknown): string {
  return canonicalSha256(value);
}

export function utf8Sha256(value: string): string {
  if (typeof value !== "string") {
    return invalidCanonicalJson("UTF-8 SHA-256 input must be a string");
  }
  return createHash("sha256").update(value, "utf8").digest("hex");
}
