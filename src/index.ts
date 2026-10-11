/**
 * dsh-skill-compat-plus —— 把 Claude Code / Codex / ZCode 的技能目录作为
 * 只读 SkillProvider 挂载进 DeepSeek Harness。
 *
 * 纪律（与官方 postmortem 0001 / 既有插件一致）：
 * - 绝不 export default（Loader 的 unwrapExports 会折叠模块并丢掉 inject）；
 * - apply() 内同步调用 registerProvider；
 * - 任何激活期失败都降级为 warn + return（entry 激活失败会让会话创建失败，
 *   输家必须优雅退出）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig } from './config.js'
import { CompatSkillProvider } from './provider.js'
import type { ConfigInput } from './types.js'

export const name = 'skill-compat-plus'

/** 宿主服务依赖：技能注册表（ctx.skills）。 */
export const inject = ['skills'] as const

export function apply(ctx: Context, config: ConfigInput | undefined): void {
  let resolved
  try {
    resolved = resolveConfig(config)
  } catch (error) {
    ctx.logger.warn(`skill-compat-plus disabled: invalid config: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  if (!resolved.anySourceEnabled) {
    ctx.logger.warn('skill-compat-plus disabled: every source is turned off and extraDirs is empty')
    return
  }

  const provider = new CompatSkillProvider(resolved, ctx.logger)

  try {
    ctx.skills.registerProvider((control) => {
      provider.attach(control)
      return provider
    })
  } catch (error) {
    // 典型场景：同名 provider 已注册（重复安装/同 profile 双挂载）。
    ctx.logger.warn(
      `skill-compat-plus not registered: ${error instanceof Error ? error.message : String(error)}`,
    )
    return
  }

  // fiber 销毁时关闭 watcher 与 watchFile 轮询（对齐 acl-skill 的清理模式）。
  ctx.effect(function* () {
    yield async () => {
      await provider.dispose()
    }
  }, 'skill-compat-plus watch lifecycle')
}
