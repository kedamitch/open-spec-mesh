import assert from 'node:assert/strict';
import test from 'node:test';
import { auditCoverage, CONTRACT_METHOD_COUNT, GPU_API_CASES, GPU_HELPER_CASE, inspectBaselineInventory } from '../../../scripts/verify_coverage.js';

test('frozen baseline inventory counts every test method without deleting the GPU helper case', () => {
  const inventory = inspectBaselineInventory();
  assert.equal(inventory.baseline, '767593cd18b076ed1d45211ae277141aaa97ef9f');
  assert.equal(inventory.moduleCount, 22);
  assert.equal(inventory.methodCount, CONTRACT_METHOD_COUNT + 1);
  assert.deepEqual(inventory.gpuApiCases, GPU_API_CASES);
  assert.deepEqual(inventory.gpuHelperCases, [GPU_HELPER_CASE]);
});

test('coverage audit fails closed on the 422-vs-423 contract mismatch and missing mapping', () => {
  const result = auditCoverage();
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('expects 422 test methods') && error.includes('contains 423')));
  assert.ok(result.errors.some((error) => error.includes('additional GPU helper')));
  assert.ok(result.errors.some((error) => error.includes('migration-coverage.json is not present')));
});
