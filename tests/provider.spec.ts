import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config'
import { CompatSkillProvider } from '../src/provider'
import type { CompatLocator } from '../src/types'
import { cleanupTempDirs, createTestLogger, tempDir, writeDirSkill } from './helpers'

afterEach(cleanupTempDirs)

/** 构造一个把三家用户级根都指到隔离目录的 provider（避免扫到真实用户目录）。 */
async function setupProvider(options: {
  claudeRoot?: string
  codexRoot?: string
  zcodeRoot?: string
  extraDirs?: { path: string; label?: string; rank?: number }[]
  logger?: ReturnType<typeof createTestLogger>
}) {
  const empty = await tempDir('empty')
  const config = resolveConfig({
    sources: {
      claude: { root: options.claudeRoot ?? join(empty, 'claude') },
      codex: { root: options.codexRoot ?? join(empty, 'codex') },
      zcode: { root: options.zcodeRoot ?? join(empty, 'zcode') },
    },
    extraDirs: options.extraDirs ?? [],
    watch: false,
  })
  const logger = options.logger ?? createTestLogger()
  const provider = new CompatSkillProvider(config, logger)
  const invalidate = vi.fn()
  provider.attach({ invalidate, signal: new AbortController().signal })
  return { provider, logger, invalidate, config }
}

describe('CompatSkillProvider.list', () => {
  it('merges sources with per-root rank and source labels; locator roundtrips', async () => {
    const project = await tempDir('proj')
    await mkdir(join(project, '.git'), { recursive: true })
    const claudeDir = join(project, '.claude', 'skills')
    await writeDirSkill(claudeDir, 'drawio', 'description: Draw diagrams')
    const extra = await tempDir('extra')
    await writeDirSkill(extra, 'packed', 'name: packed\ndescription: From extra dir')

    const { provider } = await setupProvider({
      extraDirs: [{ path: extra, label: 'my-pack', rank: 150 }],
    })
    const candidates = await provider.list({ cwd: project })
    // rank 升序：my-pack(150) → claude-code 项目级(210)
    expect(candidates.map((candidate) => [candidate.rank, candidate.source, candidate.name])).toEqual([
      [150, 'my-pack', 'packed'],
      [210, 'claude-code', 'drawio'],
    ])
    const first = candidates[0]
    expect(first.provider).toBe('skill-compat-plus')
    expect(first.resourceBase).toEqual({ kind: 'directory', path: join(extra, 'packed') })
    const locator = first.locator as CompatLocator
    expect(locator.path.toLowerCase().endsWith('skill.md')).toBe(true)
  })

  it('emits diagnostics once per issue signature and stays silent on unchanged rescans', async () => {
    const project = await tempDir('proj2')
    await mkdir(join(project, '.git'), { recursive: true })
    const claudeDir = join(project, '.claude', 'skills')
    await mkdir(claudeDir, { recursive: true })
    await writeFile(join(claudeDir, 'broken.md'), 'no frontmatter', 'utf8')
    await writeDirSkill(claudeDir, 'good', 'description: good skill')

    const logger = createTestLogger()
    const { provider } = await setupProvider({ logger })
    await provider.list({ cwd: project })
    const firstRun = logger.warnings.length
    expect(firstRun).toBe(1)
    expect(logger.warnings[0]).toContain('broken.md')

    await provider.list({ cwd: project })
    expect(logger.warnings.length).toBe(firstRun)

    await writeFile(join(claudeDir, 'broken.md'), '---\nname: fixed\ndescription: now valid\n---\nBody\n', 'utf8')
    const candidates = await provider.list({ cwd: project })
    // 问题集合变为空：空 diff 不输出任何 warn，但签名已更新
    expect(logger.warnings.length).toBe(firstRun)
    expect(candidates.map((candidate) => candidate.name).sort()).toEqual(['fixed', 'good'])
  })

  it('returns no candidates after dispose', async () => {
    const project = await tempDir('proj3')
    await mkdir(join(project, '.git'), { recursive: true })
    await writeDirSkill(join(project, '.claude', 'skills'), 'demo', 'description: demo')
    const { provider } = await setupProvider({})
    expect((await provider.list({ cwd: project })).length).toBe(1)
    await provider.dispose()
    expect(await provider.list({ cwd: project })).toEqual([])
  })
})

describe('CompatSkillProvider.get', () => {
  it('loads the current body and reproduces the scanned candidate fields', async () => {
    const project = await tempDir('proj4')
    await mkdir(join(project, '.git'), { recursive: true })
    const claudeDir = join(project, '.claude', 'skills')
    const dir = await writeDirSkill(claudeDir, 'drawio', 'description: Draw diagrams\nwhen_to_use: On demand', 'Instructions here.')

    const { provider } = await setupProvider({})
    const candidates = await provider.list({ cwd: project })
    expect(candidates.length).toBe(1)
    const definition = await provider.get(candidates[0], { cwd: project })
    expect(definition).toBeDefined()
    expect(definition!.name).toBe('drawio')
    expect(definition!.content).toBe('Instructions here.')
    expect(definition!.whenToUse).toBe('On demand')
    expect(definition!.path).toBe(join(dir, 'SKILL.md'))
    expect(definition!.resourceBase).toEqual({ kind: 'directory', path: dir })
  })

  it('returns undefined when the file disappeared or its name no longer matches', async () => {
    const project = await tempDir('proj5')
    await mkdir(join(project, '.git'), { recursive: true })
    const claudeDir = join(project, '.claude', 'skills')
    await writeDirSkill(claudeDir, 'demo', 'description: demo')
    const { provider } = await setupProvider({})
    const [candidate] = await provider.list({ cwd: project })

    await writeFile(
      (candidate.locator as CompatLocator).path,
      '---\nname: renamed\ndescription: moved on\n---\nBody\n',
      'utf8',
    )
    expect(await provider.get(candidate, { cwd: project })).toBeUndefined()

    const { rm } = await import('node:fs/promises')
    await rm((candidate.locator as CompatLocator).path)
    expect(await provider.get(candidate, { cwd: project })).toBeUndefined()
  })
})
