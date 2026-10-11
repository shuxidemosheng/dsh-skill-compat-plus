/**
 * 技能根目录解析：把配置展开成一组待扫描的 RootSpec。
 *
 * rank 约定（越小越优先，与 dsh 官方 skill-filesystem 对齐）：
 *   project-dsh 100 < project-agents 200 < [本项目 210/220/300] <
 *   user-dsh 400 < [本项目 450/460/470] < user-agents 500 < bundled 600
 *
 * 即：dsh 原生技能永远压过同名的导入技能；项目级导入压过用户级导入；
 * ~/.agents/skills 不在本插件范围内（dsh 原生已扫该目录）。
 */
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { ResolvedConfig, RootSpec } from './types.js'

export const DEFAULT_RANKS = {
  claudeProject: 210,
  zcodeProject: 220,
  extra: 300,
  claudeUser: 450,
  codexUser: 460,
  zcodeUser: 470,
} as const

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // 向上逐级查找时缺失的目录是预期情况。
    return false
  }
}

/**
 * 从 cwd 向上找最近的 .git 祖先作为项目根；找不到时回退 cwd 本身。
 * 语义对齐官方 skill-filesystem 的 findProjectRoot。
 */
export async function findProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    if (await pathExists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/**
 * 展开全部根目录并按 rank 升序（同 rank 按路径字典序，保证 localOrder 确定）。
 * 同一路径只保留首次出现（rank 最高者）。
 */
export async function resolveRoots(config: ResolvedConfig, cwd: string | undefined): Promise<RootSpec[]> {
  const roots: RootSpec[] = []
  const home = homedir()

  if (cwd !== undefined) {
    const projectRoot = await findProjectRoot(cwd)
    if (config.sources.claude.enabled && config.sources.claude.project) {
      roots.push({
        path: join(projectRoot, '.claude', 'skills'),
        source: 'claude-code',
        rank: DEFAULT_RANKS.claudeProject,
        kind: 'project',
      })
    }
    if (config.sources.zcode.enabled && config.sources.zcode.project) {
      roots.push({
        path: join(projectRoot, '.zcode', 'skills'),
        source: 'zcode',
        rank: DEFAULT_RANKS.zcodeProject,
        kind: 'project',
      })
    }
  }

  for (const dir of config.extraDirs) {
    roots.push({ path: resolve(dir.path), source: dir.label, rank: dir.rank, kind: 'extra' })
  }

  const claude = config.sources.claude
  if (claude.enabled) {
    roots.push({
      path: resolve(claude.root ?? join(home, '.claude', 'skills')),
      source: 'claude-code',
      rank: claude.rank ?? DEFAULT_RANKS.claudeUser,
      kind: 'user',
    })
  }
  const codex = config.sources.codex
  if (codex.enabled) {
    roots.push({
      path: resolve(codex.root ?? join(home, '.codex', 'skills')),
      source: 'codex',
      rank: codex.rank ?? DEFAULT_RANKS.codexUser,
      kind: 'user',
    })
  }
  const zcode = config.sources.zcode
  if (zcode.enabled) {
    roots.push({
      path: resolve(zcode.root ?? join(home, '.zcode', 'skills')),
      source: 'zcode',
      rank: zcode.rank ?? DEFAULT_RANKS.zcodeUser,
      kind: 'user',
    })
  }

  roots.sort((left, right) => left.rank - right.rank || left.path.localeCompare(right.path))

  const seen = new Set<string>()
  const unique: RootSpec[] = []
  for (const root of roots) {
    if (seen.has(root.path)) continue
    seen.add(root.path)
    unique.push(root)
  }
  return unique
}
