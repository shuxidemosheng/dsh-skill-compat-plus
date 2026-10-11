/**
 * 单个根目录的 depth-1 扫描：目录 bundle <name>/SKILL.md 为主，
 * 同时支持扁平 <name>.md（extraDirs 指向 dsh 风格目录时可用）。
 *
 * 错误哲学对齐官方 skill-filesystem：单文件坏不拖垮整个 root（skip + 诊断），
 * 目录不存在是静默正常态（absent），其余意外错误上抛交给 provider 兜底。
 */
import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  mapForeignSkill,
  readCodexOpenAiPolicy,
  splitFrontmatter,
} from './frontmatter.js'
import type { MappedSkill, RootScanResult, RootSpec } from './types.js'

/** Claude Code 官方保留的技能目录名（同步/官方托管技能，不属于用户资产）。 */
const CLAUDE_RESERVED_ENTRY = /^(synced|anthropic-skills)/

interface ScanOptions {
  readonly slugify: boolean
  readonly synthesize: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readSkillText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, { encoding: 'utf8' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function scanRoot(root: RootSpec, options: ScanOptions): Promise<RootScanResult> {
  let dirents
  try {
    dirents = await readdir(root.path, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      // 目录不存在是预期状态（来源装了但还没建目录）。
      return { root, skills: [], absent: true, issues: [] }
    }
    return { root, skills: [], absent: false, issues: [`${root.source}(${root.path}): failed to list directory: ${errorMessage(error)}`] }
  }

  const entries = [...dirents].sort((left, right) => left.name.localeCompare(right.name))
  const skills: MappedSkill[] = []
  const issues: string[] = []
  const seen = new Map<string, string>()

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (root.source === 'claude-code' && CLAUDE_RESERVED_ENTRY.test(entry.name)) continue

    const isDirectory = entry.isDirectory()
    const isFlatSkill = entry.isFile() && entry.name.endsWith('.md')
    if (!isDirectory && !isFlatSkill) continue

    const entryPath = isDirectory ? join(root.path, entry.name, 'SKILL.md') : join(root.path, entry.name)
    const entryName = isDirectory ? entry.name : entry.name.slice(0, -3)
    const directory = isDirectory ? join(root.path, entry.name) : root.path

    let raw: string | undefined
    try {
      raw = await readSkillText(entryPath)
    } catch (error) {
      issues.push(`${root.source}(${root.path}): failed to read ${entryPath}: ${errorMessage(error)}`)
      continue
    }
    if (raw === undefined) continue // 目录里没有 SKILL.md —— 不是技能，静默跳过

    const parsed = splitFrontmatter(raw)
    if (parsed === undefined) {
      issues.push(`${entryPath} ignored: invalid or missing YAML frontmatter`)
      continue
    }

    // Codex 特有：agents/openai.yaml 的 policy.allow_implicit_invocation。
    const allowImplicit = isDirectory ? await readCodexOpenAiPolicy(directory) : undefined

    const mapped = mapForeignSkill({
      filePath: entryPath,
      directory,
      entryName,
      parsed,
      slugify: options.slugify,
      synthesize: options.synthesize,
      allowImplicitInvocation: allowImplicit,
    })
    if (!mapped.ok) {
      issues.push(`${entryPath} ignored: ${mapped.reason}`)
      continue
    }

    // provider 内同名裁决：先到先得（entries 已按名排序，localOrder 确定）。
    const previous = seen.get(mapped.skill.name)
    if (previous !== undefined) {
      issues.push(
        `${entryPath} ignored: duplicate skill name "${mapped.skill.name}" (already provided by ${previous})`,
      )
      continue
    }
    seen.set(mapped.skill.name, entryPath)
    skills.push(mapped.skill)
  }

  return { root, skills, absent: false, issues }
}

/** 供 get() 使用的入口名推导：与 scan 的 entryName 规则严格一致。 */
export function entryNameFor(directory: string, path: string): string {
  return basename(path) === 'SKILL.md' ? basename(directory) : basename(path).replace(/\.md$/, '')
}
