import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveConfig } from '../src/config'
import { CompatSkillProvider } from '../src/provider'
import { cleanupTempDirs, createTestLogger, tempDir, writeDirSkill } from './helpers'

afterEach(cleanupTempDirs)

function makeProvider(root: string, options: { watch?: boolean } = {}) {
  const config = resolveConfig({
    sources: { claude: { root }, codex: false, zcode: false },
    watch: options.watch ?? true,
  })
  const logger = createTestLogger()
  const provider = new CompatSkillProvider(config, logger)
  const invalidate = vi.fn()
  provider.attach({ invalidate, signal: new AbortController().signal })
  return { provider, logger, invalidate }
}

describe('CompatWatchController (through the provider)', () => {
  it('invalidates when a skill file is added to an existing watched root', async () => {
    const root = await tempDir('watch-root')
    await mkdir(root, { recursive: true })
    const { provider, invalidate } = makeProvider(root)

    // 首轮 list 注册 watch
    await provider.list({ cwd: undefined })

    await writeDirSkill(root, 'late', 'description: appeared later')
    await vi.waitFor(() => {
      expect(invalidate.mock.calls.length).toBeGreaterThan(0)
    }, { timeout: 8000, interval: 200 })

    // 失效后重扫能看到新技能
    const candidates = await provider.list({ cwd: undefined })
    expect(candidates.map((candidate) => candidate.name)).toEqual(['late'])
    await provider.dispose()
  })

  it('invalidates when the watched root appears only after startup', async () => {
    const outer = await tempDir('watch-appear')
    const root = join(outer, 'skills') // 启动时不存在
    const { provider, invalidate } = makeProvider(root)

    await provider.list({ cwd: undefined })
    expect(invalidate.mock.calls.length).toBe(0)

    await mkdir(root, { recursive: true })
    await writeDirSkill(root, 'born-late', 'description: root appeared later')
    await vi.waitFor(() => {
      expect(invalidate.mock.calls.length).toBeGreaterThan(0)
    }, { timeout: 12000, interval: 250 })

    const candidates = await provider.list({ cwd: undefined })
    expect(candidates.map((candidate) => candidate.name)).toEqual(['born-late'])
    await provider.dispose()
    const callsAfterDispose = invalidate.mock.calls.length
    await writeDirSkill(root, 'after-dispose', 'description: ignored')
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(invalidate.mock.calls.length).toBe(callsAfterDispose)
  })
})
