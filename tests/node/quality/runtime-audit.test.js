import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyLockAndManifest, verifyRootIgnore, verifyStaticSource } from '../../../scripts/check_runtime.js';

test('root node_modules is ignored without generalizing to nested dependencies and lockfiles stay trackable', () => {
  assert.deepEqual(verifyRootIgnore(), {
    rootDependencyIgnored: true,
    nestedDependencyVisible: true,
    bothLocksTrackable: true,
    userSentinelPreserved: true,
  });
});

test('publication lock is byte-identical, package stays private, and runtime entry resources exist', () => {
  const result = verifyLockAndManifest();
  assert.equal(result.locksByteIdentical, true);
  assert.equal(result.private, true);
  assert.equal(result.engine, '>=24.21.0');
  assert.equal(result.lockfileVersion, 3);
});

test('active Node source has no legacy task-path authorization or Python fallback', () => {
  const result = verifyStaticSource();
  assert.ok(result.scannedRuntimeFiles > 0);
  assert.equal(result.noPathGate, true);
  assert.equal(result.noPythonFallback, true);
});
