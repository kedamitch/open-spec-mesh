/**
 * dsh/index.mjs — Open Spec Mesh DSH 插件入口
 *
 * preset 行按 profile 目录解析这个子路径，所以这里必须原样转发 gatekeeper 的插件元数据：
 * cordis 用 plugin.inject 决定服务是否可见（cordis/lib/index.js:1635
 * `new Fiber(ctx, config, Inject.resolve(plugin.inject), ...)`），漏掉 inject 会让 apply 里的
 * ctx.systemPrompt 变成 `cannot get property "systemPrompt" without inject`。
 */

export { apply, inject, name } from './gatekeeper.mjs'
