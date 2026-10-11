/**
 * 目录监听：根目录出现/消失 + 内容变化 → 防抖 → control.invalidate()。
 *
 * 结构说明（为什么不用官方 SkillWatchManager 的两态机）：
 * - chokidar 只能监视已存在的路径，"根目录后创建"需要额外信号源；
 * - 这里用 fs.watchFile（stat 轮询，persistent:false）作为存在性信号源，
 *   chokidar 作为内容变化的高速信号源，两者正交：
 *   · watchFile 每 ~2.5s 一次 stat，仅触发显式 refresh()（真实存在性以
 *     stat() 为准，不依赖 watchFile 对缺失路径的参数语义）；
 *   · chokidar 在目录存在时打开，目录消失/出错时关闭；
 * - 任一信号触发存在性翻转或内容变化，都合并进 150ms 防抖后 invalidate。
 */
import { stat } from 'node:fs/promises'
import { watchFile, unwatchFile, type Stats } from 'node:fs'
import * as chokidar from 'chokidar'
import type { Logger } from './types.js'

const PRESENCE_POLL_MS = 2500
const DEBOUNCE_MS = 150

interface WatchState {
  readonly kind: 'user' | 'project' | 'extra'
  chokidarWatcher: chokidar.FSWatcher | undefined
  present: boolean
}

export interface WatchOptions {
  invalidate(): void
  logger: Logger
  usePolling: boolean
  stabilityThresholdMs: number
  pollIntervalMs: number
  /** 项目根监视 LRU 上限（用户级/extra 根不计入）。 */
  maxProjects: number
}

export class CompatWatchController {
  private readonly states = new Map<string, WatchState>()
  private debounceTimer: NodeJS.Timeout | undefined
  private disposed = false

  constructor(private readonly options: WatchOptions) {}

  /** 注册要监视的根（幂等；list() 每轮把解析出的 roots 传进来）。 */
  observe(entries: readonly { readonly path: string; readonly kind: WatchState['kind'] }[]): void {
    if (this.disposed) return
    for (const entry of entries) {
      if (this.states.has(entry.path)) continue
      const state: WatchState = { kind: entry.kind, chokidarWatcher: undefined, present: false }
      this.states.set(entry.path, state)
      watchFile(entry.path, { interval: PRESENCE_POLL_MS, persistent: false }, () => {
        void this.refresh(entry.path, state)
      })
      void this.refresh(entry.path, state)
    }
    this.evictProjectOverflow()
  }

  /** 项目根数量超限时逐出最旧的项目根（Map 保持插入序）。 */
  private evictProjectOverflow(): void {
    let projectCount = 0
    for (const state of this.states.values()) {
      if (state.kind === 'project') projectCount += 1
    }
    for (const [path, state] of this.states) {
      if (projectCount <= this.options.maxProjects) break
      if (state.kind !== 'project') continue
      this.closeChokidar(state)
      unwatchFile(path)
      this.states.delete(path)
      projectCount -= 1
      this.options.logger.warn(`skill-compat-plus: project watch limit (${this.options.maxProjects}) reached, dropped watch for ${path}`)
    }
  }

  /** 存在性判定以 stat() 为准；watchFile 只充当变化信号。 */
  private async refresh(path: string, state: WatchState): Promise<void> {
    if (this.disposed) return
    let info: Stats | undefined
    try {
      info = await stat(path)
    } catch {
      info = undefined
    }
    const exists = info !== undefined && info.isDirectory()
    if (exists === state.present) return
    state.present = exists
    if (exists) {
      this.openChokidar(path, state)
    } else {
      this.closeChokidar(state)
    }
    this.queueInvalidate()
  }

  private openChokidar(path: string, state: WatchState): void {
    if (state.chokidarWatcher !== undefined) return
    try {
      const watcher = chokidar.watch(path, {
        persistent: true,
        ignoreInitial: true,
        depth: 1,
        atomic: true,
        usePolling: this.options.usePolling,
        interval: this.options.pollIntervalMs,
        awaitWriteFinish: {
          stabilityThreshold: this.options.stabilityThresholdMs,
          pollInterval: this.options.pollIntervalMs,
        },
      })
      watcher.on('all', () => this.queueInvalidate())
      watcher.on('error', (error) => {
        this.options.logger.warn(
          `skill-compat-plus: watcher error for ${path}: ${error instanceof Error ? error.message : String(error)}`,
        )
        // 关闭后由 watchFile 的存在性轮询兜底；目录重建时会重新打开。
        this.closeChokidar(state)
      })
      state.chokidarWatcher = watcher
    } catch (error) {
      this.options.logger.warn(
        `skill-compat-plus: failed to watch ${path}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private closeChokidar(state: WatchState): void {
    const watcher = state.chokidarWatcher
    state.chokidarWatcher = undefined
    if (watcher !== undefined) void watcher.close().catch(() => {})
  }

  private queueInvalidate(): void {
    if (this.disposed || this.debounceTimer !== undefined) return
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      this.options.invalidate()
    }, DEBOUNCE_MS)
    this.debounceTimer.unref?.()
  }

  async dispose(): Promise<void> {
    this.disposed = true
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    for (const [path, state] of this.states) {
      this.closeChokidar(state)
      unwatchFile(path)
      this.states.delete(path)
    }
  }
}
