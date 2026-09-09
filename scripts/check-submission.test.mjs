import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkSubmission, localPath } from './check-submission.mjs';

test('boundary checks reject external paths and junction targets', () => {
  const temp = mkdtempSync(join(tmpdir(), 'submission-boundary-'));
  try {
    const root = join(temp, 'repo');
    const outside = join(temp, 'outside');
    mkdirSync(root); mkdirSync(outside);
    symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(localPath(root, root, 'runs/new'), join(root, 'runs/new'));
    assert.throws(() => localPath(root, root, '../outside'), /outside repository/);
    assert.throws(() => localPath(root, root, 'linked/new'), /outside repository/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('relocated submission checks require no env, CLI or installed packages', () => {
  const root = mkdtempSync(join(tmpdir(), 'submission-relocated-'));
  const put = (name, text = '') => {
    const target = join(root, name);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, text);
  };
  try {
    for (const variant of ['evaluation', 'implementations/baseline', 'implementations/final']) {
      put(`${variant}/MemoryProxy/package.json`, '{}');
      put(`${variant}/MemoryProxy/src/server.ts`);
    }
    put('evaluation/MemoryProxy/contracts/runtime-tool-contracts.ts');
    put('data/plan.json', '{}'); put('data/workspaces.json', '[]'); put('data/catalog.jsonl'); put('proxy.yaml');
    put('scripts/config.json', JSON.stringify({ baselineRoot: '../implementations/baseline', v4Root: '../implementations/final',
      proxyConfig: '../proxy.yaml', plan: '../data/plan.json', workspaceManifest: '../data/workspaces.json',
      teamsRoot: '../data', skillCatalogBindings: '../data/catalog.jsonl', envFile: '../evaluation/.env', outputRoot: '../runs/new' }));
    const report = checkSubmission(root, 'scripts/config.json');
    assert.equal(report.ok, true);
    assert.equal(report.checks.find(item => item.label === 'envFile').status, 'deferred');
    assert.equal(checkSubmission(root, 'scripts/config.json', true).ok, false);
    put('data/workspaces.json', '[{"repositoryPath":"../../outside"}]');
    assert.equal(checkSubmission(root, 'scripts/config.json', true).ok, false);
    put('scripts/config.json', '{broken');
    assert.equal(checkSubmission(root, 'scripts/config.json').ok, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
