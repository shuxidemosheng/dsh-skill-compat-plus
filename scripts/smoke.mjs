/**
 * 冒烟脚本：用【构建产物】直接驱动插件，扫描真实的外部技能目录。
 *
 * 用途：发布前/升级后验证 lib/index.js 在脱离 dsh 宿主时能独立完成
 * 发现与加载，并对本机真实技能目录给出清单报告。
 *
 * 运行（Git Bash，仓库根目录）：
 *   node scripts/smoke.mjs                        # 扫本机默认目录
 *   node scripts/smoke.mjs --cwd <某项目路径>      # 额外验证项目级 .claude/.zcode
 */
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { apply } from '../lib/index.js'

const home = homedir()
const cwdArgIndex = process.argv.indexOf('--cwd')

const providers = []
const cleanupFns = []
const ctx = {
  logger: {
    warn(message) {
      console.warn(`[warn] ${message}`)
    },
  },
  skills: {
    registerProvider(factory) {
      const control = {
        signal: new AbortController().signal,
        invalidate: () => console.log('[invalidate] skills/change fired'),
      }
      providers.push(factory(control))
    },
  },
  effect(generator) {
    cleanupFns.push(generator)
  },
}

apply(ctx, {
  sources: {
    claude: { root: resolve(home, '.claude', 'skills') },
    codex: { root: resolve(home, '.codex', 'skills') },
    zcode: { root: resolve(home, '.zcode', 'skills') },
  },
  watch: false,
})

if (providers.length === 0) {
  console.error('smoke failed: no provider registered')
  process.exit(1)
}
const provider = providers[0]

const cwd = cwdArgIndex >= 0 ? resolve(process.argv[cwdArgIndex + 1]) : process.cwd()
const candidates = await provider.list({ cwd })

const bySource = new Map()
for (const candidate of candidates) {
  const list = bySource.get(candidate.source) ?? []
  list.push(candidate)
  bySource.set(candidate.source, list)
}

console.log(`\n=== skill-compat-plus smoke (${provider.name}) ===`)
console.log(`cwd: ${cwd}`)
console.log(`total skills: ${candidates.length}`)
for (const [source, list] of [...bySource].sort()) {
  console.log(`\n[${source}] ${list.length}`)
  for (const candidate of list) {
    const flag = `${candidate.invocation.modelInvocable ? 'm' : '-'}${candidate.invocation.userInvocable ? 'u' : '-'}`
    console.log(`  ${flag} ${candidate.name}  (rank ${candidate.rank})  ${candidate.description.slice(0, 72)}`)
  }
}

if (candidates.length > 0) {
  const sample = candidates[0]
  const definition = await provider.get(sample, { cwd })
  console.log(`\n=== get("${sample.name}") ===`)
  console.log(`path: ${definition?.path}`)
  console.log(`content head: ${definition?.content.slice(0, 120).replace(/\n/g, ' ')}`)
}

await provider.dispose()
console.log('\nsmoke done')
process.exit(0)
