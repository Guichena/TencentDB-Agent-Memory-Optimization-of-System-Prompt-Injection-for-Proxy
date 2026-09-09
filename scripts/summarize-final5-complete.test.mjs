import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distribution, reportDirectory } from './summarize-final5-complete.mjs';
import { join } from 'node:path';
test('explicit corrected reports root takes precedence over stale legacy reports', () => {
  assert.equal(reportDirectory('original', 'claude-code', 'corrected'), join('corrected', 'claude-code'));
  assert.equal(reportDirectory('original', 'claude-code'), join('original', 'claude-code', 'report'));
});
test('nearest-rank quantiles and missing values are explicit', () => {
  assert.deepEqual(distribution([1, 2, 3, 4, null]), { count: 4, totalCount: 5, sum: 10, mean: 2.5, p50: 2, p95: 4, min: 1, max: 4 });
  assert.equal(distribution([null]).mean, null);
  assert.equal(distribution([0]).mean, 0);
  assert.equal(distribution(Array.from({ length: 10 }, (_, i) => i + 1)).p95, 10);
});
