import { loadModelsConfig, saveModelsConfig, DEFAULT_MODELS } from '../installation/models-config.js';

export function runModelsCommand(argv = process.argv.slice(3), streams = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;

  const sub = argv[0];
  if (!sub || sub === 'list' || sub === 'show') {
    const config = loadModelsConfig();
    stdout.write('Open Spec Mesh Subagent 模型配置 (~/.dsh/osm-models.json):\n\n');
    for (const [role, info] of Object.entries(config)) {
      stdout.write(`- ${role.padEnd(10)}: provider=${info.provider || '(inherit)'}, model=${info.model || '(inherit)'}, effort=${info.reasoningEffort || 'default'} (${info.description || ''})\n`);
    }
    stdout.write('\n修改示例:\n  osm models set explorer --provider fatfei --model gemini-3.8-flash-high --effort high\n');
    stdout.write('路由 allowlist 由宿主校验，osm 不校验 provider/model 是否在名单内。\n');
    return 0;
  }

  if (sub === 'set') {
    const role = argv[1];
    if (!role || !DEFAULT_MODELS[role]) {
      stderr.write(`错误: 未知角色 "${role}"。可选角色: ${Object.keys(DEFAULT_MODELS).join(', ')}\n`);
      return 1;
    }

    let provider = null;
    let model = null;
    let effort = null;

    for (let i = 2; i < argv.length; i++) {
      const arg = argv[i];
      if (!['--provider', '--model', '--effort', '--reasoning-effort'].includes(arg)) continue;
      const value = argv[i + 1];
      // 空值或写成下一个 flag 的值都不算有效输入：静默沿用默认值会让用户以为改成功了。
      if (typeof value !== 'string' || value.trim() === '' || value.startsWith('--')) {
        stderr.write(`错误: ${arg} 需要一个非空值。\n`);
        return 1;
      }
      i += 1;
      if (arg === '--provider') provider = value.trim();
      else if (arg === '--model') model = value.trim();
      else effort = value.trim();
    }

    if (!provider && !model && !effort) {
      stderr.write('错误: 需至少指定 --provider, --model 或 --effort 参数之一。\n');
      return 1;
    }

    const current = loadModelsConfig();
    current[role] = {
      ...current[role],
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { reasoningEffort: effort } : {}),
    };

    for (const field of ['provider', 'model']) {
      const value = current[role][field];
      if (typeof value !== 'string' || value.trim() === '') {
        stderr.write(`错误: 角色 ${role} 的 ${field} 为空，拒绝写入不完整的路由。\n`);
        return 1;
      }
    }

    saveModelsConfig(current);
    stdout.write(`成功更新 ${role} 的模型配置。\n`);
    return 0;
  }

  if (sub === 'reset') {
    saveModelsConfig(DEFAULT_MODELS);
    stdout.write('已重置所有子代理模型配置为默认配置 (DEFAULT_MODELS)。\n');
    return 0;
  }

  stderr.write(`未知子命令: ${sub}\n用法: osm models [list|set <role> --provider <p> --model <m> --effort <e>|reset]\n`);
  return 1;
}
