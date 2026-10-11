/**
 * 外来 frontmatter → dsh 技能字段映射。
 *
 * 三家生态的格式差异（调研结论，字段细节见 README 映射表）：
 * - Claude Code：全部字段可选，name 缺省取目录名；`when_to_use`（snake_case）；
 *   可能出现 `allowed-tools`/`model`/`hooks` 等 dsh 无对应物的字段。
 * - Codex / Agent Skills 规范：name+description 必填；可选 agents/openai.yaml
 *   的 policy.allow_implicit_invocation=false 表示"只能显式调用"。
 * - ZCode：name 缺省取目录名；`when_to_use`（snake_case）。
 * - dsh：name/description 必填且 name 必须是 kebab-case
 *   （/^[a-z0-9]+(?:-[a-z0-9]+)*$/），invocation 双布尔必给。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { MappedSkill } from './types.js'

/**
 * dsh 技能名的公共文法。刻意本地复制官方 @deepseek-ai/dsh-skill 内部常量
 * SKILL_NAME 而不运行时引入该包：避免把注册表闭包（schemastery 等）打进
 * 构建产物。一致性由 tests/frontmatter.spec.ts 的对拍用例保证——上游若
 * 修改文法，该测试会失败提醒同步。
 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isSkillName(name: string): boolean {
  return SKILL_NAME.test(name)
}

export interface ParsedFrontmatter {
  data: Record<string, unknown>
  body: string
}

/**
 * 切分并解析 frontmatter。边界判定逐行扫描（首行必须是独立的 ---，
 * 兼容 \r），与官方 skill-filesystem 同构；YAML 本体交给官方同款 yaml 包，
 * 因此块标量（>- / |）与嵌套 map 都能正确解析。
 */
export function splitFrontmatter(raw: string): ParsedFrontmatter | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      const yamlText = raw.slice(start, lineStart)
      let parsed: unknown
      try {
        parsed = parseYaml(yamlText)
      } catch {
        return undefined
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
      return { data: parsed as Record<string, unknown>, body: raw.slice(nextNewline < 0 ? raw.length : nextNewline + 1) }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

/** dsh 禁止的 legacy camelCase 调用字段（官方解析器会直接 throw，这里同样拒绝）。 */
const LEGACY_INVOCATION_KEYS = ['disableModelInvocation', 'modelInvocable', 'userInvocable'] as const

/**
 * 宽松布尔解析（对齐官方 parseInvocationPolicy：1/0、"true/false/yes/no/on/off"）。
 * 返回 undefined 表示不是合法布尔。
 */
export function lenientBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return undefined
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', 'yes', 'on', '1'].includes(normalized)) return true
    if (['false', 'no', 'off', '0'].includes(normalized)) return false
  }
  return undefined
}

/**
 * 把外来名转换成 dsh kebab-case：小写、非 [a-z0-9] 的连续字符折叠成单 '-'、
 * 去首尾 '-'。数字开头合法（dsh 正则允许 "4drawio"）。
 */
export function slugifySkillName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function firstMeaningfulText(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.replace(/^\s*#+\s*/, '').trim()
    if (stripped.length > 0) return stripped
  }
  return ''
}

/** 从正文合成 description：取首个非空行，压缩空白后截到 ~200 字符。 */
export function synthesizeDescription(body: string): string {
  const text = firstMeaningfulText(body)
  if (text.length <= 200) return text
  const slice = text.slice(0, 200)
  const lastSpace = slice.lastIndexOf(' ')
  return (lastSpace >= 160 ? slice.slice(0, lastSpace) : slice) + '…'
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export interface MapForeignSkillInput {
  /** SKILL.md 或扁平 .md 的绝对路径。 */
  filePath: string
  /** resource base（目录 bundle 的目录或扁平文件所在根）。 */
  directory: string
  /** 目录名（目录 bundle）或去扩展名的文件名（扁平）。 */
  entryName: string
  parsed: ParsedFrontmatter
  slugify: boolean
  synthesize: boolean
  /** Codex agents/openai.yaml 解析结果（可选文件，缺省视为允许隐式调用）。 */
  allowImplicitInvocation?: boolean
}

export type MapForeignSkillResult =
  | { readonly ok: true; readonly skill: MappedSkill }
  | { readonly ok: false; readonly reason: string }

/**
 * 把一份已切分的外来 SKILL.md 映射成 dsh 技能字段。
 * 失败返回人读 reason（由上层聚合成 warn），绝不 throw。
 */
export function mapForeignSkill(input: MapForeignSkillInput): MapForeignSkillResult {
  const { parsed, filePath } = input
  const data = parsed.data

  for (const key of LEGACY_INVOCATION_KEYS) {
    if (key in data) {
      return {
        ok: false,
        reason: `frontmatter field "${key}" is unsupported; use "disable-model-invocation"`,
      }
    }
  }

  // name：frontmatter 优先，缺省回退目录名（Claude/ZCode 语义）。
  const rawName = stringField(data, 'name') ?? input.entryName
  let name = rawName
  if (!isSkillName(name)) {
    if (!input.slugify) {
      return { ok: false, reason: `invalid skill name "${rawName}" and slugifyNames is disabled` }
    }
    const slug = slugifySkillName(rawName)
    if (!isSkillName(slug)) {
      return { ok: false, reason: `invalid skill name "${rawName}" cannot be converted to a dsh kebab-case name` }
    }
    name = slug
  }

  // description：dsh 硬性必填；Claude 允许缺省 → 从正文合成。
  let description = stringField(data, 'description')
  if (description === undefined) {
    if (!input.synthesize) {
      return { ok: false, reason: 'frontmatter requires a description and synthesizeDescription is disabled' }
    }
    description = synthesizeDescription(parsed.body)
    if (description.length === 0) {
      return { ok: false, reason: 'frontmatter requires a description and the body is empty' }
    }
  }

  const whenToUse = stringField(data, 'whenToUse') ?? stringField(data, 'when_to_use')

  const disableModelInvocation = lenientBoolean(data['disable-model-invocation'])
  if (data['disable-model-invocation'] !== undefined && disableModelInvocation === undefined) {
    return { ok: false, reason: 'frontmatter field "disable-model-invocation" must be a boolean' }
  }
  const userInvocableRaw = data['user-invocable']
  let userInvocable = true
  if (userInvocableRaw !== undefined) {
    const parsed = lenientBoolean(userInvocableRaw)
    if (parsed === undefined) {
      return { ok: false, reason: 'frontmatter field "user-invocable" must be a boolean' }
    }
    userInvocable = parsed
  }
  const modelInvocable = disableModelInvocation !== true && input.allowImplicitInvocation !== false

  return {
    ok: true,
    skill: {
      name,
      description,
      whenToUse,
      invocation: { modelInvocable, userInvocable },
      // 原始 frontmatter 全量保真：allowed-tools/model/hooks 等字段在 dsh
      // 没有对应物，保留在 metadata 里可追溯，不做静默丢弃。
      metadata: Object.freeze({ ...data }),
      path: filePath,
      directory: input.directory,
      content: parsed.body.trim(),
    },
  }
}

/**
 * 读取 Codex 的 agents/openai.yaml（可选文件），提取
 * policy.allow_implicit_invocation。文件不存在或格式异常时返回 undefined
 * （可选文件解析失败不该拖垮整个技能）。
 */
export async function readCodexOpenAiPolicy(directory: string): Promise<boolean | undefined> {
  let raw: string
  try {
    raw = await readFile(join(directory, 'agents', 'openai.yaml'), { encoding: 'utf8' })
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const policy = (parsed as Record<string, unknown>)['policy']
  if (typeof policy !== 'object' || policy === null) return undefined
  return lenientBoolean((policy as Record<string, unknown>)['allow_implicit_invocation'])
}
