import {
  loadModelsConfig, saveModelsConfig, DEFAULT_MODELS, diagnoseModelsConfig,
} from '../installation/models-config.js';

function stringWidth(str) {
  let width = 0;
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    if ((code >= 0x4e00 && code <= 0x9fff)
        || (code >= 0xff01 && code <= 0xff60)
        || (code >= 0x3000 && code <= 0x303f)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

function padEndWidth(str, targetWidth) {
  const current = stringWidth(str);
  if (current >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - current);
}

function renderTable(headers, rows) {
  const colCount = headers.length;
  const colWidths = headers.map((h) => stringWidth(h));

  for (const row of rows) {
    for (let i = 0; i < colCount; i++) {
      const cellWidth = stringWidth(row[i]);
      if (cellWidth > colWidths[i]) colWidths[i] = cellWidth;
    }
  }

  // 给每列加 2 个半角空格 padding
  const paddedWidths = colWidths.map((w) => w + 2);

  const topBorder = `┌${paddedWidths.map((w) => '─'.repeat(w)).join('┬')}┐\n`;
  const midBorder = `├${paddedWidths.map((w) => '─'.repeat(w)).join('┼')}┤\n`;
  const botBorder = `└${paddedWidths.map((w) => '─'.repeat(w)).join('┴')}┘\n`;

  function renderRow(cells) {
    const renderedCells = cells.map((cell, i) => ` ${padEndWidth(cell, paddedWidths[i] - 1)}`);
    return `│${renderedCells.join('│')}│\n`;
  }

  let table = topBorder;
  table += renderRow(headers);
  table += midBorder;
  for (const row of rows) {
    table += renderRow(row);
  }
  table += botBorder;
  return table;
}

function handleModelsDoctor(argv, streams, homeDir) {
  const stdout = streams.stdout ?? process.stdout;
  const report = diagnoseModelsConfig(homeDir);

  stdout.write(`Open Spec Mesh 模型配置诊断报告 (${report.filePath}):\n\n`);

  const headers = ['角色', 'Provider', 'Model', 'Effort', '状态'];
  const rows = Object.values(report.roles).map((r) => [
    r.role,
    r.provider,
    r.model,
    r.reasoningEffort,
    r.status === 'ok' ? 'OK' : (r.status === 'default' ? 'DEFAULT' : 'ERROR'),
  ]);

  stdout.write(renderTable(headers, rows));

  if (report.overallStatus === 'ok') {
    if (!report.exists) {
      stdout.write('\nℹ 未检测到 ~/.dsh/osm-models.json，当前全部 4 个子代理角色均按系统默认（DEFAULT_MODELS）生效。\n如需自定义，可执行: osm models reset 或 osm models set <role> ...\n');
    } else {
      stdout.write('\n✔ 所有 4 个核心角色模型配置合规。\n');
    }
    if (report.unknownRoles.length > 0) {
      stdout.write(`\n⚠ 发现 ${report.unknownRoles.length} 个未识别的冗余角色定义（已忽略）: ${report.unknownRoles.join(', ')}\n`);
    }
  } else {
    const allIssues = [...report.globalIssues];
    for (const r of Object.values(report.roles)) {
      for (const issue of r.issues) {
        allIssues.push(`${r.role}: ${issue}`);
      }
    }
    stdout.write(`\n❌ 发现 ${allIssues.length} 个配置问题:\n`);
    for (const issue of allIssues) {
      stdout.write(`  - ${issue}\n`);
    }

    if (report.suggestions.length > 0) {
      const uniqueSuggestions = Array.from(new Set(report.suggestions));
      stdout.write('\n💡 一键修复建议:\n');
      for (const cmd of uniqueSuggestions) {
        stdout.write(`  ${cmd}\n`);
      }
    }
  }

  return report.exitCode;
}

export function runModelsCommand(argv = process.argv.slice(3), streams = {}, homeDir) {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;

  const sub = argv[0];
  if (sub === 'doctor' || sub === 'check') {
    return handleModelsDoctor(argv.slice(1), streams, homeDir);
  }

  if (!sub || sub === 'list' || sub === 'show') {
    const config = loadModelsConfig(homeDir);
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

    const current = loadModelsConfig(homeDir);
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

    saveModelsConfig(current, homeDir);
    stdout.write(`成功更新 ${role} 的模型配置。\n`);
    return 0;
  }

  if (sub === 'reset') {
    saveModelsConfig(DEFAULT_MODELS, homeDir);
    stdout.write('已重置所有子代理模型配置为默认配置 (DEFAULT_MODELS)。\n');
    return 0;
  }

  stderr.write(`未知子命令: ${sub}\n用法: osm models [list|doctor|check|set <role> --provider <p> --model <m> --effort <e>|reset]\n`);
  return 1;
}
