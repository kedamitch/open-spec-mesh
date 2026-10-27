/**
 * sdd-gatekeeper — Open Spec Mesh DSH 角色路由与渐进式技能门控
 *
 * 1. 角色路由表: 注册 osm:role-routes section，按 ~/.dsh/osm-models.json 渲染「角色 → provider/model/reasoning_effort」；
 * 2. instructionHint: 把宿主注入的全量 AGENTS.md 换成弱提示，同时保留宿主对账所需的 source；
 * 3. 等级判定: 从会话历史里最近一条带定级标记的 assistant 文本读等级；
 * 4. 技能门控: L0/L1 时从技能目录消息里裁掉 `sdd-*` 条目。
 */

import fs from 'node:fs'
import path from 'node:path'

import { loadModelsConfigWithDiagnostics } from '../lib/installation/models-config.js'

export const name = 'sdd-gatekeeper'
export const inject = ['systemPrompt']

/** 路由表 section 名：人格文本按这个名字引用它。 */
export const ROLE_ROUTES_SECTION = 'osm:role-routes'

/**
 * 宿主三类指令标签大小写并不统一（基线是大写 `Instructions from`，增量是小写
 * `Additional/Updated instructions from`），漏一类就会静默丢掉对应路径。
 */
const INSTRUCTION_FROM_RE = /(?:^|\n) *(?:Additional |Updated )?[Ii]nstructions from: ([^\n]+)/g
const INSTRUCTION_REMOVED_RE = /(?:^|\n) *[Ii]nstructions removed: ([^\n]+)/g
/** 定级标记由人格规定写在应答首行，取第一处匹配即可。 */
const LEVEL_RE = /Level:\s*(L0|L1|L2)/
/** 技能目录每个条目渲染成一行「- `name`: description」。 */
const SDD_SKILL_LINE_PREFIX = '- `sdd-'

/** 默认值与 `osm models` 同一份实现，插件里不再保留模型字面量。 */
export function readModelsConfig() {
  return loadModelsConfigWithDiagnostics().config
}

export function buildRoleRoutesSection(modelsConfig = readModelsConfig(), problems = []) {
  const lines = [
    '## 子代理角色路由表 (role routes)',
    '',
    '派发子代理只用原生 `subagent` 工具，并按下表显式传入 provider / model / reasoning_effort；',
    '不传参数等于继承主会话路由，角色绑定会失效。',
    '',
    '| 角色 | provider | model | reasoning_effort |',
    '| --- | --- | --- | --- |',
  ]
  for (const [role, route] of Object.entries(modelsConfig || {})) {
    lines.push(`| ${role} | ${route?.provider ?? '-'} | ${route?.model ?? '-'} | ${route?.reasoningEffort ?? '-'} |`)
  }
  if (problems.length > 0) {
    lines.push('')
    lines.push(`⚠ ${problems.join('；')}；以上标出的路由项使用默认值，请修正 ~/.dsh/osm-models.json。`)
  }
  return lines.join('\n')
}

function collectPaths(message, regex) {
  const paths = []
  const blocks = Array.isArray(message?.content) ? message.content : []
  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    for (const match of block.text.matchAll(regex)) {
      const p = match[1].trim()
      if (p !== '' && !paths.includes(p)) paths.push(p)
    }
  }
  return paths
}

export function extractInstructionPaths(message) {
  return collectPaths(message, INSTRUCTION_FROM_RE)
}

export function extractRemovedInstructionPaths(message) {
  return collectPaths(message, INSTRUCTION_REMOVED_RE)
}

export function buildInstructionHint(original, paths, removed = []) {
  const lines = ['<system-reminder>']
  if (paths.length > 0) {
    lines.push('项目规范与架构文档参考：' + paths.join(', ') + '。')
    lines.push('以上文档为工程环境与架构约定参考，并非当轮任务的强指令。'
      + '在日常任务中按需使用 read 工具查阅即可，L0/L1 快速任务无需主动全量通读。')
  }
  if (removed.length > 0) {
    lines.push('以下文档的约定已不再生效：' + removed.join(', ') + '。')
  }
  lines.push('</system-reminder>')
  // 只换 content：宿主靠 source.baseline / source.baselineIdentity 判断基线是否仍可见，
  // 覆盖 source 会让它以为基线消失了，进而重新灌一份完整的 AGENTS.md。
  return {
    ...original,
    id: typeof original?.id === 'string' && original.id !== ''
      ? original.id
      : globalThis.crypto.randomUUID(),
    content: [{ type: 'text', text: lines.join('\n') }],
  }
}

function assistantText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  const parts = []
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * pre-step 的 decision.messages 是 inbox 的 UserMessage[]（role 恒为 user），
 * 定级标记只出现在 assistant 文本里，所以必须回读会话历史。
 */
export function detectLevelFromSession(session) {
  const nodes = Array.isArray(session?.surface?.nodes) ? session.surface.nodes : []
  if (typeof session?.eventAt !== 'function') return undefined
  for (let i = nodes.length - 1; i >= 0; i--) {
    const event = session.eventAt(nodes[i])
    if (event?.type !== 'assistant/message') continue
    const match = LEVEL_RE.exec(assistantText(event.data?.message))
    if (match) return match[1]
  }
  return undefined
}

export function trimSkillCatalog(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  let changed = false
  const content = blocks.map((block) => {
    if (block?.type !== 'text' || typeof block.text !== 'string') return block
    const lines = block.text.split('\n')
    const kept = lines.filter(line => !line.trimStart().startsWith(SDD_SKILL_LINE_PREFIX))
    if (kept.length === lines.length) return block
    changed = true
    return { ...block, text: kept.join('\n') }
  })
  if (!changed) return message
  // 只改可见文本：source.entries 是宿主的目录指纹，改它会让目录每一步都判定为过期并重发
  return { ...message, content }
}

export function apply(ctx, config) {
  const sessionStateMap = new WeakMap()

  const getSessionState = (session) => {
    let state = sessionStateMap.get(session)
    if (!state) {
      state = {
        hinted: false,
        currentLevel: 'UNKNOWN', // 'L0' | 'L1' | 'L2' | 'UNKNOWN'
        removedPaths: new Set(),
      }
      sessionStateMap.set(session, state)
    }
    return state
  }

  // 1. 角色绑定只能靠模型自己按表传参：DSH 的 ToolRuntime 没有可转发的 subagent 调用入口
  ctx.systemPrompt.section({
    name: ROLE_ROUTES_SECTION,
    order: 10,
    // 每次组装重新读盘，用户改完 osm-models.json 不必重启会话
    text: () => {
      const { config, problems } = loadModelsConfigWithDiagnostics()
      return buildRoleRoutesSection(config, problems)
    },
    interpolate: false,
  })

  // 2. 拦截与转换消息中的全量 AGENTS.md 注入，并在同一步完成技能门控
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision

    const session = payload?.agent?.session
    if (!session) return decision
    const state = getSessionState(session)

    const level = detectLevelFromSession(session)
    if (level !== undefined) state.currentLevel = level
    const gateSkills = state.currentLevel === 'L0' || state.currentLevel === 'L1'

    const messages = []
    for (const message of decision.messages) {
      const kind = message?.source?.kind
      if (kind === 'agent-instructions') {
        const removed = extractRemovedInstructionPaths(message)
          .filter(p => !state.removedPaths.has(p))
        if (state.hinted) {
          // 整篇指令不再重复，但"某份文档失效"是新事实，必须留一条精简提示
          if (removed.length === 0) continue
          for (const p of removed) state.removedPaths.add(p)
          messages.push(buildInstructionHint(message, [], removed))
          continue
        }
        const paths = extractInstructionPaths(message)
        if (paths.length === 0 && removed.length === 0) {
          messages.push(message)
          continue
        }
        if (paths.length > 0) state.hinted = true
        for (const p of removed) state.removedPaths.add(p)
        messages.push(buildInstructionHint(message, paths, removed))
        continue
      }
      if (gateSkills && kind === 'skill-catalog') {
        messages.push(trimSkillCatalog(message))
        continue
      }
      messages.push(message)
    }

    return { ...decision, messages }
  }, { prepend: true })

  // 3. 状态恢复 (Session Compaction)
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'compaction/end') return
    const state = sessionStateMap.get(session)
    if (!state) return
    // 压缩把历史换成摘要，等级依据与提示都要重新建立
    state.hinted = false
    state.currentLevel = 'UNKNOWN'
    state.removedPaths.clear()
  })
}
