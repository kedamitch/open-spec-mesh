import { createHash } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseLosslessJson } from '../runtime/compat-json.js';

export const ROLES = new Set(['main', 'architect', 'worker', 'reviewer', 'explorer', 'librarian']);
export const SKILLS = new Set(['sdd-init', 'sdd-migrate', 'sdd-req', 'sdd-requirements', 'sdd-design', 'sdd-plan', 'sdd-change', 'sdd-do', 'sdd-close', 'sdd-release', 'sdd-research', 'prd-spec', 'design-overview']);
export const MAX_LINE = 8 * 1024 * 1024;
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const COMMANDS = new Map([
  ['new_change.py', 'change.create'], ['ensure_design.py', 'design.create'],
  ['new_task.py', 'task.create'], ['prepare_workspace.py', 'task.prepare'],
  ['record_delivery.py', 'task.deliver'], ['import_delivery.py', 'task.submit'],
  ['run_validation.py', 'change.validate'], ['check_change.py', 'change.check'],
  ['close_change.py', 'change.close'],
]);
const TOOL_RE = /[\n;|&<>`$]/u;

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function identifier(value) {
  if (typeof value !== 'string') return null;
  const matched = value.match(SAFE_ID);
  return matched?.[0] === value ? value : null;
}

export function instant(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || !/(?:Z|[+-]\d\d:\d\d)$/u.test(value) ? null : date.toISOString();
}

export function jsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = parseLosslessJson(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
    catch { return {}; }
  }
  return {};
}

export function nativeName(value) {
  return typeof value === 'string' ? value.split('.').at(-1).split('__').at(-1) : '';
}

export function policySignal(input) {
  const text = input.replace(/<!--[\s\S]*?-->/gu, '');
  let fence = null;
  for (const line of text.split(/\r?\n/u)) {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (mark) {
      if (fence === null) fence = mark;
      else if (mark[0] === fence[0] && mark.length >= fence.length) fence = null;
      continue;
    }
    if (fence || /^(?:    |\t)/u.test(line)) continue;
    if (/^\|\s*Explorer\s*\/\s*Librarian\s*\|/u.test(line)) {
      return line.includes('已批准 Complex') ? 'explorer_requires_complex' : 'unrecognized_explorer_rule';
    }
  }
  return null;
}

function shellSplit(command) {
  if (Array.isArray(command)) return command;
  if (typeof command !== 'string') throw new TypeError('command must be text or argv');
  const parts = [];
  let current = '', quote = null, escaped = false, started = false;
  for (const char of command) {
    if (escaped) { current += char; escaped = false; started = true; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; started = true; continue; }
    if (quote) { if (char === quote) quote = null; else current += char; started = true; continue; }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (/\s/u.test(char)) { if (started) parts.push(current); current = ''; started = false; continue; }
    current += char; started = true;
  }
  if (escaped || quote) throw new Error('unterminated shell quoting');
  if (started) parts.push(current);
  return parts;
}

export function commandFact(value) {
  try {
    const parts = shellSplit(value);
    if (!parts.length || parts.some((part) => typeof part !== 'string')) return { kind: 'opaque' };
    const executable = path.basename(parts[0]);
    if (['bash', 'sh', 'zsh'].includes(executable) && parts.length === 3 && ['-c', '-lc'].includes(parts[1])) return commandFact(parts[2]);
    if (parts.some((part) => TOOL_RE.test(part))) return { kind: 'opaque' };
    if (['cat', 'head', 'tail'].includes(executable)) {
      const skills = [...new Set(parts.slice(1).filter((part) => part.endsWith('/SKILL.md') && SKILLS.has(part.split('/').at(-2))).map((part) => part.split('/').at(-2)))].sort();
      return skills.length ? { kind: 'skill.read', skills } : { kind: 'local.read' };
    }
    if (['rg', 'grep', 'find', 'ls', 'sed'].includes(executable)) return { kind: 'local.read' };
    if (executable === 'npm' && parts[1] === 'run' && ['validate:core', 'validate:full'].includes(parts[2])) return { kind: 'verification.run', scope: 'integration', profile: parts[2].slice('validate:'.length) };
    if (['node', 'nodejs'].includes(executable) && parts[1] === '--test') return { kind: 'verification.run', scope: 'targeted', profile: null };
    if (['node', 'nodejs'].includes(executable) && (parts[1] === 'scripts/sdd_validate.js' || parts[1]?.endsWith('/scripts/sdd_validate.js'))) {
      const i = parts.indexOf('--profile');
      const profile = parts.find(p => p.startsWith('--profile='))?.slice(10) ?? (i >= 0 ? parts[i + 1] : 'core');
      return ['core', 'full'].includes(profile) ? { kind: 'verification.run', scope: 'integration', profile } : { kind: 'other.command' };
    }
    const cliIndex = ['open-spec-mesh', 'osm'].includes(executable) ? 1 : ['node', 'nodejs'].includes(executable) && ['open-spec-mesh.js', 'osm.js'].includes(path.basename(parts[1] ?? '')) ? 2 : null;
    const action = cliIndex == null ? null : parts[cliIndex];
    const kinds = { 'new-change': 'change.create', 'new-task': 'task.create', 'ensure-design': 'design.create', 'validate-docs': 'documentation.validate' };
    if (action && Object.hasOwn(kinds, action)) return { kind: kinds[action], change_id: identifier(parts.find(p => /^CHG-\d{8}-[A-Za-z0-9_-]+$/u.test(p))) };
    if (!['python', 'python3', 'python3.11', 'python3.13'].includes(executable)) return { kind: 'other.command' };
    let scriptIndex = -1;
    for (let i = 1; i < parts.length; i += 1) if (!parts[i].startsWith('-')) { scriptIndex = i; break; }
    if (scriptIndex < 0) return { kind: 'opaque' };
    const script = parts[scriptIndex];
    if (parts.slice(0, scriptIndex).includes('-c') || !script.includes('/scripts/') || ![...SKILLS].some((skill) => script.includes(`${skill}/scripts/`))) return { kind: 'opaque' };
    const args = parts.slice(scriptIndex + 1);
    const flag = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1] ?? null; };
    const change = args.find((part) => /^CHG-\d{8}-[A-Za-z0-9_-]+$/u.test(part)) ?? null;
    let task = args.find((part) => /^C\d{2}(?:-\d{2})+$/u.test(part)) ?? null;
    const basename = path.basename(script);
    let kind = COMMANDS.get(basename) ?? 'other.command';
    if (basename === 'task_graph.py' && ['approve', 'submit', 'block', 'rework', 'replan'].includes(flag('--action'))) kind = `task.${flag('--action')}`;
    if (basename === 'record_acceptance.py') kind = args.includes('accept') ? 'task.accept' : args.includes('rework') ? 'task.rework' : 'opaque';
    if (script.endsWith('sdd-change/scripts/sdd.py') && args.length && !['--help', '-h'].some((flagName) => args.includes(flagName))) {
      const action = args[0];
      const commandKinds = {
        status: 'task.status', prepare: 'task.prepare', 'bind-session': 'task.bind-session',
        deliver: args.includes('--draft') ? 'task.delivery-draft' : 'task.deliver',
        integrate: args.includes('--wave') ? (args.includes('--check') ? 'change.integrate-wave-preflight' : 'change.integrate-wave') : (args.includes('--check') ? 'task.integrate-preflight' : 'task.integrate'),
        close: args.includes('--archive') ? 'change.close' : args.includes('--accept') ? 'task.accept' : kind,
      };
      kind = commandKinds[action] ?? kind;
      if (action === 'integrate' && args.includes('--wave')) task = null;
    }
    return { kind, change_id: identifier(change), task_id: identifier(task) };
  } catch { return { kind: 'opaque' }; }
}

export function outputStatus(value) {
  const data = jsonObject(value);
  let code = data.exit_code;
  if (code == null && data.metadata && typeof data.metadata === 'object') code = data.metadata.exit_code;
  if (data.error || data.is_error === true || data.isError === true) return ['failed', data];
  const exactCode = exitCode(code);
  if (exactCode !== null) return [exactCode === 0n ? 'success' : 'failed', data];
  if (typeof value === 'string') {
    const match = value.match(/^(?:Process exited with code|Exit code:)\s*(-?\d+)\s*$/mu);
    if (match) return [Number(match[1]) === 0 ? 'success' : 'failed', data];
  }
  return ['unknown', data];
}

async function validRealFile(file) {
  const absolute = path.resolve(file);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) return false;
  }
  return (await lstat(absolute)).isFile();
}

function safeInteger(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (value && typeof value.toString === 'function') {
    const text = value.toString();
    if (/^(?:0|[1-9]\d*)$/u.test(text)) { try { return BigInt(text); } catch {} }
  }
  return null;
}

function exitCode(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : null;
  if (typeof value === 'bigint') return value;
  if (value && typeof value.toString === 'function' && /^-?(?:0|[1-9]\d*)$/u.test(value.toString())) {
    try { return BigInt(value.toString()); } catch {}
  }
  return null;
}

function trimUsage(value) {
  const result = {};
  for (const key of ['input_tokens', 'cached_input_tokens', 'output_tokens']) {
    if (!Object.hasOwn(value, key)) continue;
    const parsed = safeInteger(value[key]);
    if (parsed !== null) result[key] = parsed;
  }
  return result;
}

function* boundedLines(bytes) {
  let offset = 0;
  let line = 0;
  while (offset < bytes.length) {
    const newline = bytes.indexOf(10, offset);
    const end = newline < 0 ? bytes.length : newline + 1;
    yield [++line, bytes.subarray(offset, end)];
    offset = end;
  }
}

export function taskAlias(value) {
  const alias = typeof value === 'string' ? value.split('/').at(-1) : null;
  return alias && ROLES.has(alias.split('_')[0]) && /^[a-z]+_[a-z0-9_]{1,100}$/u.test(alias) ? alias : null;
}
export function sessionIdentity(payload) {
  const source = jsonObject(payload.source), spawn = jsonObject(jsonObject(source.subagent).thread_spawn);
  const role = payload.agent_role || spawn.agent_role;
  return { id: identifier(payload.id), parent: identifier(payload.parent_thread_id || spawn.parent_thread_id),
    role: ROLES.has(role) ? role : null, alias: taskAlias(payload.agent_path || spawn.agent_path) };
}
/** Resolve aliases only against a unique matching parent/role header; never guess UUIDs. */
export function linkTaskAliases(events, headers) {
  const issues = [];
  const linked = events.map(event => {
    const fact = event.fact;
    if (!fact?.child_alias || fact.child) return event;
    const candidates = headers.filter(h => h.id && h.parent === event.session && h.alias === fact.child_alias
      && ROLES.has(h.role) && (!fact.role || fact.role === h.role));
    if (candidates.length !== 1) { if (candidates.length > 1) issues.push('ambiguous_task_alias'); return event; }
    return { ...event, fact: { ...fact, child: candidates[0].id, child_link_basis: 'confirmed_parent_role_alias' } };
  });
  return { events: linked, issues: [...new Set(issues)] };
}

export async function readRollout(file) {
  if (!await validRealFile(file)) throw new TypeError('Rollout must be a regular non-symlink file');
  const before = await lstat(file);
  if (before.size > 128 * 1024 * 1024) throw new RangeError('Rollout exceeds the 128 MiB input bound; export a smaller trace');
  const bytes = await readFile(file);
  const result = { id: null, parent: null, role: null, alias: null, version: null, events: [], issues: [], turns: [], meta: false, usage: {}, policy: [], forked: false };
  let activeTurn = null;
  const calls = new Map();
  const taskAliases = new Map();
  const callAliases = new Map();
  const sourceKey = digest(Buffer.from(path.resolve(file))).slice(0, 16);
  const emit = (line, kind, timestamp, values = {}) => {
    const event = { source: sourceKey, line, kind, at: instant(timestamp), turn: activeTurn, ...values };
    result.events.push(event);
    return event;
  };
  for (const [lineNo, raw] of boundedLines(bytes)) {
    if (raw.length > MAX_LINE) { result.issues.push('oversized_line'); continue; }
    try {
      const row = parseLosslessJson(raw.toString('utf8'));
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error();
      const type = row.type, payload = row.payload ?? Object.create(null), at = row.timestamp;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) { result.issues.push('invalid_envelope'); continue; }
      try {
        if (type === 'session_meta') {
          if (result.id && identifier(payload.id) !== result.id) { result.issues.push('session_identity_conflict'); continue; }
          result.meta = true;
          result.id = identifier(payload.id);
          result.version = identifier(payload.cli_version);
          result.forked = Boolean(payload.forked_from_id || payload.forked_from);
          const sourceData = jsonObject(payload.source);
          const spawn = jsonObject(jsonObject(sourceData.subagent).thread_spawn);
          result.parent = identifier(payload.parent_thread_id || spawn.parent_thread_id);
          const role = payload.agent_role || spawn.agent_role;
          result.role = ROLES.has(role) ? role : null;
          result.alias = sessionIdentity(payload).alias;
        } else if (type === 'turn_context') {
          activeTurn = identifier(payload.turn_id) || activeTurn;
          emit(lineNo, 'context', at, { model: identifier(payload.model), effort: identifier(payload.effort || payload.reasoning_effort) });
          for (const key of ['user_instructions', 'developer_instructions']) {
            const text = payload[key];
            if (typeof text !== 'string') continue;
            const signal = policySignal(text);
            if (signal) result.policy.push({ signal, digest: digest(text.trim()), source: sourceKey, line: lineNo, turn: activeTurn, evidence: 'runtime_instructions' });
          }
        } else if (type === 'event_msg') {
          const eventType = payload.type;
          if (eventType === 'task_started') {
            activeTurn = identifier(payload.turn_id) || activeTurn;
            if (activeTurn && !result.turns.includes(activeTurn)) result.turns.push(activeTurn);
            emit(lineNo, 'turn.start', at);
          } else if (['task_complete', 'turn_aborted'].includes(eventType)) {
            emit(lineNo, 'turn.end', at, { outcome: eventType === 'task_complete' ? 'completed' : 'aborted' });
          } else if (eventType === 'token_count') {
            const usage = trimUsage(payload.info?.total_token_usage ?? {});
            if (Object.keys(usage).length) emit(lineNo, 'usage.total', at, { usage });
          } else if (eventType === 'exec_command_begin') {
            const callId = identifier(payload.call_id);
            if (callId) {
              const fact = commandFact(payload.command);
              const existing = calls.get(callId);
              if (existing) existing.fact = fact;
              else calls.set(callId, emit(lineNo, 'tool', at, { call_id: callId, status: 'unknown', fact }));
            }
          } else if (eventType === 'exec_command_end') {
            const call = calls.get(identifier(payload.call_id));
            if (call) { const code = exitCode(payload.exit_code); call.status = code === null ? 'unknown' : code === 0n ? 'success' : 'failed'; }
          } else if (eventType === 'patch_apply_end') {
            emit(lineNo, 'implementation.write', at, { status: payload.success === true ? 'success' : 'unknown' });
          } else if (['collab_agent_spawn_begin', 'collab_agent_spawn_end'].includes(eventType)) {
            const callId = identifier(payload.call_id);
            if (!callId) { result.issues.push('tool_id_missing'); continue; }
            let call = calls.get(callId);
            if (!call) {
              call = emit(lineNo, 'tool', at, { call_id: callId, status: 'unknown', fact: { kind: 'agent.spawn', role: 'unknown', fork_turns: 'unknown' } });
              calls.set(callId, call);
            }
            if (eventType.endsWith('_end')) {
              const child = identifier(payload.new_thread_id);
              if (ROLES.has(payload.new_agent_role)) call.fact.role = payload.new_agent_role;
              if (child) { call.fact.child = child; call.status = 'success'; }
              else if (payload.status === 'errored' || payload.error) call.status = 'failed';
              call.end_at = instant(at);
            }
          } else if (eventType === 'sub_agent_activity') {
            const call = calls.get(identifier(payload.call_id));
            const child = identifier(payload.agent_thread_id);
            if (call && child && payload.kind === 'started' && call.fact.kind === 'agent.spawn') { call.fact.child = child; call.status = 'success'; }
            else result.issues.push('unlinked_agent_activity');
          } else if (['agent_message', 'agent_reasoning', 'user_message', 'agent_reasoning_raw_content', 'agent_reasoning_section_break', 'agent_reasoning_raw_content_delta'].includes(eventType) || (typeof eventType === 'string' && (eventType.startsWith('collab_') || eventType.startsWith('agent_'))) || ['mcp_tool_call_begin', 'mcp_tool_call_end', 'web_search_begin', 'web_search_end', 'view_image_tool_call', 'context_compacted', 'item_started', 'item_completed', 'background_event', 'warning', 'error', 'shutdown_complete', 'plan_update'].includes(eventType)) {
            // Recognized event envelopes that do not add a supported observation fact.
          } else result.issues.push('unknown_event');
        } else if (type === 'response_item') {
          const itemType = payload.type;
          if (['function_call', 'custom_tool_call'].includes(itemType)) {
            const callId = identifier(payload.call_id);
            if (!callId) { result.issues.push('tool_id_missing'); continue; }
            let name = nativeName(payload.name);
            if (String(payload.name ?? '').startsWith('mcp__') || (payload.namespace != null && !['agents', 'functions', 'collaboration'].includes(payload.namespace))) name = '';
            const args = jsonObject(payload.arguments);
            let fact;
            if (name === 'spawn_agent') {
              if ((args.agent_type != null && typeof args.agent_type !== 'string') || (args.fork_turns != null && typeof args.fork_turns !== 'string')) result.issues.push('invalid_payload');
              if (typeof args.task_name === 'string' && /^[a-z]+_[a-z0-9_]{1,100}$/u.test(args.task_name)) callAliases.set(callId, args.task_name);
              fact = { kind: 'agent.spawn', role: ROLES.has(args.agent_type) ? args.agent_type : 'unknown', fork_turns: ['none', 'all'].includes(args.fork_turns) ? args.fork_turns : 'unknown' };
            } else if (['resume_agent', 'send_input', 'send_message', 'followup_task'].includes(name)) {
              const target = args.id || args.agent_id || args.thread_id || args.target;
              const alias = typeof target === 'string' ? target.split('/').at(-1) : null;
              fact = { kind: ['resume_agent', 'followup_task'].includes(name) ? 'agent.resume' : 'agent.message', child: taskAliases.get(alias) ?? (taskAlias(target) ? null : identifier(target)), ...(taskAlias(target) ? { child_alias: taskAlias(target) } : {}) };
            } else if (['exec_command', 'shell_command', 'shell'].includes(name)) fact = commandFact(args.cmd || args.command);
            else if (['list_agents', 'task_status'].includes(name)) fact = { kind: 'agent.status' };
            else if (name === 'apply_patch') fact = { kind: 'implementation.write' };
            else if (['exec', 'js'].includes(name)) fact = { kind: 'opaque' };
            else fact = { kind: 'other.tool' };
            if (!calls.has(callId)) calls.set(callId, emit(lineNo, 'tool', at, { call_id: callId, fact, status: 'unknown' }));
            else if (calls.get(callId).fact.role === 'unknown' && fact.role) calls.get(callId).fact = fact;
          } else if (['function_call_output', 'custom_tool_call_output'].includes(itemType)) {
            const call = calls.get(identifier(payload.call_id));
            if (call) {
              const [status, data] = outputStatus(payload.output);
              const child = identifier(data.agent_id || data.thread_id);
              let outcome = status;
              if (call.fact.kind === 'agent.spawn' && child) { call.fact.child = child; outcome = 'success';
                if (callAliases.has(call.call_id)) taskAliases.set(callAliases.get(call.call_id), child);
              }
              if (call.fact.kind === 'agent.spawn' && outcome !== 'failed' && !child && taskAlias(data.task_name) === callAliases.get(call.call_id) && taskAlias(data.task_name)) {
                call.fact.child_alias = taskAlias(data.task_name); outcome = 'success';
              }
              if (['agent.resume', 'agent.message'].includes(call.fact.kind) && call.fact.child && outcome !== 'failed' && (data.submission_id || ['running', 'completed', 'queued'].includes(data.status))) outcome = 'success';
              if (outcome !== 'unknown') call.status = outcome;
              call.end_at = instant(at);
            }
          } else if (itemType === 'message' && ['developer', 'user'].includes(payload.role)) {
            for (const content of payload.content ?? []) {
              const text = content && typeof content === 'object' ? content.text ?? '' : '';
              if (typeof text !== 'string' || !text.startsWith('# AGENTS.md instructions for ') || !text.includes('<INSTRUCTIONS>')) continue;
              const body = text.split('<INSTRUCTIONS>')[1]?.split('</INSTRUCTIONS>')[0]?.trim() ?? '';
              const signal = policySignal(body);
              if (signal) result.policy.push({ signal, digest: digest(body), source: sourceKey, line: lineNo, turn: activeTurn, evidence: 'injected_instructions' });
            }
          } else if (!['message', 'agent_message', 'reasoning', 'web_search_call', 'compaction', 'ghost_snapshot'].includes(itemType)) result.issues.push('unknown_response_item');
        } else if (['world_state', 'token_usage_record', 'inter_agent_communication_metadata'].includes(type)) {
          // Native V2 metadata; token_count remains the sole cumulative usage source.
        } else if (type === 'compacted') result.issues.push('compacted_history');
        else result.issues.push('unsupported_envelope');
      } catch (error) {
        if (['TypeError', 'AttributeError', 'KeyError', 'ValueError'].includes(error?.name)) result.issues.push('invalid_payload'); else throw error;
      }
    } catch { result.issues.push('invalid_or_partial_json'); }
  }
  if (!result.id) throw new TypeError('Not a supported rollout: session_meta.id missing');
  result.source_digest = digest(bytes);
  const after = await lstat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) result.issues.push('source_changed_during_read');
  result.source = `session:${result.id}`;
  for (const item of [...result.events, ...result.policy]) item.source = result.source;
  result.issues = [...new Set(result.issues)].sort();
  return result;
}
