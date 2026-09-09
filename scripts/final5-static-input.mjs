import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { distribution } from './summarize-final5-complete.mjs';

const hash = s => createHash('sha256').update(s).digest('hex');
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const lines = p => readFileSync(p, 'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
export function systemText(body, client) {
  const content = x => typeof x === 'string' ? x : Array.isArray(x) ? x.map(b => b.text ?? '').join('\n\n') : '';
  return client === 'claude-code' ? content(body.system) : (body.input ?? []).filter(x => x.role === 'developer' || x.role === 'system').map(x => content(x.content)).join('\n\n');
}
function one(text, re) {
  const matches = [...text.matchAll(re)];
  assert.equal(matches.length, 1, 'Expected one complete injection boundary: ' + re);
  const m = matches[0];
  return { start: m.index, end: m.index + m[0].length, text: m[0] };
}
const tag = name => new RegExp('^<' + name + '>\\r?\\n[\\s\\S]*?^</' + name + '>', 'gm');
export function extractStatic(text, variant) {
  const sections = [];
  if (variant === 'V4') {
    const bundle = one(text, tag('task1_prompt_injection'));
    assert.ok(!bundle.text.includes('## Runtime assets'), 'Unmapped runtime assets: refuse static overcount');
    sections.push({ name: 'full-tool-bundle', ...bundle });
  } else {
    for (const name of ['skill_tools', 'tdai_memory_tools', 'memory-tools-guide']) sections.push({ name, ...one(text, tag(name)) });
    if (/^<knowledge_tools>$/m.test(text)) sections.push({ name: 'knowledge_tools', ...one(text, tag('knowledge_tools')) });
  }
  const listing = variant === 'V4' ? one(text, /^## Available skills\r?\n[\s\S]*?^<\/available_skills>/gm)
    : one(text, /^## Skills \(mandatory\)\r?\n[\s\S]*?^Only proceed without loading a skill if genuinely none are relevant to the task\./gm);
  const inventory = one(listing.text, tag('available_skills'));
  const openEnd = inventory.text.indexOf('\n') + 1;
  const close = inventory.text.lastIndexOf('</available_skills>');
  const assetText = inventory.text.slice(openEnd, close);
  const staticListing = listing.text.slice(0, inventory.start + openEnd) + listing.text.slice(inventory.start + close);
  sections.push({ name: 'listing-guidance', ...listing, staticText: staticListing });
  sections.sort((a, b) => a.start - b.start);
  for (let i = 1; i < sections.length; i++) assert.ok(sections[i].start >= sections[i - 1].end, 'Overlapping extraction');
  const staticText = sections.map(x => x.staticText ?? x.text).join('\n\n');
  let remainder = text;
  for (const s of [...sections].reverse()) remainder = remainder.slice(0, s.start) + remainder.slice(s.end);
  remainder = remainder.replace(tag('session_context'), '').replace(/^<\/?tdai_injections>\s*$/gm, '');
  return { staticText, assetText, remainder, sections: sections.map(x => ({ name: x.name, start: x.start, end: x.end, sha256: hash(x.text) })) };
}
export function measureStatic(root, tokenizerDirectory = fileURLToPath(new URL('../evaluation/MemoryProxy', import.meta.url))) {
  const require = createRequire(join(resolve(tokenizerDirectory), 'package.json'));
  const { get_encoding } = require('tiktoken');
  const version = JSON.parse(readFileSync(join(tokenizerDirectory, 'node_modules/tiktoken/package.json'), 'utf8')).version;
  const encoding = get_encoding('o200k_base');
  const ledger = { schemaVersion: 'final5.first-static-input.v1', tokenizer: { name: 'o200k_base', library: 'tiktoken', version },
    policy: 'One first task request per case. Complete injected static tool instructions including shared protocol, routing, listing wrapper, runtime-bound URLs/headers; exclude skill entries and session identity block. Encode the complete extracted text once in provider order, joined by two newlines; never add block counts. Outer tdai transport wrapper is excluded. This is rendered instruction length, not billed token cost. Post-hoc text-boundary extraction from frozen wire captures.', clients: {} };
  try {
    for (const client of ['codex', 'claude-code']) {
      const variants = {};
      for (const variant of ['server_team', 'V4']) {
        const receipt = read(join(root, client, variant, 'execution.json'));
        const cases = receipt.results.map(slot => {
          const path = join(slot.trace.evidenceDirectory ?? slot.trace.outputDir, 'http-events.jsonl');
          const events = lines(path), inputs = new Map(events.filter(x => x.type === 'input.start').map(x => [x.id, x]));
          const provider = events.find(x => x.type === 'provider.start' && inputs.has(x.parentId)
            && !(inputs.get(x.parentId).body?.messages?.length === 1 && !inputs.get(x.parentId).body?.tools?.length
              && JSON.stringify(inputs.get(x.parentId).body.messages[0].content).includes('Write the title in the predominant language of the session')));
          assert.ok(provider, 'Missing first task provider input');
          const incoming = inputs.get(provider.parentId);
          const actual = systemText(provider.body, client), original = systemText(incoming.body, client);
          const extracted = extractStatic(actual, variant);
          const normalize = s => s.replace(/\s+/gu, ' ').trim();
          const residualPreserved = normalize(extracted.remainder) === normalize(original);
          assert.ok(residualPreserved, 'Unaccounted prompt modification: ' + client + '/' + variant + '/' + slot.caseId);
          return { caseId: slot.caseId, providerRequestId: provider.id, path, sourceSha256: hash(readFileSync(path)),
            T_static: encoding.encode(extracted.staticText).length, T_dynamic_listing: encoding.encode(extracted.assetText).length,
            T_prompt: encoding.encode(actual).length, chars: extracted.staticText.length, utf8Bytes: Buffer.byteLength(extracted.staticText),
            staticSha256: hash(extracted.staticText), dynamicSha256: hash(extracted.assetText), residualPreserved,
            sections: extracted.sections, staticText: extracted.staticText };
        });
        variants[variant] = { cases, T_static: distribution(cases.map(x => x.T_static)), T_dynamic_listing: distribution(cases.map(x => x.T_dynamic_listing)), T_prompt: distribution(cases.map(x => x.T_prompt)) };
      }
      const pairs = variants.server_team.cases.map(b => {
        const v = variants.V4.cases.find(x => x.caseId === b.caseId);
        assert.equal(b.dynamicSha256, v.dynamicSha256, 'Frozen asset text changed between variants');
        return { caseId: b.caseId, baseline: b.T_static, V4: v.T_static, savingPercent: 100 * (1 - v.T_static / b.T_static) };
      });
      ledger.clients[client] = { variants, pairs, staticSavingPercent: 100 * (1 - variants.V4.T_static.sum / variants.server_team.T_static.sum) };
    }
    return ledger;
  } finally { encoding.free(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, second, third] = process.argv.slice(2);
  const output = third ?? second;
  if (!root || !output) throw new Error('Usage: final5-static-input.mjs <execution root> <output directory>');
  const data = measureStatic(resolve(root), third ? resolve(second) : undefined);
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'static-input.json'), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(Object.fromEntries(Object.entries(data.clients).map(([c, x]) => [c, { savingPercent: x.staticSavingPercent, baseline: x.variants.server_team.T_static, V4: x.variants.V4.T_static }]))));
}
