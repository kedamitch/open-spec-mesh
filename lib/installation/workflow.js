import { readFileSync } from 'node:fs';
import path from 'node:path';

// Framework-owned, project-independent source. Never fall back to root AGENTS.md.
export const WORKFLOW_SOURCE = 'sdd-init/references/workflow-policy.md';
export function readWorkflow(source) {
  const text = readFileSync(path.join(source, WORKFLOW_SOURCE), 'utf8');
  if (!text.trim()) throw new Error('Empty shared workflow policy');
  return text;
}
