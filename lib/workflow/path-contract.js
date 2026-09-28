import { visibleLines } from './contract.js';

const NONE = new Set(['none', '无', '无。', '-']);
const SECTION = /^##\s+范围与代码落点\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/mu;
const SUBSECTION = /^###\s+Path Contract\s*\n([\s\S]*?)(?=^###\s|^##\s|(?![\s\S]))/mu;

function validatePattern(value, label) {
  if (!value || value.startsWith('/') || value.startsWith('./') || value.includes('\\')) throw new Error(`${label}: path pattern must be repository-relative`);
  if (value.includes('\0') || value.split('/').some((part) => part === '' || part === '.' || part === '..')) throw new Error(`${label}: invalid path pattern: ${value}`);
  if (/^[A-Za-z]:/u.test(value)) throw new Error(`${label}: path pattern must not contain a drive prefix`);
  return value;
}

export function parsePathContract(text, label = 'Task Path Contract') {
  const scopeMatch = text.match(SECTION);
  if (!scopeMatch) throw new Error(`${label}: missing section: 范围与代码落点`);
  const partMatch = scopeMatch[1].match(SUBSECTION);
  if (!partMatch) throw new Error(`${label}: missing subsection: Path Contract`);
  const rows = visibleLines(partMatch[1]).map(([, line]) => line.trim()).filter((line) => line.startsWith('|'));
  if (rows.length < 3) throw new Error(`${label}: Path Contract requires a table`);
  const header = rows[0].replace(/^\||\|$/gu, '').split('|').map((cell) => cell.trim());
  if (header.join('|') !== '规则|路径') throw new Error(`${label}: Path Contract header must be 规则 / 路径`);
  const allow = [];
  const deny = [];
  for (const line of rows.slice(2)) {
    const cells = line.replace(/^\||\|$/gu, '').split('|').map((cell) => cell.trim());
    if (cells.length !== 2) throw new Error(`${label}: Path Contract rows require two columns`);
    const [rawRule, rawPath] = cells;
    const rule = rawRule.toLocaleLowerCase('en-US');
    if (!['allow', 'deny'].includes(rule)) throw new Error(`${label}: Path Contract rule must be allow or deny`);
    if (NONE.has(rawPath.toLocaleLowerCase('en-US'))) {
      if (rule === 'allow') throw new Error(`${label}: allow path cannot be empty`);
      continue;
    }
    const match = rawPath.match(/^`([^`]+)`$/u);
    if (!match) throw new Error(`${label}: Path Contract paths must be backticked`);
    const value = validatePattern(match[1], label);
    const target = rule === 'allow' ? allow : deny;
    if (target.includes(value)) throw new Error(`${label}: duplicate Path Contract pattern: ${value}`);
    target.push(value);
  }
  if (!allow.length) throw new Error(`${label}: Path Contract requires at least one allow path`);
  return { allow, deny };
}

function globRegex(pattern) {
  const parts = pattern.split('/');
  let out = '^';
  parts.forEach((part, index) => {
    if (part === '**') out += index === parts.length - 1 ? '.*' : '(?:[^/]+/)*';
    else out += part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replaceAll('\\*', '[^/]*').replaceAll('\\?', '[^/]');
    if (index < parts.length - 1 && part !== '**') out += '/';
  });
  return new RegExp(`${out}$`, 'u');
}

export function matchesPath(file, pattern) { return globRegex(pattern).test(file); }
export function validateChangedPaths(taskText, paths, label = 'Task Path Contract') {
  const { allow, deny } = parsePathContract(taskText, label);
  const violations = [];
  for (const file of [...paths].sort()) {
    const denied = deny.find((pattern) => matchesPath(file, pattern));
    if (denied) violations.push(`${file} denied by ${denied}`);
    else if (!allow.some((pattern) => matchesPath(file, pattern))) violations.push(`${file} outside allow paths`);
  }
  if (violations.length) throw new Error(`${label}: changed paths exceed Task boundary: ${violations.join('; ')}`);
  return paths;
}
