import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_MODELS = Object.freeze({
  architect: {
    provider: 'fatfei-codex',
    model: 'deepseek-flash',
    reasoningEffort: 'max',
    description: '架构师：复杂整体方案设计与关键技术假设验证',
  },
  worker: {
    provider: 'fatfei-codex',
    model: 'deepseek-flash',
    reasoningEffort: 'high',
    description: '并行开发执行者：深度代码编写与自测',
  },
  reviewer: {
    provider: 'fatfei-codex',
    model: 'deepseek-flash',
    reasoningEffort: 'max',
    description: '审查者：代码质量、安全与回退风险复核',
  },
  explorer: {
    provider: 'fatfei-codex',
    model: 'deepseek-flash',
    reasoningEffort: 'low',
    description: '探索者：只读本地代码库事实检索（低思考快速响应）',
  },
  librarian: {
    provider: 'fatfei-codex',
    model: 'deepseek-flash',
    reasoningEffort: 'low',
    description: '资料检索：只读外部 SDK 与文档检索（低思考快速响应）',
  },
});

export function getModelsConfigPath(homeDir = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')) {
  return path.join(homeDir, 'osm-models.json');
}

export function loadModelsConfig(homeDir) {
  const filePath = getModelsConfigPath(homeDir);
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { ...DEFAULT_MODELS, ...parsed };
    }
  } catch {
    // 发生异常时平滑回退默认
  }
  return { ...DEFAULT_MODELS };
}

export function saveModelsConfig(config, homeDir) {
  const filePath = getModelsConfigPath(homeDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o755 });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', { mode: 0o644 });
  return filePath;
}
