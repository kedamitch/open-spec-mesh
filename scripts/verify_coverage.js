#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASELINE = '767593cd18b076ed1d45211ae277141aaa97ef9f';
export const CONTRACT_METHOD_COUNT = 422;
export const CONTRACT_MODULE_COUNT = 22;
export const GPU_API_CASES = Object.freeze([
  'APITest.test_batch_calls_sdk_predict_batch_once',
  'APITest.test_unauthorized_oversize_bad_model_rejected_before_inference',
  'APITest.test_single_and_batch_share_one_executor',
  'APITest.test_wrong_sdk_batch_size_results_is_safe_error',
  'APITest.test_token_budget_failure_before_inference',
]);
export const GPU_HELPER_CASE = 'GPUContractsTest.test_python_gpu_helper_is_standalone_and_preserves_request_contract';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COVERAGE = path.join(ROOT, 'tests/migration-coverage.json');

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

export function baselineTestFiles() {
  return git(['ls-tree', '-r', '--name-only', BASELINE]).split('\n').filter((file) => (
    /^tests\/test_[^/]+\.py$/u.test(file) || file === 'agents/test_validate_agents.py'
  )).sort();
}

export function testMethods(source) {
  const methods = [];
  const classes = [];
  for (const [lineIndex, line] of source.split(/\r?\n/u).entries()) {
    const classMatch = line.match(/^(\s*)class\s+([A-Za-z_][A-Za-z0-9_]*)\b/u);
    if (classMatch) {
      const indent = classMatch[1].length;
      while (classes.length && classes.at(-1).indent >= indent) classes.pop();
      classes.push({ indent, name: classMatch[2] });
      continue;
    }
    const methodMatch = line.match(/^(\s*)(?:async\s+)?def\s+(test_[A-Za-z0-9_]+)\s*\(/u);
    if (!methodMatch) continue;
    const indent = methodMatch[1].length;
    while (classes.length && classes.at(-1).indent >= indent) classes.pop();
    methods.push(classes.length ? `${classes.at(-1).name}.${methodMatch[2]}` : methodMatch[2]);
  }
  return methods;
}

export function inspectBaselineInventory() {
  const files = baselineTestFiles();
  const cases = [];
  const byFile = {};
  for (const file of files) {
    const source = git(['show', `${BASELINE}:${file}`]);
    const names = testMethods(source);
    byFile[file] = names;
    for (const name of names) cases.push(`${file}::${name}`);
  }
  const gpu = byFile['tests/test_laya_server.py'] ?? [];
  return {
    baseline: BASELINE,
    moduleCount: files.length,
    methodCount: cases.length,
    files,
    cases,
    byFile,
    gpuApiCases: gpu.filter((name) => name.startsWith('APITest.')),
    gpuHelperCases: gpu.filter((name) => name.startsWith('GPUContractsTest.')),
  };
}

export function auditCoverage(root = ROOT) {
  const inventory = inspectBaselineInventory();
  const errors = [];
  if (inventory.moduleCount !== CONTRACT_MODULE_COUNT) {
    errors.push(`Frozen coverage contract expects ${CONTRACT_MODULE_COUNT} source modules; baseline ${BASELINE} contains ${inventory.moduleCount}.`);
  }
  if (inventory.methodCount !== CONTRACT_METHOD_COUNT) {
    errors.push(`Frozen coverage contract expects ${CONTRACT_METHOD_COUNT} test methods; baseline ${BASELINE} contains ${inventory.methodCount}. No source method has been excluded.`);
  }
  if (inventory.gpuApiCases.length !== GPU_API_CASES.length
    || GPU_API_CASES.some((name) => !inventory.gpuApiCases.includes(name))) {
    errors.push(`GPU factory contract expects ${GPU_API_CASES.length} API cases; baseline has ${inventory.gpuApiCases.length}.`);
  }
  if (inventory.gpuHelperCases.length !== 0) {
    errors.push(`Baseline includes ${inventory.gpuHelperCases.length} additional GPU helper test method(s) outside the five API factory cases: ${inventory.gpuHelperCases.join(', ')}.`);
  }
  if (!fs.existsSync(COVERAGE)) errors.push('Required tests/migration-coverage.json is not present; a complete method-to-Node/GPU mapping cannot be verified.');
  else {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(COVERAGE, 'utf8')); }
    catch (error) { errors.push(`Coverage manifest is invalid JSON: ${error.message}`); }
    if (manifest) {
      if (manifest.schema !== 1 || manifest.baseline !== BASELINE) errors.push('Coverage manifest must use schema 1 and the frozen baseline revision.');
      if (manifest.method_count !== CONTRACT_METHOD_COUNT) errors.push(`Coverage manifest method_count must equal ${CONTRACT_METHOD_COUNT}.`);
      const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
      if (cases.length !== CONTRACT_METHOD_COUNT) errors.push(`Coverage manifest must contain ${CONTRACT_METHOD_COUNT} source cases; found ${cases.length}.`);
      const ids = cases.map((entry) => `${entry?.source?.file}::${entry?.source?.case}`);
      if (new Set(ids).size !== ids.length) errors.push('Coverage manifest contains duplicate source method mappings.');
      const expected = new Set(inventory.cases);
      for (const id of ids) if (!expected.has(id)) errors.push(`Coverage manifest includes unknown baseline method: ${id}`);
      for (const id of expected) if (!ids.includes(id)) errors.push(`Coverage manifest omits baseline method: ${id}`);
      for (const entry of cases) {
        if (!entry?.reason || !String(entry.reason).trim()) errors.push(`Coverage reason is missing for ${entry?.source?.file}::${entry?.source?.case}`);
        if (!['node', 'gpu', 'intentional_behavior_replacement'].includes(entry?.target?.kind)) errors.push(`Invalid coverage target kind for ${entry?.source?.file}::${entry?.source?.case}`);
        if (entry?.target?.kind === 'node') {
          const target = path.resolve(root, entry.target.file ?? '');
          if (!target.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(target)) errors.push(`Node coverage target does not exist: ${entry.target.file}`);
          else {
            const text = fs.readFileSync(target, 'utf8');
            if (!text.includes(`test('${entry.target.name}'`) && !text.includes(`test("${entry.target.name}"`)) errors.push(`Node test is not discovered in ${entry.target.file}: ${entry.target.name}`);
          }
        }
      }
    }
  }
  return { ok: errors.length === 0, inventory, errors };
}

export function main() {
  const result = auditCoverage();
  if (!result.ok) {
    process.stderr.write(`${result.errors.map((error) => `COVERAGE BLOCKER: ${error}`).join('\n')}\n`);
    process.stderr.write(`Baseline inventory: ${result.inventory.moduleCount} modules, ${result.inventory.methodCount} methods; GPU API=${result.inventory.gpuApiCases.length}, additional GPU helper=${result.inventory.gpuHelperCases.length}.\n`);
    return 1;
  }
  process.stdout.write(`Coverage manifest valid: ${result.inventory.methodCount} baseline methods, all mapped to discovered Node/GPU/replacement evidence.\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
