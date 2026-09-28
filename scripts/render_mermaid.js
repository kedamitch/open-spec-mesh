#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function diagrams(root) {
  const output = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.git', 'node_modules', '.venv'].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { visit(absolute); continue; }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      let fence = null; let content = []; let render = false; let number = 0;
      for (const line of fs.readFileSync(absolute, 'utf8').split(/\r?\n/u)) {
        const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
        if (fence) {
          if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) {
            if (render) { number += 1; output.push({ file: absolute, number, body: content.join('\n') }); }
            fence = null; render = false; content = [];
          } else if (render) content.push(line);
        } else if (match) { fence = match[1]; render = match[2].trim() === 'mermaid'; content = []; }
      }
      if (fence) throw new Error(`Unclosed Markdown fence: ${path.relative(root, absolute)}`);
    }
  };
  visit(root);
  return output;
}

export function render({ root = ROOT, renderer = 'mmdc', output, spawn = spawnSync } = {}) {
  if (!output) throw new Error('--output is required');
  const items = diagrams(root);
  if (!items.length) throw new Error('No Mermaid diagrams found');
  fs.mkdirSync(output, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'osm-mermaid-'));
  try {
    const config = path.join(temporary, 'puppeteer.json');
    fs.writeFileSync(config, JSON.stringify({ args: ['--no-sandbox'] }));
    for (const item of items) {
      const name = `${path.relative(root, item.file).split(path.sep).join('__')}-${item.number}`;
      const source = path.join(temporary, `${name}.mmd`);
      const destination = path.join(output, `${name}.svg`);
      fs.writeFileSync(source, item.body);
      const result = spawn(renderer, ['-p', config, '-i', source, '-o', destination], { cwd: root, stdio: 'inherit', shell: false, timeout: 90_000 });
      if (result.error || result.status !== 0) throw new Error(`Mermaid renderer failed for ${path.relative(root, item.file)} (${result.status ?? result.error?.message ?? 'unknown'})`);
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  process.stdout.write(`Mermaid rendered successfully: ${items.length}\n`);
  return items.length;
}

function main(argv) {
  let renderer = 'mmdc'; let output;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--mmdc') renderer = argv[++index];
    else if (flag === '--output') output = argv[++index];
    else if (flag === '--help' || flag === '-h') { process.stdout.write('Usage: node scripts/render_mermaid.js [--mmdc PATH] --output DIR\n'); return 0; }
    else throw new Error(`Unknown argument: ${flag}`);
    if (!argv[index]) throw new Error(`${flag} requires a value`);
  }
  render({ renderer, output: output && path.resolve(output) });
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
