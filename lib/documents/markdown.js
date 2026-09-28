import { metadata, renderSpec } from './common.js';
import { pythonRstrip } from '../runtime/text.js';

export const EVIDENCE_BEGIN = '<!-- SDD:EVIDENCE:BEGIN -->';
export const EVIDENCE_END = '<!-- SDD:EVIDENCE:END -->';
export const CLOSE_FIELDS = new Set(['integrated_revision', 'product', 'technology', 'operations']);

export function visibleLines(text) {
  const lines = text.match(/.*(?:\n|$)/gu)?.filter((line, index, all) => line !== '' || index < all.length - 1) ?? [];
  let fence = null;
  let comment = false;
  const visible = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].replace(/[\r\n]+$/u, '');
    const match = raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = null;
      continue;
    }
    if (comment) {
      if (raw.includes('-->')) comment = false;
      continue;
    }
    if (raw === EVIDENCE_BEGIN || raw === EVIDENCE_END) visible.push([index, raw]);
    else if (raw.includes('<!--')) comment = !raw.slice(raw.indexOf('<!--') + 4).includes('-->');
    else if (match) fence = match[1];
    else if (!raw.startsWith('    ') && !raw.startsWith('\t')) visible.push([index, raw]);
  }
  if (fence || comment) throw new Error('Unclosed Markdown code fence or HTML comment');
  return visible;
}

export function splitContract(input) {
  let text = input;
  let fields = Object.create(null);
  if (text.startsWith('---\n')) [fields, text] = metadata(text);
  const lines = text.match(/.*(?:\n|$)/gu)?.filter((line, index, all) => line !== '' || index < all.length - 1) ?? [];
  const visible = visibleLines(text);
  const begins = visible.filter(([, line]) => line === EVIDENCE_BEGIN).map(([index]) => index);
  const ends = visible.filter(([, line]) => line === EVIDENCE_END).map(([index]) => index);
  if (begins.length !== 1 || ends.length !== 1 || begins[0] >= ends[0]) throw new Error('Require exactly one ordered SDD:EVIDENCE marker pair');
  if (lines.slice(ends[0] + 1).join('').trim()) throw new Error('Evidence region must be the final region of the document');
  const evidence = lines.slice(begins[0] + 1, ends[0]).join('');
  const evidenceHeadings = visibleLines(evidence).map(([, line]) => line).filter((line) => /^#{1,2}\s/u.test(line));
  if (evidenceHeadings.length !== 2 || evidenceHeadings[0] !== '## 验证结果' || evidenceHeadings[1] !== '## 最终结论') throw new Error('Evidence must contain only ## 验证结果 and ## 最终结论');
  let stable = pythonRstrip(lines.slice(0, begins[0]).join('')) + '\n';
  const immutable = Object.create(null);
  for (const key of Object.keys(fields).sort()) if (!CLOSE_FIELDS.has(key)) immutable[key] = fields[key];
  if (Object.keys(immutable).length) stable = renderSpec(immutable, stable);
  return [stable, evidence];
}
