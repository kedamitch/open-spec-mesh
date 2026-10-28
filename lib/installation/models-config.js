import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const VALID_REASONING_EFFORTS = Object.freeze([
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'default',
]);

// 模型默认值的唯一事实源：DSH 插件（dsh/gatekeeper.mjs）与 `osm models` 都从这里读，
// 不要再在插件或 CLI 里复制一份字面量。
export const DEFAULT_MODELS = Object.freeze({
  architect: {
    provider: 'fatfei-codex',
    model: 'gpt-6.1-sol',
    reasoningEffort: 'xhigh',
    description: '架构师：复杂整体方案设计与关键技术假设验证',
  },
  worker: {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    reasoningEffort: 'max',
    description: '并行开发执行者：深度代码编写与自测',
  },
  explorer: {
    provider: 'fatfei',
    model: 'gemini-3.8-flash-high',
    reasoningEffort: 'high',
    description: '探索者：只读本地代码库事实检索',
  },
  librarian: {
    provider: 'fatfei',
    model: 'gemini-3.8-flash-high',
    reasoningEffort: 'high',
    description: '资料检索：只读外部 SDK 与文档检索',
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

/**
 * 结构化诊断 ~/.dsh/osm-models.json 配置完整性与合规性。
 */
export function diagnoseModelsConfig(homeDir) {
  const filePath = getModelsConfigPath(homeDir);
  const report = {
    filePath,
    exists: false,
    validJson: true,
    topLevelObject: true,
    globalIssues: [],
    unknownRoles: [],
    roles: {},
    overallStatus: 'ok',
    exitCode: 0,
    suggestions: [],
  };

  for (const [role, def] of Object.entries(DEFAULT_MODELS)) {
    report.roles[role] = {
      role,
      configured: false,
      provider: def.provider,
      model: def.model,
      reasoningEffort: def.reasoningEffort,
      status: 'ok',
      issues: [],
      suggestions: [],
    };
  }

  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
    report.exists = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      report.exists = true;
      report.validJson = false;
      report.overallStatus = 'error';
      report.exitCode = 1;
      report.globalIssues.push(`osm-models.json 读取失败: ${error.message}`);
    }
    return report;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    report.validJson = false;
    report.overallStatus = 'error';
    report.exitCode = 1;
    report.globalIssues.push(`osm-models.json 解析失败: ${error.message}`);
    report.suggestions.push('osm models reset');
    for (const r of Object.values(report.roles)) {
      r.status = 'error';
    }
    return report;
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    report.topLevelObject = false;
    report.overallStatus = 'error';
    report.exitCode = 1;
    report.globalIssues.push('osm-models.json 顶层必须是对象');
    report.suggestions.push('osm models reset');
    for (const r of Object.values(report.roles)) {
      r.status = 'error';
    }
    return report;
  }

  for (const key of Object.keys(parsed)) {
    if (!Object.hasOwn(DEFAULT_MODELS, key)) {
      report.unknownRoles.push(key);
      report.globalIssues.push(`发现未识别的冗余角色 "${key}"（已忽略）`);
    }
  }

  let hasError = false;
  for (const role of Object.keys(DEFAULT_MODELS)) {
    const roleReport = report.roles[role];
    const def = DEFAULT_MODELS[role];

    if (!Object.hasOwn(parsed, role)) {
      roleReport.configured = false;
      roleReport.status = 'default';
      continue;
    }

    roleReport.configured = true;
    const value = parsed[role];

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      roleReport.status = 'error';
      roleReport.issues.push(`角色 ${role} 配置必须是对象`);
      const cmd = `osm models set ${role} --provider ${def.provider} --model ${def.model} --effort ${def.reasoningEffort}`;
      roleReport.suggestions.push(cmd);
      report.suggestions.push(cmd);
      hasError = true;
      continue;
    }

    let roleError = false;
    for (const field of ['provider', 'model']) {
      const raw = value[field];
      if (typeof raw === 'string' && raw.trim() !== '') {
        roleReport[field] = raw.trim();
      } else {
        roleReport[field] = raw === '' ? '(empty)' : '(missing)';
        roleReport.issues.push(`缺少必填字段 ${field}`);
        roleError = true;
      }
    }

    if (Object.hasOwn(value, 'reasoningEffort')) {
      const rawEffort = value.reasoningEffort;
      if (typeof rawEffort === 'string' && rawEffort.trim() !== '') {
        const trimmedEffort = rawEffort.trim();
        roleReport.reasoningEffort = trimmedEffort;
        if (!VALID_REASONING_EFFORTS.includes(trimmedEffort)) {
          roleReport.issues.push(`reasoningEffort 档位 "${trimmedEffort}" 非法，合法档位: ${VALID_REASONING_EFFORTS.join(', ')}`);
          roleError = true;
        }
      } else {
        roleReport.reasoningEffort = rawEffort === '' ? '(empty)' : '(invalid)';
        roleReport.issues.push(`reasoningEffort 不能为空，合法档位: ${VALID_REASONING_EFFORTS.join(', ')}`);
        roleError = true;
      }
    } else {
      roleReport.reasoningEffort = def.reasoningEffort;
    }

    if (roleError) {
      roleReport.status = 'error';
      hasError = true;
      const prov = (roleReport.provider !== '(missing)' && roleReport.provider !== '(empty)') ? roleReport.provider : def.provider;
      const mod = (roleReport.model !== '(missing)' && roleReport.model !== '(empty)') ? roleReport.model : def.model;
      const eff = VALID_REASONING_EFFORTS.includes(roleReport.reasoningEffort) ? roleReport.reasoningEffort : def.reasoningEffort;
      const cmd = `osm models set ${role} --provider ${prov} --model ${mod} --effort ${eff}`;
      roleReport.suggestions.push(cmd);
      report.suggestions.push(cmd);
    } else {
      roleReport.status = 'ok';
    }
  }

  if (hasError) {
    report.overallStatus = 'error';
    report.exitCode = 1;
  }

  return report;
}

const CORE_ROLES = Object.freeze(['architect', 'worker', 'explorer', 'librarian']);

export function exportModelsConfig(targetPath, homeDir) {
  const resolvedPath = targetPath
    ? path.resolve(targetPath)
    : path.resolve(process.cwd(), 'osm-models-backup.json');
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const config = loadModelsConfig(homeDir);
  fs.writeFileSync(resolvedPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return { success: true, targetPath: resolvedPath, config };
}

export function importModelsConfig(sourcePath, options = {}, homeDir) {
  const resolvedSourcePath = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSourcePath)) {
    return { success: false, reason: '源文件不存在: ' + resolvedSourcePath };
  }
  let text;
  try {
    text = fs.readFileSync(resolvedSourcePath, 'utf8');
  } catch (error) {
    return { success: false, reason: '源文件读取失败: ' + error.message };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { success: false, reason: 'JSON 解析失败: ' + error.message };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { success: false, reason: '配置内容格式错误: 顶层必须为非空对象' };
  }

  const missingRoles = CORE_ROLES.filter((role) => !Object.hasOwn(parsed, role));
  if (missingRoles.length > 0) {
    return { success: false, reason: '缺少必要角色配置: ' + missingRoles.join(', ') };
  }

  for (const role of CORE_ROLES) {
    const value = parsed[role];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { success: false, reason: '角色 ' + role + ' 缺少必填字段 provider 或 model' };
    }
    const provider = typeof value.provider === 'string' ? value.provider.trim() : '';
    const model = typeof value.model === 'string' ? value.model.trim() : '';
    if (!provider || !model) {
      return { success: false, reason: '角色 ' + role + ' 缺少必填字段 provider 或 model' };
    }
    if (Object.hasOwn(value, 'reasoningEffort')) {
      const rawEffort = value.reasoningEffort;
      const effort = typeof rawEffort === 'string' ? rawEffort.trim() : rawEffort;
      if (typeof rawEffort !== 'string' || !VALID_REASONING_EFFORTS.includes(effort)) {
        return {
          success: false,
          reason: '角色 ' + role + ' 的 reasoningEffort "' + effort + '" 不合法，有效档位: ' + VALID_REASONING_EFFORTS.join(', '),
        };
      }
    }
  }

  const targetPath = getModelsConfigPath(homeDir);
  if (fs.existsSync(targetPath) && !options.force) {
    return {
      success: false,
      blocked: true,
      reason: '目标配置文件已存在 (~/.dsh/osm-models.json)，若需覆盖请追加 --force 选项。',
      targetPath,
    };
  }

  const validatedConfig = {};
  for (const role of CORE_ROLES) {
    validatedConfig[role] = { ...parsed[role] };
    validatedConfig[role].provider = parsed[role].provider.trim();
    validatedConfig[role].model = parsed[role].model.trim();
    if (Object.hasOwn(parsed[role], 'reasoningEffort')) {
      validatedConfig[role].reasoningEffort = parsed[role].reasoningEffort.trim();
    }
  }

  saveModelsConfig(validatedConfig, homeDir);
  return {
    success: true,
    targetPath,
    count: 4,
    config: validatedConfig,
  };
}
