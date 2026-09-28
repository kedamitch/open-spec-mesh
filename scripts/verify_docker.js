#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function docker(args, { capture = true, timeout = 300_000 } = {}) {
  const result = spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (result.error) throw new Error(`Docker is required; validation has NOT run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`docker ${args.slice(0, 3).join(' ')} failed (${result.status}): ${(result.stderr || result.stdout || '').slice(-3000)}`);
  return (result.stdout ?? '').trim();
}

export async function verifyDocker() {
  const version = docker(['info', '--format', '{{.ServerVersion}}']);
  if (!version) throw new Error('Docker daemon did not report a server version');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-docker-smoke-'));
  const context = path.join(temp, 'context');
  const image = `osm-env-smoke:${process.pid}`;
  let container = null;
  try {
    fs.cpSync(path.join(ROOT, 'tests/fixtures/docker-app'), context, { recursive: true });
    const envFile = path.join(context, '.env');
    fs.writeFileSync(envFile, 'TEST_MESSAGE=osm-smoke-ok\nLITERAL=$NOT_EXPANDED\n', { mode: 0o600 });
    docker(['build', '-t', image, context]);
    container = docker(['run', '-d', '--env-file', envFile, '-p', '127.0.0.1::8080', image]);
    const portText = docker(['port', container, '8080/tcp']);
    const port = Number(portText.slice(portText.lastIndexOf(':') + 1));
    if (!Number.isInteger(port) || port < 1) throw new Error(`Invalid Docker published port: ${portText}`);
    let healthy = false;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
        const body = await response.json();
        if (response.ok && body.message === 'osm-smoke-ok' && body.literal === '$NOT_EXPANDED') { healthy = true; break; }
      } catch { /* wait for container startup */ }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!healthy) throw new Error('Docker application health response did not become ready');
    const user = docker(['inspect', '--format', '{{.Config.User}}', container]);
    if (!user || ['root', '0'].includes(user)) throw new Error(`Container must run as non-root; actual user=${user || '(empty)'}`);
    docker(['exec', container, 'test', '!', '-e', '/app/.env']);
    if (docker(['logs', container]).includes('osm-smoke-ok')) throw new Error('Container logs unexpectedly disclosed environment data');
    docker(['restart', container]);
    process.stdout.write(`Docker ${version}: build, env-file, literal values, non-root, secret exclusion, and restart passed\n`);
  } finally {
    if (container) spawnSync('docker', ['rm', '-f', container], { cwd: ROOT, stdio: 'ignore', timeout: 30_000 });
    spawnSync('docker', ['image', 'rm', '-f', image], { cwd: ROOT, stdio: 'ignore', timeout: 30_000 });
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyDocker().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
