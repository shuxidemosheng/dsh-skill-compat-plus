/**
 * SkillProvider 实现：list()（发现）与 get()（按需加载）。
 *
 * 生命周期：
 * - attach(control) 由插件 apply() 在 registerProvider 工厂里调用；
 * - list() 每次 collect 都会重扫（registry 按 revision 缓存结果，重扫频率
 *   由失效事件决定，不在本层控制）；
 * - 项目根依赖 list(options).cwd（dsh 按会话工作区传入）；
 * - 文件变化由 watch 层调用 control.invalidate() 触发重扫。
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
} from '@deepseek-ai/dsh-skill'
import { splitFrontmatter, mapForeignSkill, readCodexOpenAiPolicy } from './frontmatter.js'
import { resolveRoots } from './roots.js'
import { entryNameFor, scanRoot } from './scan.js'
import { CompatWatchController } from './watch.js'
import type { CompatLocator, Logger, MappedSkill, ResolvedConfig, RootSpec } from './types.js'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class CompatSkillProvider implements SkillProvider {
  readonly name: string

  private control: SkillProviderControl | undefined
  private watcher: CompatWatchController | undefined
  private lastIssueSignature = ''
  private disposed = false

  constructor(
    private readonly config: ResolvedConfig,
    private readonly logger: Logger,
  ) {
    this.name = config.providerName
  }

  /** 由 registerProvider 工厂调用；只能成功一次。 */
  attach(control: SkillProviderControl): void {
    if (this.control !== undefined) return
    this.control = control
    if (this.config.watch) {
      this.watcher = new CompatWatchController({
        invalidate: () => {
          if (!this.disposed) this.control?.invalidate()
        },
        logger: this.logger,
        usePolling: this.config.watchUsePolling,
        stabilityThresholdMs: this.config.watchStabilityThresholdMs,
        pollIntervalMs: this.config.watchPollIntervalMs,
        maxProjects: this.config.watchMaxProjects,
      })
    }
  }

  async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[]> {
    options.signal?.throwIfAborted()
    if (this.disposed) return []

    const roots = await resolveRoots(this.config, options.cwd)
    const results = await Promise.all(
      roots.map(async (root): Promise<{ root: RootSpec; skills: MappedSkill[]; issues: string[] }> => {
        try {
          const result = await scanRoot(root, {
            slugify: this.config.slugifyNames,
            synthesize: this.config.synthesizeDescription,
          })
          return { root, skills: [...result.skills], issues: [...result.issues] }
        } catch (error) {
          // scanRoot 内部已兜底；这里防御意外错误，单个 root 失败不拖垮整体。
          return { root, skills: [], issues: [`${root.source}(${root.path}): scan failed: ${errorMessage(error)}`] }
        }
      }),
    )

    const candidates: SkillCandidate[] = []
    const issues: string[] = []
    for (const result of results) {
      for (const issue of result.issues) {
        issues.push(`${result.root.source}(${result.root.path}): ${issue}`)
      }
      for (const skill of result.skills) {
        candidates.push(this.toCandidate(skill, result.root))
      }
    }

    // 诊断聚合：只在问题集合变化时输出，避免每次 catalog 重建刷屏。
    const signature = issues.join('\n')
    if (signature !== this.lastIssueSignature) {
      for (const issue of issues) this.logger.warn(issue)
      this.lastIssueSignature = signature
    }

    this.watcher?.observe(roots.map((root) => ({ path: root.path, kind: root.kind })))
    return candidates
  }

  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    options.signal?.throwIfAborted()
    if (this.disposed) return undefined

    const locator = candidate.locator as CompatLocator
    if (typeof locator?.path !== 'string' || typeof locator?.directory !== 'string') return undefined

    let raw: string
    try {
      raw = await readFile(locator.path, { encoding: 'utf8', signal: options.signal })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }

    // get 语义 = 读取当前文件（官方哲学：catalog 与 body 生命周期分离）。
    // 重映射必须复现 scan 时的 name，否则 registry 判定 stale 并失效缓存。
    const parsed = splitFrontmatter(raw)
    if (parsed === undefined) return undefined
    const allowImplicit =
      basename(locator.path) === 'SKILL.md' ? await readCodexOpenAiPolicy(locator.directory) : undefined
    const mapped = mapForeignSkill({
      filePath: locator.path,
      directory: locator.directory,
      entryName: entryNameFor(locator.directory, locator.path),
      parsed,
      slugify: this.config.slugifyNames,
      synthesize: this.config.synthesizeDescription,
      allowImplicitInvocation: allowImplicit,
    })
    if (!mapped.ok || mapped.skill.name !== candidate.name) return undefined

    const skill = mapped.skill
    return {
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      invocation: skill.invocation,
      source: candidate.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: skill.directory },
      path: skill.path,
      metadata: skill.metadata,
      content: skill.content,
    }
  }

  private toCandidate(skill: MappedSkill, root: RootSpec): SkillCandidate {
    return {
      name: skill.name,
      description: skill.description,
      whenToUse: skill.whenToUse,
      invocation: skill.invocation,
      source: root.source,
      provider: this.name,
      resourceBase: { kind: 'directory', path: skill.directory },
      path: skill.path,
      metadata: skill.metadata,
      rank: root.rank,
      locator: { path: skill.path, directory: skill.directory },
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.watcher?.dispose()
  }
}
