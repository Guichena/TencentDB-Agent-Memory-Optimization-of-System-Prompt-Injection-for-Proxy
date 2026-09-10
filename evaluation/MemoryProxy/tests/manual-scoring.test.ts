import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runClientStages } from '../eval/tool-prompt-bench/run-final5-dual.js';

describe('manual scoring boundary', () => {
  it('still executes baseline before V4 for the selected client', async () => {
    const visited: string[] = [];
    await runClientStages('codex', async (client, variant) => { visited.push(`${client}/${variant}`); });
    expect(visited).toEqual(['codex/server_team', 'codex/V4']);
  });

  it('keeps report generation out of the execution controller', () => {
    const source = readFileSync(new URL('../eval/tool-prompt-bench/run-final5-dual.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bcollectFinal5Evidence\s*\(/);
    expect(source).not.toMatch(/\bmergeStageReceipts\s*\(/);
    expect(source).not.toMatch(/import\s+.*from\s+["']\.\/collect-final5-evidence/);
  });
});
