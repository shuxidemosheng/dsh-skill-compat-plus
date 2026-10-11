/**
 * 共享类型定义。
 *
 * 刻意不依赖 cordis：除 index.ts 外的模块只依赖本文件的最小接口
 * （如 Logger），让扫描/映射逻辑可以在 vitest 里脱离宿主直接测试。
 */

/** 宿主 logger 的最小结构（cordis Context.logger 满足该接口）。 */
export interface Logger {
  warn(message: string): void
}

/**
 * 单个外部来源的精细配置。`true`/`false` 简写等价于只改 `enabled`。
 */
export interface SourceOverride {
  enabled?: boolean
  /** 是否扫描项目级目录（<projectRoot>/.claude/skills 等），默认 true。 */
  project?: boolean
  /** 覆盖该来源的用户级目录。 */
  root?: string
  /** 覆盖该来源用户级 rank。 */
  rank?: number
}

/** 来源开关：boolean 简写或精细对象。 */
export type SourceOption = boolean | SourceOverride

/** extraDirs 的一项：任意路径的额外技能目录。 */
export interface ExtraDirInput {
  path: string
  /** catalog 里展示的 source 标签，默认 'custom'。 */
  label?: string
  /** rank 默认 300（与官方 custom 同档）。 */
  rank?: number
}

/** cordis.patch.yml config 传入的原始形状（校验前）。 */
export interface ConfigInput {
  providerName?: unknown
  sources?: {
    claude?: SourceOption
    codex?: SourceOption
    zcode?: SourceOption
  }
  extraDirs?: unknown
  watch?: unknown
  watchUsePolling?: unknown
  watchStabilityThresholdMs?: unknown
  watchPollIntervalMs?: unknown
  watchMaxProjects?: unknown
  slugifyNames?: unknown
  synthesizeDescription?: unknown
}

/** 单个来源解析后的设置。 */
export interface SourceSettings {
  enabled: boolean
  project: boolean
  /** 用户级目录覆盖；undefined 用默认路径。 */
  root?: string
  /** 用户级 rank 覆盖。 */
  rank?: number
}

/** 校验完成、可直接使用的配置。 */
export interface ResolvedConfig {
  providerName: string
  sources: {
    claude: SourceSettings
    codex: SourceSettings
    zcode: SourceSettings
  }
  extraDirs: readonly ResolvedExtraDir[]
  watch: boolean
  watchUsePolling: boolean
  watchStabilityThresholdMs: number
  watchPollIntervalMs: number
  watchMaxProjects: number
  slugifyNames: boolean
  synthesizeDescription: boolean
  /** 全部来源都被关闭且无 extraDirs 时为 false，此时插件不注册 provider。 */
  anySourceEnabled: boolean
}

export interface ResolvedExtraDir {
  path: string
  label: string
  rank: number
}

/**
 * 一个待扫描的技能根目录。`source` 是 catalog 里 prompt 可见的来源标签，
 * `rank` 参与同名技能裁决（越小越优先）。
 */
export interface RootSpec {
  readonly path: string
  readonly source: string
  readonly rank: number
  readonly kind: 'user' | 'project' | 'extra'
}

/** opaque locator：list() 放进 candidate、get() 原样收回。 */
export interface CompatLocator {
  readonly path: string
  readonly directory: string
}

/** 映射成功后的外来技能（扫描与 get 共用）。 */
export interface MappedSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
  /** 原始 frontmatter 全量保真（含 dsh 无对应物的字段，如 allowed-tools/model）。 */
  readonly metadata: Readonly<Record<string, unknown>>
  /** SKILL.md / 扁平 .md 的绝对路径。 */
  readonly path: string
  /** resource base：目录 bundle 的目录本身，或扁平文件所在根。 */
  readonly directory: string
  /** 正文（闭合 --- 之后 trim）。 */
  readonly content: string
}

/** 单个 root 的扫描结果。 */
export interface RootScanResult {
  readonly root: RootSpec
  readonly skills: readonly MappedSkill[]
  /** 目录不存在（静默跳过，不算问题）。 */
  readonly absent: boolean
  /** 人读诊断（每条已带 root 前缀）。 */
  readonly issues: readonly string[]
}
