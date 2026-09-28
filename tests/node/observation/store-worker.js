import path from 'node:path';
import { withStore } from '../../../lib/observation/store.js';
const [database, runId, projectKey] = process.argv.slice(2);
const run = {
  schema: 1, collected_at: new Date().toISOString(), host: { name: 'codex', native_trace: 'full' },
  project_key: projectKey, root_session: `session-${runId}`, turn: null,
  expectation: { mode: 'unknown', roles: [], source: 'operator_not_model' },
  sessions: [], events: [], coverage: { status: 'observed', issues: [] }, snapshots: [],
  configuration_fingerprint: 'fixture', configuration_basis: 'current_inventory_not_proven_active',
  sdd: { association: 'unknown', tasks: [], events: [] }, findings: [], metrics: { diagnostic_model_calls: 0 },
};
await withStore(database, (store) => store.save(runId, run));
