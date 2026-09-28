import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkResearchKeys, ensureResearchTools, researchInstallEnv,
} from '../../../lib/installation/tools.js';
import { FORWARDED_ENV } from '../../../lib/systemone/contracts.js';
import { tempDirectory } from './helpers.js';

test('Research key checks report presence without exposing key values', () => {
  const env = { CONTEXT7_API_KEY: 'test-context-sentinel', TAVILY_API_KEY: 'test-tavily-sentinel' };
  const messages = [];
  assert.deepEqual(checkResearchKeys({ env, required: false, reporter: (line) => messages.push(line) }), []);
  assert.equal(messages.some((line) => line.includes('present (value hidden')), true);
  assert.equal(messages.some((line) => line.includes('test-context-sentinel') || line.includes('test-tavily-sentinel')), false);
});

test('npm child environment removes provider credentials and forwarded System One state', () => {
  const env = {
    PATH: '/isolated/bin', npm_config_cache: '/isolated/cache',
    TYPESAFE_API_KEY: 'test-typesafe-sentinel', LAYA_API_KEY: 'test-laya-sentinel',
    LAYA_BASE_URL: 'https://unit.invalid', SYSTEMONE_PROVIDER: 'test-provider',
    LAYA_BATCH_PATH: '/private/batch', CONTEXT7_API_KEY: 'test-context-sentinel',
  };
  const child = researchInstallEnv(env, FORWARDED_ENV);
  assert.equal(child.PATH, env.PATH);
  assert.equal(child.npm_config_cache, env.npm_config_cache);
  for (const key of ['TYPESAFE_API_KEY', 'LAYA_API_KEY', 'LAYA_BASE_URL', 'SYSTEMONE_PROVIDER', 'LAYA_BATCH_PATH', 'CONTEXT7_API_KEY']) {
    assert.equal(Object.hasOwn(child, key), false, key);
  }
});

test('custom and disabled Research MCP entries are retained without probing or package installation', (t) => {
  const home = tempDirectory(t);
  const messages = [];
  const commands = ensureResearchTools(home, {
    installTools: false,
    npmPath: '/nonexistent/npm',
    env: { PATH: '' },
    configData: { mcp_servers: {
      codegraph: { url: 'https://custom.invalid/codegraph', headers: { Authorization: 'env:LOCAL_TOKEN' } },
      context7: { command: 'my-context7', args: ['--remote'] },
      tavily: { enabled: false },
    } },
    reporter: (line) => messages.push(line),
  });
  assert.deepEqual(commands, {});
  assert.equal(messages.some((line) => line.includes('custom; not probed')), true);
  assert.equal(messages.some((line) => line.includes('preserve disabled')), true);
  assert.equal(messages.some((line) => line.includes('npm exit')), false);
});
