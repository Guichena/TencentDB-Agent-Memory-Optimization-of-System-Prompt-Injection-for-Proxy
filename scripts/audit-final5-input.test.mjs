import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wireUsage } from './audit-final5-input.mjs';
test('Anthropic cached input is separate and output deltas are cumulative', () => {
  const raw = [{ type: 'message_start', message: { id: 'fixture', usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 1 } } },
    { type: 'message_delta', usage: { output_tokens: 4 } }, { type: 'message_delta', usage: { output_tokens: 8 } }, { type: 'message_stop' }].map(x => 'data: ' + JSON.stringify(x) + '\n\n').join('');
  const x = wireUsage(raw, true);
  assert.equal(x.providerTotalInputTokens, 60);
  assert.equal(x.ordinaryInputTokens, 10);
  assert.equal(x.outputTokens, 8);
});
test('Responses cache is already part of total input', () => {
  const x = wireUsage(JSON.stringify({ usage: { input_tokens: 60, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 }, output_tokens: 8 } }), false);
  assert.equal(x.providerTotalInputTokens, 60);
  assert.equal(x.ordinaryInputTokens, 40);
});
