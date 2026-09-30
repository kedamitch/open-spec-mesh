import { createHash } from 'node:crypto';
import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const PACKAGE_ID = 'kedamitch/open-spec-mesh';
export const MANIFEST = '.open-spec-mesh-managed.json';
export const OLD_MANIFEST = '.open-spec-mesh.install.json';
export const HOST_MANIFEST = 'open-spec-mesh/managed-host.json';
export const RUNTIME_MARKER = '.open-spec-mesh-runtime.json';
export const BEGIN = '<!-- open-spec-mesh: BEGIN -->';
export const END = '<!-- open-spec-mesh: END -->';
export const LEGACY_SKILLS = Object.freeze([
  'sdd-project-init', 'sdd-requirements-init', 'sdd-architecture-init', 'sdd-change-init',
  'sdd-change-spec', 'sdd-change-design', 'sdd-change-plan', 'sdd-change-execution',
  'sdd-change-verify', 'sdd-change-close', 'sdd-decision-research', 'sdd-plan', 'sdd-execute',
]);
export const LEGACY_ROLES = Object.freeze({ implementer: 'agents/implementer.toml', e2e: 'agents/e2e.toml' });
export const LEGACY_AUX = Object.freeze(['agents/validate_agents.py', 'agents/test_validate_agents.py']);

export function blobHash(bytes) {
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
}

export function catalog(source) {
  let hashes = new Set();
  try {
    const data = JSON.parse(readFileSync(path.join(source, 'scripts/install-legacy.json'), 'utf8'));
    hashes = new Set((data.agents_md ?? []).map((row) => row.blob).filter((item) => /^[a-f0-9]{40}$/u.test(item)));
  } catch { return hashes; }
  try {
    const root = execFileSync('git', ['-C', source, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (path.resolve(root) !== path.resolve(source)) return hashes;
    const history = execFileSync('git', ['--no-pager', '-C', source, 'log', '--format=%H', '-128', '--', 'AGENTS.md'], { encoding: 'utf8', timeout: 10000 });
    for (const revision of history.split(/\r?\n/u)) {
      if (!/^[a-f0-9]{40,64}$/u.test(revision)) continue;
      try {
        const previous = execFileSync('git', ['--no-pager', '-C', source, 'show', `${revision}:AGENTS.md`], { encoding: null, timeout: 5000, maxBuffer: 131073 });
        if (previous.length <= 131072) hashes.add(blobHash(previous.toString('binary').replaceAll('\r\n', '\n').replaceAll('\r\n', '\n')));
      } catch { /* a historical blob may no longer be available */ }
    }
  } catch { /* installation from a tarball has no Git history */ }
  return hashes;
}

function visibleLines(text) {
  const lines = text.split(/(?<=\n)/u); const result = [];
  let fence = null; let inComment = false;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]; const line = raw.replace(/[\r\n]+$/u, '');
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    } else if (inComment) {
      if (line.includes('-->')) inComment = false;
    } else if (marker) fence = marker[1];
    else if (line.trim() === BEGIN || line.trim() === END) result.push([i, line.trim()]);
    else if (line.includes('<!--')) inComment = !line.split('<!--', 2)[1].includes('-->');
    else if (!line.startsWith('    ') && !line.startsWith('\t') && !line.startsWith('>')) result.push([i, line]);
  }
  if (fence || inComment) throw new Error('AGENTS.md has unclosed example/comment; no files changed');
  return result;
}

function lineBlob(lines, start, end) {
  return Buffer.from(lines.slice(start, end).join('').replaceAll('\r\n', '\n'), 'utf8');
}

export function cleanAgents(existing, sourceText, fingerprints = new Set()) {
  const original = existing.split(/(?<=\n)/u); const marked = []; let start = null;
  for (const [index, line] of visibleLines(existing)) {
    if (line === BEGIN) {
      if (start !== null) throw new Error('Nested AGENTS managed markers');
      start = index;
    } else if (line === END) {
      if (start === null) throw new Error('Orphan AGENTS end marker');
      marked.push([start, index + 1]); start = null;
    }
  }
  if (start !== null) throw new Error('Unclosed AGENTS managed block');
  const omitted = new Set(marked.flatMap(([first, last]) => Array.from({ length: last - first }, (_, n) => first + n)));
  const mapping = original.map((_, index) => index).filter((index) => !omitted.has(index));
  const lines = mapping.map((index) => original[index]);
  const normalized = lines.map((line) => line.replaceAll('\r\n', '\n'));
  const starts = visibleLines(lines.join('')).filter(([, line]) => /^#{1,2} /u.test(line)).map(([index]) => index);
  const known = new Set(fingerprints);
  known.add(blobHash(Buffer.from(sourceText, 'utf8')));
  const skills = [...LEGACY_SKILLS, 'sdd-init', 'sdd-migrate', 'sdd-req', 'sdd-requirements', 'sdd-design', 'sdd-plan', 'sdd-change', 'sdd-do', 'sdd-close', 'sdd-research', 'sdd-release', 'prd-spec', 'design-overview'];
  const linkPattern = new RegExp(`(\\]\\()skills/(${skills.map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')})/`, 'gu');
  const unmarked = []; let matchEnd = 0;
  for (const first of starts) {
    if (first < matchEnd) continue;
    const raw = []; const sourceLayout = [];
    for (let last = first; last < lines.length; last += 1) {
      raw.push(normalized[last]); sourceLayout.push(normalized[last].replace(linkPattern, '$1$2/'));
      const bytes = Buffer.from(raw.join('').replace(/\n+$/u, ''), 'utf8');
      const sourceBytes = Buffer.from(sourceLayout.join('').replace(/\n+$/u, ''), 'utf8');
      const candidates = [bytes, sourceBytes].flatMap((data) => [data, Buffer.concat([data, Buffer.from('\n')]), Buffer.concat([data, Buffer.from('\n\n')])]);
      if (candidates.some((data) => known.has(blobHash(data)))) { unmarked.push([mapping[first], mapping[last] + 1]); matchEnd = last + 1; break; }
      if (Buffer.byteLength(raw.join('')) > 131072) break;
    }
  }
  const spans = [...marked, ...unmarked].sort((a, b) => a[0] - b[0]); const merged = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span[0] <= previous[1]) previous[1] = Math.max(previous[1], span[1]);
    else merged.push([...span]);
  }
  const block = `${BEGIN}\n\n${sourceText.trimEnd()}\n\n${END}\n`;
  const parts = []; const outside = []; let cursor = 0;
  for (let index = 0; index < merged.length; index += 1) {
    const [first, last] = merged[index]; const user = original.slice(cursor, first).join('');
    parts.push(user); outside.push(user); if (index === 0) parts.push(block); cursor = last;
  }
  const tail = original.slice(cursor).join(''); parts.push(tail); outside.push(tail);
  let text = parts.join('');
  if (merged.length === 0) {
    const separator = !text || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    text += separator + block;
  }
  const outsideVisible = visibleLines(outside.join('')).map(([, line]) => line).join('\n');
  const legacyNames = [...LEGACY_SKILLS, ...Object.keys(LEGACY_ROLES)];
  const warnings = legacyNames.some((name) => new RegExp(`(?<![\\w-])${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![\\w-])`, 'u').test(outsideVisible))
    ? ['AGENTS.md: unrecognized legacy references preserved; mark only known package text with BEGIN/END'] : [];
  return { text, marked: marked.length, unmarked: unmarked.length, warnings };
}

const validName = (name) => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(name);

export function readManifest(home) {
  const result = { skills: [], roles: {} };
  for (const filename of [OLD_MANIFEST, MANIFEST]) {
    const file = path.join(home, filename);
    try {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Install manifest must be a regular file');
    } catch (error) { if (error?.code === 'ENOENT') continue; throw error; }
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid install manifest');
    let roles;
    if (filename === OLD_MANIFEST) {
      if (data.package !== PACKAGE_ID || data.schema_version !== 1) throw new Error('Unknown old install manifest');
      roles = data.roles;
    } else {
      if (data.schema !== 1 || (data.package ?? PACKAGE_ID) !== PACKAGE_ID || !Array.isArray(data.roles) || data.roles.some((name) => typeof name !== 'string') || new Set(data.roles).size !== data.roles.length) throw new Error('Unknown install manifest');
      roles = Object.fromEntries(data.roles.map((role) => [role, `agents/${role}.toml`]));
    }
    if (!Array.isArray(data.skills) || data.skills.some((name) => !validName(name)) || new Set(data.skills).size !== data.skills.length
      || !roles || typeof roles !== 'object' || Array.isArray(roles)
      || Object.entries(roles).some(([role, item]) => !validName(role) || item !== `agents/${role}.toml`)) {
      throw new Error('Unsafe paths in install manifest');
    }
    result.skills = [...new Set([...result.skills, ...data.skills])].sort();
    Object.assign(result.roles, roles);
  }
  return result;
}

export function registrationPath(value, home) {
  if (typeof value !== 'string') return null;
  let candidate = value.startsWith('~') ? path.join(process.env.HOME || '', value.slice(1)) : value;
  if (path.isAbsolute(candidate)) {
    const relative = path.relative(home, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    candidate = relative;
  }
  const parts = candidate.split(/[\\/]+/u).filter(Boolean);
  if (parts.includes('..') || value.includes('\\')) return null;
  return parts.join('/');
}

export function legacyAgentReadme(file) {
  try {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('Refusing symlink legacy Agent README');
    if (!stat.isFile()) return false;
    const text = readFileSync(file, 'utf8');
    return text.startsWith('# Personal agents') && ['Subagent', 'implementer', 'e2e'].every((term) => text.includes(term));
  } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

export function retirement(home, config, previous, currentSkills, currentRoles) {
  const currentSkillSet = new Set(currentSkills); const currentRoleSet = new Set(currentRoles);
  const skills = new Set([...LEGACY_SKILLS, ...previous.skills]);
  for (const name of currentSkillSet) skills.delete(name);
  const roles = { ...LEGACY_ROLES, ...previous.roles };
  for (const name of currentRoleSet) delete roles[name];
  const owned = new Set(Object.values(roles)); const registrations = config.agents ?? {};
  if (!registrations || typeof registrations !== 'object' || Array.isArray(registrations)) throw new Error('agents must be a TOML table');
  const removed = new Set(); const warnings = [];
  for (const [name, settings] of Object.entries(registrations)) {
    if (!settings || typeof settings !== 'object' || currentRoleSet.has(name)) continue;
    const target = registrationPath(settings.config_file, home);
    if (owned.has(target) || (Object.hasOwn(roles, name) && !Object.hasOwn(settings, 'config_file'))) removed.add(name);
    else if (Object.hasOwn(roles, name)) warnings.push(`Retained custom registration agents.${name}: different config_file`);
  }
  const paths = new Set([...Array.from(skills, (skill) => `skills/${skill}`), ...owned, ...LEGACY_AUX]);
  if (legacyAgentReadme(path.join(home, 'agents/README.md'))) paths.add('agents/README.md');
  if (existsSync(path.join(home, OLD_MANIFEST))) paths.add(OLD_MANIFEST);
  return { paths: [...paths].sort(), removedRoles: [...removed].sort(), warnings };
}

export function manifestText(skills, roles) {
  return `${JSON.stringify({ schema: 1, package: PACKAGE_ID, skills: [...skills], roles: [...roles] }, null, 2)}\n`;
}

export function readHostManifest(home, host) {
  const file = path.join(home, HOST_MANIFEST);
  try {
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Host install manifest must be a regular file');
  } catch (error) { if (error?.code === 'ENOENT') return new Set(); throw error; }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!data || data.schema !== 1 || data.package !== PACKAGE_ID || data.host !== host || !Array.isArray(data.paths)) throw new Error('Unknown host install manifest');
  if (data.paths.some((item) => typeof item !== 'string' || !item || path.isAbsolute(item) || item.includes('\\') || item.split('/').includes('..')) || new Set(data.paths).size !== data.paths.length) throw new Error('Unsafe paths in host install manifest');
  return new Set(data.paths);
}

export function hostManifestText(host, paths) {
  return `${JSON.stringify({ schema: 1, package: PACKAGE_ID, host, paths: [...new Set([...paths].map((value) => value.split(path.sep).join('/')))].sort() }, null, 2)}\n`;
}
