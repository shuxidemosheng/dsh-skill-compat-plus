import { afterEach, describe, expect, it } from 'vitest'
import {
  isSkillName,
  lenientBoolean,
  mapForeignSkill,
  slugifySkillName,
  splitFrontmatter,
  synthesizeDescription,
} from '../src/frontmatter'
import { cleanupTempDirs } from './helpers'

afterEach(cleanupTempDirs)

describe('splitFrontmatter', () => {
  it('parses a standard frontmatter block and keeps the body', () => {
    const parsed = splitFrontmatter('---\nname: demo\ndescription: A demo\n---\nBody here.\n')
    expect(parsed).toBeDefined()
    expect(parsed!.data).toEqual({ name: 'demo', description: 'A demo' })
    expect(parsed!.body).toBe('Body here.\n')
  })

  it('tolerates CRLF line endings', () => {
    const parsed = splitFrontmatter('---\r\nname: demo\r\ndescription: d\r\n---\r\nBody\r\n')
    expect(parsed).toBeDefined()
    expect(parsed!.data.name).toBe('demo')
  })

  it('parses YAML block scalars and nested maps (the competitor flat parser fails here)', () => {
    const raw = '---\nname: demo\ndescription: >-\n  Folded description\n  spanning lines\nmetadata:\n  key: value\n---\nBody\n'
    const parsed = splitFrontmatter(raw)
    expect(parsed).toBeDefined()
    expect(parsed!.data.description).toBe('Folded description spanning lines')
    expect(parsed!.data.metadata).toEqual({ key: 'value' })
  })

  it('returns undefined for missing frontmatter, broken fences, or non-object YAML', () => {
    expect(splitFrontmatter('no frontmatter here\n')).toBeUndefined()
    expect(splitFrontmatter('---\nname: demo\n')).toBeUndefined()
    expect(splitFrontmatter('---\n- a\n- b\n---\nBody\n')).toBeUndefined()
    expect(splitFrontmatter('---\nname: [unclosed\n---\nBody\n')).toBeUndefined()
  })
})

describe('isSkillName parity with upstream', () => {
  // 本地复制官方 SKILL_NAME 文法（避免打包整个 dsh-skill 闭包）。
  // 此对拍保证：上游文法一旦变化，这里会先红。
  it('matches @deepseek-ai/dsh-skill isSkillName on a representative corpus', async () => {
    const { isSkillName: upstream } = await import('@deepseek-ai/dsh-skill')
    const corpus = [
      'demo', 'a', '4drawio', '1start-mathmodel', 'references', 'nature-figure',
      'code-review', 'Code-Review', 'code_review', '-lead', 'trailing-', 'a--b',
      '', '中文', 'café', 'x'.repeat(200), 'v2', 'skill.name', 'skill name',
    ]
    for (const name of corpus) {
      expect(isSkillName(name)).toBe(upstream(name))
    }
  })
})

describe('lenientBoolean / slugifySkillName / synthesizeDescription', () => {
  it('accepts the official lenient boolean spellings', () => {
    expect(lenientBoolean(true)).toBe(true)
    expect(lenientBoolean(1)).toBe(true)
    expect(lenientBoolean('yes')).toBe(true)
    expect(lenientBoolean('0')).toBe(false)
    expect(lenientBoolean('off')).toBe(false)
    expect(lenientBoolean('maybe')).toBeUndefined()
    expect(lenientBoolean(undefined)).toBeUndefined()
  })

  it('slugifies foreign names into dsh kebab-case', () => {
    expect(slugifySkillName('My Tool')).toBe('my-tool')
    expect(slugifySkillName('code_review')).toBe('code-review')
    expect(slugifySkillName('4drawio')).toBe('4drawio')
    expect(slugifySkillName('--Lead--')).toBe('lead')
    expect(slugifySkillName('中文技能')).toBe('')
  })

  it('synthesizes a description from the first meaningful body line, truncated at 200 chars', () => {
    expect(synthesizeDescription('# Title\n\nRest\n')).toBe('Title')
    const long = 'x'.repeat(300)
    const truncated = synthesizeDescription(long)
    expect(truncated.length).toBeLessThanOrEqual(201)
    expect(truncated.endsWith('…')).toBe(true)
    const spaced = `${'a'.repeat(190)} ${'b'.repeat(190)}`
    expect(synthesizeDescription(spaced).endsWith('…')).toBe(true)
  })
})

describe('mapForeignSkill', () => {
  const base = {
    filePath: 'C:\\skills\\demo\\SKILL.md',
    directory: 'C:\\skills\\demo',
    entryName: 'demo',
    slugify: true,
    synthesize: true,
  }

  it('maps a Claude-style skill: dir-name fallback, snake when_to_use, foreign fields kept in metadata', () => {
    const parsed = splitFrontmatter(
      '---\ndescription: Draw diagrams\nwhen_to_use: When the user asks for a diagram\nallowed-tools: Bash(*), Read\n---\nUse drawio to draw.\n',
    )!
    const result = mapForeignSkill({ ...base, parsed })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.name).toBe('demo')
    expect(result.skill.whenToUse).toBe('When the user asks for a diagram')
    expect(result.skill.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(result.skill.metadata['allowed-tools']).toBe('Bash(*), Read')
    expect(result.skill.content).toBe('Use drawio to draw.')
    expect(result.skill.path).toBe(base.filePath)
    expect(result.skill.directory).toBe(base.directory)
  })

  it('synthesizes a description when missing (Claude allows absent description)', () => {
    const parsed = splitFrontmatter('---\nname: demo\n---\n# Drawing diagrams\n\nMore text\n')!
    const result = mapForeignSkill({ ...base, parsed })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skill.description).toBe('Drawing diagrams')
  })

  it('fails without description when synthesize is disabled', () => {
    const parsed = splitFrontmatter('---\nname: demo\n---\nBody\n')!
    const result = mapForeignSkill({ ...base, parsed, synthesize: false })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('description')
  })

  it('slugifies invalid names and rejects unconvertible ones', () => {
    const underscore = splitFrontmatter('---\nname: code_review\ndescription: d\n---\nBody\n')!
    const slugResult = mapForeignSkill({ ...base, parsed: underscore })
    expect(slugResult.ok).toBe(true)
    if (slugResult.ok) expect(slugResult.skill.name).toBe('code-review')

    const noSlug = mapForeignSkill({ ...base, parsed: underscore, slugify: false })
    expect(noSlug.ok).toBe(false)

    const cjk = splitFrontmatter('---\nname: 中文技能\ndescription: d\n---\nBody\n')!
    const cjkResult = mapForeignSkill({ ...base, parsed: cjk })
    expect(cjkResult.ok).toBe(false)
  })

  it('maps invocation fields leniently and rejects legacy camelCase keys', () => {
    const strict = splitFrontmatter('---\nname: demo\ndescription: d\ndisable-model-invocation: yes\nuser-invocable: false\n---\nBody\n')!
    const strictResult = mapForeignSkill({ ...base, parsed: strict })
    expect(strictResult.ok).toBe(true)
    if (strictResult.ok) {
      expect(strictResult.skill.invocation).toEqual({ modelInvocable: false, userInvocable: false })
    }

    const legacy = splitFrontmatter('---\nname: demo\ndescription: d\ndisableModelInvocation: true\n---\nBody\n')!
    const legacyResult = mapForeignSkill({ ...base, parsed: legacy })
    expect(legacyResult.ok).toBe(false)
    if (!legacyResult.ok) expect(legacyResult.reason).toContain('disable-model-invocation')

    const badBool = splitFrontmatter('---\nname: demo\ndescription: d\ndisable-model-invocation: perhaps\n---\nBody\n')!
    expect(mapForeignSkill({ ...base, parsed: badBool }).ok).toBe(false)
  })

  it('honors the Codex openai.yaml allow_implicit_invocation policy', () => {
    const parsed = splitFrontmatter('---\nname: demo\ndescription: d\n---\nBody\n')!
    const result = mapForeignSkill({ ...base, parsed, allowImplicitInvocation: false })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.skill.invocation.modelInvocable).toBe(false)
  })
})
