/**
 * AgentContext factory functions and utility methods.
 */

import type {
  AgentContext,
  AgentContextMetadata,
  ContextBlock,
  ContextMessage,
  MessageRole,
} from "./types.js";

/**
 * Create a minimal AgentContext with the given messages and metadata.
 */
export function createAgentContext(
  messages: ContextMessage[],
  requestParams: Record<string, unknown>,
  metadata: AgentContextMetadata,
): AgentContext {
  return {
    messages,
    requestParams,
    metadata,
  };
}

/**
 * Create a text-only ContextBlock.
 */
export function textBlock(content: string, metadata?: Record<string, unknown>): ContextBlock {
  return { type: "text", content, metadata };
}

/**
 * Create a ContextMessage with a single text block.
 */
export function textMessage(role: MessageRole, content: string): ContextMessage {
  return { role, blocks: [{ type: "text", content }] };
}

/**
 * Get the system message from context (first system role message).
 * Returns undefined if no system message exists.
 */
export function getSystemMessage(ctx: AgentContext): ContextMessage | undefined {
  return ctx.messages.find((m) => m.role === "system");
}

/**
 * Get the full text content of a message (all text blocks concatenated).
 */
export function getMessageText(msg: ContextMessage): string {
  return msg.blocks
    .filter((b) => b.type === "text")
    .map((b) => b.content)
    .join("\n");
}

/**
 * Get the last user message from context.
 */
export function getLastUserMessage(ctx: AgentContext): ContextMessage | undefined {
  for (let i = ctx.messages.length - 1; i >= 0; i--) {
    if (ctx.messages[i].role === "user") return ctx.messages[i];
  }
  return undefined;
}

/**
 * Check if this context has only a single user turn (first turn).
 */
export function isFirstTurn(ctx: AgentContext): boolean {
  return ctx.messages.filter((m) => m.role === "user").length === 1;
}

/**
 * Insert a text block at the beginning of a message's blocks.
 */
export function prependTextToMessage(msg: ContextMessage, text: string): void {
  msg.blocks.unshift({ type: "text", content: text });
}

/**
 * Append a text block at the end of a message's blocks.
 */
export function appendTextToMessage(msg: ContextMessage, text: string): void {
  msg.blocks.push({ type: "text", content: text });
}

/** Apply a local anchor edit without collapsing provider cache boundaries.
 * A structural rebuild that crosses blocks cannot preserve their boundary
 * meaning; the caller must use its documented coarse insertion fallback. */
export function replaceAnchoredText(msg: ContextMessage, next: string): boolean {
  const previous = getMessageText(msg);
  if (previous === next) return true;
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let end = previous.length;
  let nextEnd = next.length;
  while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  const replacement = next.slice(start, nextEnd);
  let offset = 0;
  for (let index = 0; index < msg.blocks.length; index++) {
    const block = msg.blocks[index]!;
    if (block.type !== "text") continue;
    const boundary = offset + block.content.length;
    if (start >= offset && end <= boundary) {
      // At an existing endpoint, appending must not extend its cache prefix.
      if (start === boundary && end === boundary && block.metadata?.cache_control !== undefined) {
        if (!replacement.startsWith("\n")) return false;
        msg.blocks.splice(index + 1, 0, { type: "text", content: replacement.slice(1) });
      } else {
        msg.blocks[index] = { ...block, content: block.content.slice(0, start - offset)
          + replacement + block.content.slice(end - offset) };
      }
      return true;
    }
    offset = boundary + 1;
  }
  return false;
}
