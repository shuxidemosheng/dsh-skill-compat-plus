import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config'
import { findProjectRoot, resolveRoots } from '../src/roots'
import { cleanupTempDirs, tempDir } from './helpers'

afterEach(cleanupTempDirs)

describe('findProjectRoot', () => {
  it('walks up to the nearest .git ancestor', async () => {
    const project = await tempDir('proj')
    await mkdir(join(project, '.git'), { recursive: true })
    const nested = join(project, 'a', 'b')
    await mkdir(nested, { recursive: true })
    expect(await findProjectRoot(nested)).toBe(project)
  })

  it('falls back to cwd itself when no .git exists (official semantics)', async () => {
    const plain = await tempDir('plain')
    expect(await findProjectRoot(plain)).toBe(plain)
  })
})

describe('resolveRoots', () => {
  it('expands project-level and user-level roots for all three sources, ordered by rank', async () => {
    const project = await tempDir('proj')
    await mkdir(join(project, '.git'), { recursive: true })
    const config = resolveConfig({ sources: { claude: true, codex: true, zcode: true } })
    const roots = await resolveRoots(config, project)
    expect(roots.map((root) => root.rank)).toEqual([210, 220, 450, 460, 470])
    expect(roots.map((root) => root.kind)).toEqual(['project', 'project', 'user', 'user', 'user'])
    expect(roots[0].path).toBe(join(project, '.claude', 'skills'))
    expect(roots[1].path).toBe(join(project, '.zcode', 'skills'))
    expect(roots[2].source).toBe('claude-code')
    expect(roots[3].path).toBe(join(homedir(), '.codex', 'skills'))
    expect(roots[4].source).toBe('zcode')
  })

  it('omits project roots when the source disables them or cwd is undefined', async () => {
    const project = await tempDir('proj')
    await mkdir(join(project, '.git'), { recursive: true })
    const config = resolveConfig({
      sources: { claude: { project: false }, codex: false, zcode: false },
    })
    const roots = await resolveRoots(config, project)
    expect(roots.map((root) => root.kind)).toEqual(['user'])
    expect(await resolveRoots(config, undefined)).toEqual(roots)
  })

  it('honors source root and rank overrides plus extraDirs, and dedupes by path', async () => {
    const project = await tempDir('proj')
    await mkdir(join(project, '.git'), { recursive: true })
    const customDir = await tempDir('custom')
    const config = resolveConfig({
      sources: {
        claude: { root: customDir, rank: 310 },
        codex: false,
      },
      extraDirs: [
        { path: customDir, label: 'my-pack', rank: 150 },
        { path: join(project, 'extra'), label: 'extra' },
      ],
    })
    const roots = await resolveRoots(config, project)
    // customDir 同时出现在 extraDirs(rank 150) 与 claude 用户级(rank 310) —— 只保留 rank 最高者；
    // claude 因此不贡献任何根。
    expect(roots.map((root) => [root.rank, root.source])).toEqual([
      [150, 'my-pack'],
      [210, 'claude-code'],
      [220, 'zcode'],
      [300, 'extra'],
      [470, 'zcode'],
    ])
  })
})
