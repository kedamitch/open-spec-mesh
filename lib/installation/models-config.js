import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 模型默认值的唯一事实源：DSH 插件（dsh/gatekeeper.mjs）与 `osm models` 都从这里读，
// 不要再在插件或 CLI 里复制一份字面量。
export const DEFAULT_MODELS = Object.freeze({
  architect: {
    provider: 'fatfei-codex',
    model: 'gpt-6.1-sol',
    reasoningEffort: 'xhigh',
    description: '架构师：复杂整体方案设计与关键技术假设验证 (sol-6.1 xhigh)',
  },
  worker: {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    reasoningEffort: 'max',
    description: '并行开发执行者：深度代码编写与自测 (DeepSeek Flash 4.1 max)',
  },
  reviewer: {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    reasoningEffort: 'max',
    description: '审查者：代码质量、安全与回退风险复核 (DeepSeek Flash 4.1 max)',
  },
  explorer: {
    provider: 'fatfei',
    model: 'gemini-3.8-flash-high',
    reasoningEffort: 'high',
    description: '探索者：只读本地代码库事实检索 (fatfei/gemini-3.8-flash-high)',
  },
  librarian: {
    provider: 'fatfei',
    model: 'gemini-3.8-flash-high',
    reasoningEffort: 'high',
    description: '资料检索：只读外部 SDK 与文档检索 (fatfei/gemini-3.8-flash-high)',
  },
});

export function getModelsConfigPath(homeDir = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')) {
  return path.join(homeDir, 'osm-models.json');
}

function defaultModels() {
  const config = {};
  for (const [role, route] of Object.entries(DEFAULT_MODELS)) config[role] = { ...route };
  return config;
}

/**
 * 读 osm-models.json 并按角色深合并：文件写到的字段覆盖默认值，没写到的字段用该角色默认值补齐。
 * 任何无法解释的输入都记入 problems（而不是静默回落），由调用方显式展示。
 */
export function loadModelsConfigWithDiagnostics(homeDir) {
  const problems = [];
  const filePath = getModelsConfigPath(homeDir);
  const config = defaultModels();
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') problems.push(`osm-models.json 读取失败: ${error.message}`);
    return { config, problems, filePath };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    problems.push(`osm-models.json 解析失败: ${error.message}`);
    return { config, problems, filePath };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    problems.push('osm-models.json 顶层必须是对象');
    return { config, problems, filePath };
  }
  for (const [role, value] of Object.entries(parsed)) {
    if (!Object.hasOwn(DEFAULT_MODELS, role)) {
      problems.push(`未知角色 ${role} 已忽略`);
      continue;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      problems.push(`角色 ${role} 的配置必须是对象，已使用默认路由`);
      continue;
    }
    for (const field of ['provider', 'model']) {
      const raw = value[field];
      if (typeof raw === 'string' && raw.trim() !== '') config[role][field] = raw.trim();
      else problems.push(`角色 ${role} 缺少 ${field}，已使用默认值 ${DEFAULT_MODELS[role][field]}`);
    }
    if (typeof value.reasoningEffort === 'string' && value.reasoningEffort.trim() !== '') config[role].reasoningEffort = value.reasoningEffort.trim();
    if (typeof value.description === 'string' && value.description.trim() !== '') config[role].description = value.description;
  }
  return { config, problems, filePath };
}

export function loadModelsConfig(homeDir) {
  return loadModelsConfigWithDiagnostics(homeDir).config;
}

export function saveModelsConfig(config, homeDir) {
  const filePath = getModelsConfigPath(homeDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o755 });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', { mode: 0o644 });
  return filePath;
}
