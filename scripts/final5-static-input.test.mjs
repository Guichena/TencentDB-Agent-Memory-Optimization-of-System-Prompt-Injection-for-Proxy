import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStatic } from './final5-static-input.mjs';

test('V4 counts shared rules, runtime bindings and listing guidance, not the asset text', () => {
  const text = 'Native instructions\n## Available skills\nRoute skill\n<available_skills>\n- a: dynamic description\n</available_skills>\n'
    + '<task1_prompt_injection>\nShared protocol\n<skill_tools>\ncard\n</skill_tools>\n## Runtime bindings\nendpoint: local\n</task1_prompt_injection>';
  const x = extractStatic(text, 'V4');
  assert.ok(x.staticText.includes('Shared protocol'));
  assert.ok(x.staticText.includes('Route skill'));
  assert.ok(x.staticText.includes('endpoint: local'));
  assert.ok(!x.staticText.includes('dynamic description'));
  assert.equal(x.assetText, '- a: dynamic description\n');
  assert.equal(x.remainder.trim(), 'Native instructions');
});
test('baseline extracts complete cards and mandatory routing around the listing', () => {
  const text = '<skill_tools>\nreference <available_skills> inline\n</skill_tools>\n'
    + '## Skills (mandatory)\nMUST load\n<available_skills>\n- a: dynamic\n</available_skills>\nOnly proceed without loading a skill if genuinely none are relevant to the task.\n'
    + '<tdai_memory_tools>\ncard\n</tdai_memory_tools>\n<memory-tools-guide>\nguide\n</memory-tools-guide>';
  const x = extractStatic(text, 'server_team');
  assert.ok(x.staticText.includes('MUST load'));
  assert.ok(x.staticText.includes('Only proceed'));
  assert.ok(x.staticText.includes('reference <available_skills> inline'));
  assert.ok(!x.staticText.includes('- a: dynamic'));
  assert.equal(x.remainder.trim(), '');
  assert.throws(() => extractStatic(text.replace('</skill_tools>', ''), 'server_team'));
});
test('unknown runtime asset placement blocks a misleading static total', () => {
  const text = '## Available skills\nroute\n<available_skills>\na\n</available_skills>\n<task1_prompt_injection>\n## Runtime assets\nunknown\n</task1_prompt_injection>';
  assert.throws(() => extractStatic(text, 'V4'), /Unmapped runtime assets/);
});
