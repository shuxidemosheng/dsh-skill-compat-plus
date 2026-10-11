import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanRoot } from '../src/scan'
import { cleanupTempDirs, tempDir, writeDirSkill, writeFlatSkill } from './helpers'

afterEach(cleanupTempDirs)

function rootSpec(path: string, source = 'claude-code', rank = 450) {
  return { path, source, rank, kind: 'user' as const }
}

describe('scanRoot', () => {
  it('discovers directory bundles and flat skills with mapped fields', async () => {
    const root = await tempDir('scan')
    await writeDirSkill(root, 'drawio', 'description: Draw diagrams\nwhen_to_use: On diagram requests', 'Use drawio.')
    await writeFlatSkill(root, 'flat-note', 'name: flat-note\ndescription: A flat skill')
    const result = await scanRoot(rootSpec(root), { slugify: true, synthesize: true })
    expect(result.absent).toBe(false)
    expect(result.issues).toEqual([])
    expect(result.skills.map((skill) => skill.name)).toEqual(['drawio', 'flat-note'])
    expect(result.skills[0].whenToUse).toBe('On diagram requests')
    expect(result.skills[0].directory).toBe(join(root, 'drawio'))
    expect(result.skills[1].directory).toBe(root)
  })

  it('skips dot entries, Claude reserved names, and directories without SKILL.md', async () => {
    const root = await tempDir('scan-skip')
    await writeDirSkill(root, 'synced', 'description: official sync dir')
    await writeDirSkill(root, 'anthropic-skills-foo', 'description: official pack')
    await writeDirSkill(root, '.hidden', 'description: hidden')
    await mkdir(join(root, 'not-a-skill'), { recursive: true })
    await writeFile(join(root, 'notes.txt'), 'plain text', 'utf8')
    await writeDirSkill(root, 'real', 'description: real skill')
    const result = await scanRoot(rootSpec(root), { slugify: true, synthesize: true })
    expect(result.skills.map((skill) => skill.name)).toEqual(['real'])
    expect(result.issues).toEqual([])
  })

  it('collects diagnostics for invalid frontmatter instead of throwing', async () => {
    const root = await tempDir('scan-invalid')
    await writeFile(join(root, 'broken.md'), 'no frontmatter', 'utf8')
    await writeDirSkill(root, 'good', 'description: good')
    const result = await scanRoot(rootSpec(root), { slugify: true, synthesize: true })
    expect(result.skills.map((skill) => skill.name)).toEqual(['good'])
    expect(result.issues.length).toBe(1)
    expect(result.issues[0]).toContain('broken.md')
  })

  it('resolves slug collisions within one root (first in deterministic order wins)', async () => {
    const root = await tempDir('scan-dup')
    // 用无歧义的字典序：alpha-two 先扫到，其 dup_skill slug 化后占住 "dup-skill"
    await writeDirSkill(root, 'alpha-two', 'name: dup_skill\ndescription: first wins')
    await writeDirSkill(root, 'zeta-one', 'name: dup-skill\ndescription: second ignored')
    const result = await scanRoot(rootSpec(root), { slugify: true, synthesize: true })
    expect(result.skills.map((skill) => skill.name)).toEqual(['dup-skill'])
    expect(result.skills[0].description).toBe('first wins')
    expect(result.issues.length).toBe(1)
    expect(result.issues[0]).toContain('duplicate skill name')
  })

  it('maps the Codex openai.yaml policy into invocation', async () => {
    const root = await tempDir('scan-codex')
    const dir = await writeDirSkill(root, 'explicit-only', 'name: explicit-only\ndescription: needs explicit call')
    await mkdir(join(dir, 'agents'), { recursive: true })
    await writeFile(join(dir, 'agents', 'openai.yaml'), 'policy:\n  allow_implicit_invocation: false\n', 'utf8')
    const result = await scanRoot(rootSpec(root, 'codex'), { slugify: true, synthesize: true })
    expect(result.skills[0].invocation).toEqual({ modelInvocable: false, userInvocable: true })
  })

  it('reports absent for a missing root and does not recurse below depth 1', async () => {
    const root = await tempDir('scan-absent')
    const missing = join(root, 'does-not-exist')
    const absent = await scanRoot(rootSpec(missing), { slugify: true, synthesize: true })
    expect(absent.absent).toBe(true)
    expect(absent.skills).toEqual([])

    const nested = await tempDir('scan-nested')
    const outer = await writeDirSkill(nested, 'outer', 'description: outer')
    await writeDirSkill(outer, 'inner', 'description: inner — must not be discovered')
    const result = await scanRoot(rootSpec(nested), { slugify: true, synthesize: true })
    expect(result.skills.map((skill) => skill.name)).toEqual(['outer'])
  })
})
