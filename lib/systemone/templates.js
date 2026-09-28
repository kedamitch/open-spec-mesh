import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { encode, isJsonObject, packageRoot, parseJsonLossless, readSafeFile, validateQuestions } from './contracts.js';

const ID_PATTERN = /^([a-z][a-z0-9-]{0,63})@([1-9][0-9]{0,3})$/u;
function bytesHex(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function readTemplate(filename) {
  const bytes = readSafeFile(filename, 65536, 'template');
  const value = parseJsonLossless(bytes.toString('utf8'));
  if (!isJsonObject(value) || typeof value.id !== 'string' || !ID_PATTERN.test(value.id)) throw new TypeError('invalid template ID');
  if (typeof value.description !== 'string') throw new TypeError('template needs a description');
  if (!Array.isArray(value.required_fields) || value.required_fields.length < 1
    || value.required_fields.some((field) => typeof field !== 'string' || !field)) {
    throw new TypeError('required_fields must be a nonempty list of field names');
  }
  validateQuestions(value.questions);
  value.digest = bytesHex(encode(value));
  return value;
}

export function loadTemplate(decision, { env = process.env, root = packageRoot() } = {}) {
  if (typeof decision !== 'string' || !ID_PATTERN.test(decision)) throw new TypeError('decision must be name@version');
  const match = ID_PATTERN.exec(decision);
  const name = `${match[1]}.v${match[2]}.json`;
  const built = path.join(root, 'mcp', 'templates', name);
  let filename = built;
  try { lstatSync(built); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const directory = String(env.LAYA_TEMPLATE_DIR ?? '');
    if (!directory || !path.isAbsolute(directory)) {
      throw new TypeError('unknown decision; custom templates require an absolute LAYA_TEMPLATE_DIR');
    }
    filename = path.join(directory, name);
  }
  const value = readTemplate(filename);
  if (value.id !== decision) throw new TypeError('template ID does not match filename');
  return value;
}

export function listTemplates({ env = process.env, root = packageRoot() } = {}) {
  const result = [];
  const seen = new Set();
  const directories = [path.join(root, 'mcp', 'templates')];
  if (String(env.LAYA_TEMPLATE_DIR ?? '')) {
    if (!path.isAbsolute(env.LAYA_TEMPLATE_DIR)) throw new TypeError('LAYA_TEMPLATE_DIR must be absolute');
    directories.push(env.LAYA_TEMPLATE_DIR);
  }
  for (const directory of directories) {
    const files = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.name.endsWith('.json'))
      .map((entry) => entry.name).sort().slice(0, 64);
    for (const name of files) {
      const value = readTemplate(path.join(directory, name));
      if (!seen.has(value.id)) {
        seen.add(value.id);
        result.push({ id: value.id, description: value.description, required_fields: value.required_fields });
      }
    }
  }
  return result;
}
