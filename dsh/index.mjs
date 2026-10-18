/**
 * dsh/index.mjs — Open Spec Mesh DSH 插件入口
 */

import { apply as gatekeeperApply, name as gatekeeperName } from './gatekeeper.mjs'

export const name = 'open-spec-mesh-dsh'

export function apply(ctx, config) {
  // 挂载动态门控逻辑
  gatekeeperApply(ctx, config)
}
