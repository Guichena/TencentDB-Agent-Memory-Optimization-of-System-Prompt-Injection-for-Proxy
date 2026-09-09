import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { repositoryInventory, bindWorkspaces } from './prepare-workspaces.mjs';

const row = { repoId: 'owner/project', repoUrl: 'https://github.com/owner/project', baseSha: 'a'.repeat(40), caseId: 'c1', repositoryPath: 'D:/old-machine' };
test('inventory deduplicates repositories and retains every required commit and case', () => {
  const items = repositoryInventory([row, { ...row, caseId: 'c2', baseSha: 'b'.repeat(40) }]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].caseIds, ['c1', 'c2']);
  assert.equal(items[0].commits.length, 2);
  assert.throws(() => repositoryInventory([{ ...row, repoId: '../escape' }]), /Invalid repository/);
});
test('binding validates required commits before claiming readiness', () => {
  const calls = [];
  const git = (directory, args) => {
    calls.push(args);
    return args[1] === '--show-toplevel' ? directory : args[1] === '--is-inside-work-tree' ? 'true' : '';
  };
  const result = bindWorkspaces([row], resolve('repositories'), git);
  assert.equal(result[0].repositoryPath, resolve('repositories/owner/project'));
  assert.equal(result[0].baseShaVerified, true);
  assert.ok(calls.some(args => args[0] === 'cat-file' && args[2] === row.baseSha + '^{commit}'));
  assert.throws(() => bindWorkspaces([row], resolve('repositories'), () => { throw new Error('missing'); }), /Workspace not ready/);
  assert.equal(row.repositoryPath, 'D:/old-machine');
});
