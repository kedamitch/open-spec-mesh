import path from 'node:path';
import { existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { safeInside } from '../runtime/paths.js';
import { atomicWrite, createText } from '../runtime/io.js';
import { readTextCompat, pythonRstrip } from '../runtime/text.js';
import { withProjectLock } from '../runtime/locks.js';

export const AREAS = Object.freeze({
  '01-governance': 'G', '02-product': 'P', '03-architecture': 'T', '04-operations': 'O',
  '05-changes': 'C', '06-decisions': 'ADR', '07-research': 'R', '08-quality': 'Q', '09-delivery': 'D',
});
export const CODE = '(?:[GPTOCRQD][0-9]{2}(?:-[0-9]{2})*|ADR-[0-9]{3})';
const codePattern = new RegExp(`^${CODE}-`, 'u');

function codePointCompare(a, b) {
  const left = Array.from(a, (item) => item.codePointAt(0));
  const right = Array.from(b, (item) => item.codePointAt(0));
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
}

export function titleCheck(title) {
  if (typeof title !== 'string' || !/^[A-Za-z0-9_\-\u3400-\u9fff]{1,80}$/u.test(title) || !/[A-Za-z\u3400-\u9fff]/u.test(title)) {
    throw new Error('名称仅允许中英文文字、数字、下划线和连字符。');
  }
}

export function validateIndex(pathname) {
  if (!existsSync(pathname)) return;
  const content = readTextCompat(pathname);
  const begin = '<!-- INDEX:BEGIN -->';
  const end = '<!-- INDEX:END -->';
  const begins = content.split(begin).length - 1;
  const ends = content.split(end).length - 1;
  if ((begins || ends) && (begins !== 1 || ends !== 1 || content.indexOf(end) < content.indexOf(begin))) {
    throw new Error(`Invalid index markers: ${pathname}`);
  }
}

export function refresh(directory) {
  const pathname = path.join(directory, 'index.md');
  const old = existsSync(pathname) ? readTextCompat(pathname) : `# ${path.basename(directory)}\n`;
  validateIndex(pathname);
  const begin = '<!-- INDEX:BEGIN -->';
  const end = '<!-- INDEX:END -->';
  const names = readdirSync(directory, { withFileTypes: true })
    .map((entry) => entry.name)
    .filter((name) => name !== 'index.md' && !name.startsWith('.'))
    .sort(codePointCompare);
  const links = names.map((name) => {
    const target = path.join(directory, name);
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error(`Symlink is not a writable SDD path: ${target}`);
    return `- [${name}](${name}${stat.isDirectory() ? '/index.md' : ''})`;
  }).join('\n');
  const block = `${begin}\n${links}\n${end}`;
  const updated = old.includes(begin)
    ? `${old.slice(0, old.indexOf(begin))}${block}${old.slice(old.indexOf(end) + end.length)}`
    : `${pythonRstrip(old)}\n\n${block}\n`;
  atomicWrite(pathname, Buffer.from(updated, 'utf8'), { preserveMode: true });
}

export function prefix(root, parent) {
  const relative = path.relative(path.join(root, 'docs'), parent);
  const parts = relative.split(path.sep);
  if (!parts[0] || !Object.hasOwn(AREAS, parts[0])) throw new Error('请选择 docs 的一级分类或其子目录。');
  const base = AREAS[parts[0]];
  if (parts.length === 1 || /^CHG-[0-9]{8}-.+$/u.test(path.basename(parent))) return base;
  const match = path.basename(parent).match(new RegExp(`^(${CODE})-`, 'u'));
  if (!match || !match[1].startsWith(base)) throw new Error(`Invalid parent code: ${parent}`);
  return match[1];
}

function itemCode(pathname) {
  const match = path.basename(pathname).match(new RegExp(`^(${CODE})-`, 'u'));
  if (!match) throw new Error(`Invalid scaffold code: ${path.basename(pathname)}`);
  return match[1];
}

export function allocate(root, parent, title, { directory = false, extension = 'md', content = '' } = {}) {
  titleCheck(title);
  const canonicalParent = safeInside(root, path.relative(root, parent));
  const parentStat = lstatSync(canonicalParent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || !/^[a-z0-9]+$/u.test(extension)) throw new Error('Invalid parent or extension');
  const stem = prefix(root, canonicalParent);
  const lead = stem.length === 1 ? stem : `${stem}-`;
  const width = stem === 'ADR' ? 3 : 2;
  const numbered = new RegExp(`^${lead}([0-9]{${width}})-`, 'u');
  const nums = readdirSync(canonicalParent).map((name) => name.match(numbered)).filter(Boolean).map((match) => Number(match[1]));
  if (new Set(nums).size !== nums.length || nums.includes(0)) throw new Error('Existing duplicate/zero numbering; repair before allocating.');
  const number = Math.max(0, ...nums) + 1;
  if (number >= 10 ** width) throw new Error('编号已用尽，请按主题增加层级。');
  const name = `${lead}${String(number).padStart(width, '0')}-${title}`;
  const target = path.join(canonicalParent, directory ? name : `${name}.${extension}`);
  validateIndex(path.join(canonicalParent, 'index.md'));
  try {
    if (directory) {
      mkdirSync(target);
      createText(path.join(target, 'index.md'), content || `# ${title}\n`);
    } else createText(target, content || `# ${title}\n`);
    refresh(canonicalParent);
    return target;
  } catch (error) {
    if (directory) {
      try { unlinkSync(path.join(target, 'index.md')); rmdirSync(target); } catch { /* leave recovery evidence if an unexpected file appeared */ }
    } else {
      try { unlinkSync(target); } catch { /* file may not have been created */ }
    }
    throw error;
  }
}

export { withProjectLock };
