/**
 * 测试夹具助手：临时目录 + 三家生态的技能文件构造器。
 * 镜像官方 skill 包 spec 的做法（每 spec 自带小工具，afterEach 统一清理）。
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDirs: string[] = []

export async function tempDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `dsh-skill-compat-${label}-`))
  // Windows 的 tmpdir() 可能返回 8.3 短路径（如 FENGHA~1）：libuv 的 fs.watch
  // 对短路径会触发断言崩溃，路径比较也会错位 —— 统一 realpath 归一化。
  const real = await realpath(dir)
  tempDirs.push(real)
  return real
}

export async function cleanupTempDirs(): Promise<void> {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 目录 bundle：<root>/<name>/SKILL.md，返回 bundle 目录。 */
export async function writeDirSkill(
  root: string,
  name: string,
  frontmatter: string,
  body = 'Body text for the skill.',
): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}\n`, 'utf8')
  return dir
}

/** 扁平技能：<root>/<name>.md。 */
export async function writeFlatSkill(
  root: string,
  name: string,
  frontmatter: string,
  body = 'Body text for the skill.',
): Promise<string> {
  await writeFile(join(root, `${name}.md`), `---\n${frontmatter}\n---\n${body}\n`, 'utf8')
  return join(root, `${name}.md`)
}

export interface TestLogger {
  warnings: string[]
  warn(message: string): void
}

export function createTestLogger(): TestLogger {
  const warnings: string[] = []
  return { warnings, warn(message: string) { warnings.push(message) } }
}
