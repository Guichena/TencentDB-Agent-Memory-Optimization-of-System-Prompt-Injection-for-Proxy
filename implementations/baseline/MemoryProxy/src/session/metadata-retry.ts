export interface MetadataRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (error: unknown, nextAttempt: number) => void;
}

export function isTransientMetadataError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_|socket hang up|HTTP (?:408|429|5\d\d)\b/i.test(message);
}

export async function withMetadataRetry<T>(
  operation: () => Promise<T>,
  options: MetadataRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientMetadataError(error)) throw error;
      options.onRetry?.(error, attempt + 1);
      await sleep(baseDelayMs * attempt);
    }
  }
}
