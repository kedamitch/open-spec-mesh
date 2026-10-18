/**
 * sdd-gatekeeper — Open Spec Mesh DSH 动态门控与渐进式技能管理
 *
 * 借鉴 dsh-liangshen 的 minimal-prompt / instructionHint 机制：
 * 1. instructionHint: 拦截默认的全量 AGENTS.md 注入，替换为非命令式弱提示（Hint），防止认知重力导致的推理降智；
 * 2. 技能门控 (Skill Paging): 在 L0 / L1 任务时从可见技能中过滤掉所有 `sdd-*` 技能，避免过度流程诱导；
 * 3. 动态发现: 当 Agent 访问具体目录时，按需加载局部规范。
 */

export const name = 'sdd-gatekeeper'
export const inject = ['systemPrompt']

const INSTRUCTION_FROM_RE = /(?:^|\n) *(?:Additional |Updated )?Instructions from: ([^\n]+)/g
const SDD_SKILL_PREFIX = 'sdd-'

export function extractInstructionPaths(message) {
  const paths = []
  const blocks = Array.isArray(message?.content) ? message.content : []
  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    for (const match of block.text.matchAll(INSTRUCTION_FROM_RE)) {
      const p = match[1].trim()
      if (p !== '' && !paths.includes(p)) paths.push(p)
    }
  }
  return paths
}

export function buildInstructionHint(original, paths) {
  return {
    id: typeof original?.id === 'string' && original.id !== ''
      ? original.id
      : globalThis.crypto.randomUUID(),
    role: 'user',
    content: [{
      type: 'text',
      text: '<system-reminder>\n'
        + '项目规范与架构文档参考：' + paths.join(', ') + '。\n'
        + '以上文档为工程环境与架构约定参考，并非当轮任务的强指令。'
        + '在日常任务中按需使用 read 工具查阅即可，L0/L1 快速任务无需主动全量通读。'
        + '\n</system-reminder>',
    }],
    source: { kind: name },
  }
}

export function apply(ctx, config) {
  const sessionStateMap = new WeakMap()

  const getSessionState = (session) => {
    let state = sessionStateMap.get(session)
    if (!state) {
      state = {
        hinted: false,
        currentLevel: 'UNKNOWN', // 'L0' | 'L1' | 'L2' | 'UNKNOWN'
      }
      sessionStateMap.set(session, state)
    }
    return state
  }

  // 1. 拦截与转换消息中的全量 AGENTS.md 注入
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision

    const agent = payload?.agent
    const session = agent?.session
    const state = session ? getSessionState(session) : undefined

    if (!session || !state) return decision

    const filtered = []
    for (const message of decision.messages) {
      // 检测来自 agent-instructions 的全量注入
      if (message?.source?.kind === 'agent-instructions') {
        if (!state.hinted) {
          const paths = extractInstructionPaths(message)
          if (paths.length > 0) {
            state.hinted = true
            filtered.push(buildInstructionHint(message, paths))
            continue
          }
        } else {
          // 已经给过 Hint，后续全量重复直接省略
          continue
        }
      }
      filtered.push(message)
    }

    // 检查最近助手消息，识别定级标记
    for (let i = filtered.length - 1; i >= 0; i--) {
      const msg = filtered[i]
      if (msg?.role === 'assistant') {
        const text = Array.isArray(msg.content)
          ? msg.content.map(c => c?.text || '').join('\n')
          : (typeof msg.content === 'string' ? msg.content : '')
        if (text.includes('Level: L0') || text.includes('【定级】Level: L0')) {
          state.currentLevel = 'L0'
          break
        } else if (text.includes('Level: L1') || text.includes('【定级】Level: L1')) {
          state.currentLevel = 'L1'
          break
        } else if (text.includes('Level: L2') || text.includes('【定级】Level: L2')) {
          state.currentLevel = 'L2'
          break
        }
      }
    }

    return { ...decision, messages: filtered }
  }, { prepend: true })

  // 2. 技能门控：在 system-prompt/assemble 阶段根据定级状态动态调整可用技能列表
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const session = context?.agent?.session
    const state = session ? getSessionState(session) : undefined

    // 仅在明确处于 L0 或 L1 状态时过滤掉 sdd 技能
    if (state && (state.currentLevel === 'L0' || state.currentLevel === 'L1')) {
      if (Array.isArray(assembled.sections)) {
        // 过滤 prompt 中的技能目录 section (若存在)
        assembled.sections = assembled.sections.map(section => {
          if (section?.name === 'skills:catalog' && typeof section?.text === 'string') {
            const filteredLines = section.text
              .split('\n')
              .filter(line => !line.includes(SDD_SKILL_PREFIX))
              .join('\n')
            return { ...section, text: filteredLines }
          }
          return section
        })
      }
    }

    return assembled
  })

  // 3. 状态恢复 (Session Compaction)
  ctx.on('session/event', (session, event) => {
    if (event?.type === 'compaction/end') {
      const state = sessionStateMap.get(session)
      if (state) {
        state.hinted = false
      }
    }
  })
}
