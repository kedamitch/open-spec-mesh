export const TOKEN_FIELDS = Object.freeze(['input_tokens', 'cached_input_tokens', 'output_tokens']);

function integer(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;
  if (value == null || !/^(?:0|[1-9]\d*)$/u.test(String(value))) return null;
  return BigInt(String(value));
}
function normalized(value) {
  if (!value || typeof value !== 'object') return null;
  const entries = TOKEN_FIELDS.map(key => [key, integer(value[key])]).filter(([, n]) => n !== null);
  if (!entries.length) return null;
  const result = Object.fromEntries(entries);
  if (result.input_tokens != null && result.cached_input_tokens != null && result.cached_input_tokens > result.input_tokens) return null;
  return result;
}
function observed(rows) {
  const known = rows.map(row => row.usage).filter(Boolean);
  return known.length ? Object.fromEntries(TOKEN_FIELDS.map(key => [key,
    known.every(row => row[key] != null) ? known.reduce((n, row) => n + row[key], 0n) : null])) : null;
}

/** Deduplicate scoped deltas, never sum repeated cumulative token samples. */
export function aggregateUsage(sessions = [], { scopeComplete = true } = {}) {
  const scopes = new Map(); const issues = new Set();
  for (const [index, session] of sessions.entries()) {
    const identified = typeof session.id === 'string' && Boolean(session.id);
    const id = identified ? session.id : null;
    if (!identified) issues.add('session_identity_unknown');
    // Grouped runs have disjoint slices verified by groupRuns. A same session
    // can legitimately contribute different deltas in different slices.
    const key = JSON.stringify([session.slice_id ?? 'selected_scope', identified ? 'known' : 'missing', identified ? id : index]);
    const usage = normalized(session.usage);
    if (session.usage != null && !usage) issues.add('invalid_usage_record');
    const role = session.role ?? 'unknown';
    if (!scopes.has(key)) { scopes.set(key, { id, slice_id: session.slice_id ?? null, role, usage, conflict: false }); continue; }
    const row = scopes.get(key);
    if (row.role !== role) { row.role = 'unknown'; issues.add('session_role_conflict'); }
    if (row.conflict || !usage) continue;
    if (!row.usage) { row.usage = usage; continue; }
    if (TOKEN_FIELDS.some(field => row.usage[field] != null && usage[field] != null && row.usage[field] !== usage[field])) {
      row.usage = null; row.conflict = true; issues.add('duplicate_usage_conflict');
    } else {
      row.usage = normalized({ ...row.usage, ...usage });
      if (!row.usage) { row.conflict = true; issues.add('invalid_usage_combination'); }
    }
  }
  const rows = [...scopes.values()];
  const complete = rows.filter(row => row.usage && TOKEN_FIELDS.every(key => row.usage[key] != null)).length;
  const totalComplete = rows.length > 0 && complete === rows.length && scopeComplete && issues.size === 0;
  const total = observed(rows);
  const roles = [...new Set(rows.map(row => row.role))].sort();
  return {
    usage_scope: 'selected_observation_scope_not_entire_goal',
    sessions_observed: rows.length, duplicate_session_records: sessions.length - rows.length,
    usage_observed: total, usage_total: totalComplete ? total : null, usage_complete: totalComplete,
    usage_coverage: { numerator: complete, denominator: rows.length },
    usage_by_role: roles.map(role => {
      const selected = rows.filter(row => row.role === role);
      return { role, sessions: selected.length, usage_observed: observed(selected),
        complete_sessions: selected.filter(row => row.usage && TOKEN_FIELDS.every(key => row.usage[key] != null)).length };
    }),
    usage_issues: [...issues].sort(),
    monetary_cost: { status: 'unknown', amount: null, currency: null, basis: 'pricing_not_provided' },
  };
}

/** Historical state evidence is not a measurement of modern causal rework. */
export function reworkMetrics(sdd = {}) {
  if (sdd.graph !== 'present') return {
    first_pass: { numerator: null, denominator: null }, direct_rework: null, dependency_invalidations: null, replan_events: null,
    rework_basis: sdd.graph === 'absent' ? 'not_applicable_legacy_graph' : 'unknown',
    causal_rework: { status: 'unknown', count: null, basis: 'not_inferred_from_dialogue' },
  };
  const history = sdd.events ?? [], tasks = sdd.tasks ?? [];
  const direct = history.filter(event => event.action === 'rework' && event.direct === true);
  const eligible = tasks.filter(task => task.state === 'accepted' && task.attempt != null && history.some(event => event.task_id === task.id && event.state === 'submitted'));
  return {
    first_pass: { numerator: eligible.filter(task => task.attempt === 1 && !direct.some(event => event.task_id === task.id)).length, denominator: eligible.length },
    direct_rework: direct.length,
    dependency_invalidations: history.filter(event => event.action === 'rework' && event.direct === false).length,
    replan_events: history.filter(event => event.action === 'replan' && event.direct === true).length,
    rework_basis: 'legacy_graph_history', causal_rework: { status: 'unknown', count: null, basis: 'legacy_states_not_causal_measurement' },
  };
}

export function reworkAnnotations(marks = []) {
  const byId = new Map();
  for (const mark of marks) {
    if (!mark || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(mark.id ?? '') || !['assumption', 'handoff', 'integration'].includes(mark.reason) || mark.source !== 'operator_annotation') {
      throw new TypeError('Invalid operator rework annotation');
    }
    if (byId.has(mark.id) && byId.get(mark.id).reason !== mark.reason) return { status: 'unknown', count: null, basis: 'conflicting_operator_annotations', complete: false };
    byId.set(mark.id, mark);
  }
  if (!byId.size) return { status: 'unknown', count: null, basis: 'not_inferred_from_dialogue', complete: false };
  return { status: 'operator_annotated', count: byId.size, basis: 'operator_annotation_partial', complete: false,
    by_reason: Object.fromEntries(['assumption', 'handoff', 'integration'].map(reason => [reason, [...byId.values()].filter(mark => mark.reason === reason).length])) };
}
