import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  apply,
  buildInstructionHint,
  buildRoleRoutesSection,
  detectLevelFromSession,
  extractInstructionPaths,
  extractRemovedInstructionPaths,
  ROLE_ROUTES_SECTION,
} from '../../../dsh/gatekeeper.mjs'
import { DEFAULT_MODELS } from '../../../lib/installation/models-config.js'

// 断言只锁定行的格式与「默认值来自 DEFAULT_MODELS」，不锁定具体厂商/型号，
// 这样调整默认路由时不必连带改测试。
function routeRow(role, route) {
  return `| ${role} | ${route.provider} | ${route.model} | ${route.reasoningEffort} |`
}

function fakeContext() {
  const handlers = new Map()
  const sections = []
  return {
    handlers,
    sections,
    on(event, handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
    },
  }
}

// surface.nodes 是 getter：压缩测试要靠替换 events 模拟历史被摘要掉
function fakeSession(events = []) {
  const session = {
    events,
    eventAt(seq) { return session.events[seq] },
    surface: { get nodes() { return session.events.map((_, index) => index) } },
  }
  return session
}

function assistantEvent(text) {
  return {
    type: 'assistant/message',
    data: { message: { role: 'assistant', content: [{ type: 'text', text }] } },
  }
}

function instructionMessage(text, overrides = {}) {
  return {
    id: 'instr-1',
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'agent-instructions', baseline: true, baselineIdentity: 'identity-1', changes: [] },
    ...overrides,
  }
}

function catalogMessage(names) {
  const entries = names.map(name => ({ name, description: `说明 ${name}` }))
  return {
    id: 'catalog-1',
    role: 'user',
    content: [{
      type: 'text',
      text: [
        '<system-reminder>',
        'A skill is a reusable set of task-specific instructions. The following skills are available in this session:',
        '',
        '<available_skills>',
        ...entries.map(entry => `- \`${entry.name}\`: ${entry.description}`),
        '</available_skills>',
        '',
        'If the user names a skill, or the task clearly matches a skill\'s description, call the `skill` tool with the exact skill name before taking task actions.',
        '</system-reminder>',
      ].join('\n'),
    }],
    source: { kind: 'skill-catalog', form: 'catalog', entries },
  }
}

function textOf(message) {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

async function runPreStep(ctx, session, messages) {
  const handler = ctx.handlers.get('agent/pre-step')[0]
  return handler({ agent: { session } }, async () => ({ kind: 'enter', messages }))
}

test('三类增量指令标签与基线标签都能解析出路径', () => {
  const message = instructionMessage([
    'Instructions from: /repo/AGENTS.md',
    '',
    'Additional instructions from: /repo/pkg/AGENTS.md',
    '',
    'Updated instructions from: /repo/docs/AGENTS.md',
    '',
    'Instructions removed: /repo/old/AGENTS.md',
  ].join('\n'))
  assert.deepEqual(extractInstructionPaths(message), [
    '/repo/AGENTS.md',
    '/repo/pkg/AGENTS.md',
    '/repo/docs/AGENTS.md',
  ])
  assert.deepEqual(extractRemovedInstructionPaths(message), ['/repo/old/AGENTS.md'])
})

test('hint 只替换 content，保留宿主对账需要的 source / id / role', () => {
  const original = instructionMessage('Instructions from: /repo/AGENTS.md\n\n# 工作约定')
  const hint = buildInstructionHint(original, ['/repo/AGENTS.md'], [])
  assert.equal(hint.id, original.id)
  assert.equal(hint.role, 'user')
  assert.deepEqual(hint.source, original.source)
  assert.equal(hint.source.baseline, true)
  assert.equal(hint.source.baselineIdentity, 'identity-1')
  assert.match(textOf(hint), /\/repo\/AGENTS\.md/)
  assert.doesNotMatch(textOf(hint), /# 工作约定/)
})

test('pre-step: 基线换一次 hint，随后不再重复，但文档失效仍留精简提示', async () => {
  const ctx = fakeContext()
  apply(ctx, {})
  const session = fakeSession([])

  const first = await runPreStep(ctx, session, [
    instructionMessage('Instructions from: /repo/AGENTS.md\n\n# 工作约定'),
  ])
  assert.equal(first.messages.length, 1)
  assert.deepEqual(first.messages[0].source, {
    kind: 'agent-instructions',
    baseline: true,
    baselineIdentity: 'identity-1',
    changes: [],
  })
  assert.match(textOf(first.messages[0]), /项目规范与架构文档参考/)

  const repeated = await runPreStep(ctx, session, [
    instructionMessage('Updated instructions from: /repo/docs/AGENTS.md\n\n# 新约定', { id: 'instr-updated' }),
  ])
  assert.equal(repeated.messages.length, 0)

  const removal = await runPreStep(ctx, session, [
    instructionMessage('Instructions removed: /repo/old/AGENTS.md', { id: 'instr-removed' }),
  ])
  assert.equal(removal.messages.length, 1)
  assert.match(textOf(removal.messages[0]), /不再生效/)
  assert.match(textOf(removal.messages[0]), /\/repo\/old\/AGENTS\.md/)
  assert.equal(removal.messages[0].source.baselineIdentity, 'identity-1')

  const removalAgain = await runPreStep(ctx, session, [
    instructionMessage('Instructions removed: /repo/old/AGENTS.md', { id: 'instr-removed-2' }),
  ])
  assert.equal(removalAgain.messages.length, 0)
})

test('detectLevelFromSession 只读 assistant/message，兼容 L1-Quick 写法', () => {
  const session = fakeSession([
    assistantEvent('【定级】Level: L0 | 判定依据: 单文件修补'),
    { type: 'user/message', data: { source: {}, message: { role: 'user', content: [{ type: 'text', text: 'Level: L2' }] } } },
  ])
  assert.equal(detectLevelFromSession(session), 'L0')
  assert.equal(detectLevelFromSession(fakeSession([assistantEvent('【定级】Level: L1-Quick | 判定依据: 2 个文件')])), 'L1')
  assert.equal(detectLevelFromSession(fakeSession([])), undefined)
})

test('等级来自 assistant 历史：L1 裁掉 sdd- 条目，L2 原样保留', async () => {
  const ctx = fakeContext()
  apply(ctx, {})
  const names = ['agent-browser', 'sdd-do', 'sdd-close', 'worktrees']

  const l1Session = fakeSession([assistantEvent('【定级】Level: L1 | 判定依据: 2 个文件')])
  const l1 = await runPreStep(ctx, l1Session, [catalogMessage(names)])
  const l1Text = textOf(l1.messages[0])
  assert.doesNotMatch(l1Text, /- `sdd-do`/)
  assert.doesNotMatch(l1Text, /- `sdd-close`/)
  assert.match(l1Text, /- `agent-browser`/)
  assert.match(l1Text, /- `worktrees`/)
  assert.match(l1Text, /<available_skills>/)
  // source.entries 是宿主的目录指纹，裁剪不能动它
  assert.equal(l1.messages[0].source.entries.length, names.length)

  const l2Session = fakeSession([assistantEvent('【定级】Level: L2 | 判定依据: 跨模块')])
  const l2 = await runPreStep(ctx, l2Session, [catalogMessage(names)])
  assert.equal(textOf(l2.messages[0]), textOf(catalogMessage(names)))
  assert.equal(l2.messages[0].source.entries.length, names.length)
})

test('compaction/end 同时重置等级与提示状态', async () => {
  const ctx = fakeContext()
  apply(ctx, {})
  const session = fakeSession([assistantEvent('【定级】Level: L1 | 判定依据: 2 个文件')])

  const gated = await runPreStep(ctx, session, [catalogMessage(['sdd-do', 'worktrees'])])
  assert.doesNotMatch(textOf(gated.messages[0]), /- `sdd-do`/)

  // 压缩把历史换成摘要：旧 assistant 事件不再可见
  session.events = [{ type: 'compaction/summary', data: {} }]
  ctx.handlers.get('session/event')[0](session, { type: 'compaction/end' })

  const ungated = await runPreStep(ctx, session, [catalogMessage(['sdd-do', 'worktrees'])])
  assert.match(textOf(ungated.messages[0]), /- `sdd-do`/)

  const rehinted = await runPreStep(ctx, session, [instructionMessage('Instructions from: /repo/AGENTS.md')])
  assert.equal(rehinted.messages.length, 1)
  assert.match(textOf(rehinted.messages[0]), /项目规范与架构文档参考/)
})

test('buildRoleRoutesSection 只渲染给定角色配置', () => {
  const text = buildRoleRoutesSection({ architect: { provider: 'acme', model: 'a-1', reasoningEffort: 'xhigh' } })
  assert.match(text, /\| architect \| acme \| a-1 \| xhigh \|/)
  assert.doesNotMatch(text, /worker/)
  assert.match(text, /`subagent`/)
})

test('角色路由表 section 跟随临时 HOME 下的 osm-models.json', (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'osm-gatekeeper-'))
  const previousHome = process.env.HOME
  const previousDshHome = process.env.DSH_HOME
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
    rmSync(home, { recursive: true, force: true })
  })
  mkdirSync(path.join(home, '.dsh'), { recursive: true })
  process.env.HOME = home
  delete process.env.DSH_HOME

  const ctx = fakeContext()
  apply(ctx, {})
  assert.equal(ctx.sections.length, 1)
  const section = ctx.sections[0]
  assert.equal(section.name, ROLE_ROUTES_SECTION)
  assert.equal(typeof section.text, 'function')

  const initial = section.text()
  assert.ok(initial.includes(routeRow('worker', DEFAULT_MODELS.worker)))

  writeFileSync(
    path.join(home, '.dsh', 'osm-models.json'),
    JSON.stringify({ worker: { provider: 'acme', model: 'w-1', reasoningEffort: 'max' } }),
  )
  const updated = section.text()
  assert.match(updated, /\| worker \| acme \| w-1 \| max \|/)
  assert.notEqual(updated, initial)
  // 未覆盖的角色继续沿用默认值
  assert.ok(updated.includes(routeRow('explorer', DEFAULT_MODELS.explorer)))
})
