# dsh-skill-compat-plus

[![npm version](https://img.shields.io/npm/v/dsh-skill-compat-plus.svg)](https://www.npmjs.com/package/dsh-skill-compat-plus)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-brightgreen.svg)](package.json)

**把 Claude Code / Codex / ZCode 的技能目录挂进 DeepSeek Harness（dsh）。** 一个插件，让 dsh 直接看到你已有生态里的 agent skills——无需复制、无需迁移、改动即时生效。

## 它是什么

dsh 官方的技能发现只扫描 `.dsh/skills`、`.agents/skills`、`~/.dsh/skills` 等自有目录。而 Claude Code（`~/.claude/skills`）、Codex CLI（`~/.codex/skills`）、ZCode（`~/.zcode/skills`）各自维护着大量高质量技能。本插件以 **SkillProvider** 形式（`ctx.skills.registerProvider`）把这些目录作为只读来源挂进 dsh 的技能注册表：

- **模型可用**：导入技能进入 `skill` 工具的目录（catalog），模型按需加载；
- **用户可斜杠调用**：`user-invocable` 技能自动获得 dsh 原生的 `/name` 手势入口；
- **热更新**：目录里新增/修改/删除技能文件，无需重启即可生效（chokidar + 存在性轮询）；
- **零侵入**：只读挂载，不复制、不改写你的任何文件；卸载即恢复原状。

## 功能

- 三家来源默认全开，目录不存在时静默跳过：
  - `claude-code`：`~/.claude/skills`（用户级）+ `<项目根>/.claude/skills`（项目级，按最近 `.git` 祖先探测）
  - `codex`：`~/.codex/skills`（旧约定目录；Codex 新官方 `~/.agents/skills` dsh 原生已扫，不重复挂载）
  - `zcode`：`~/.zcode/skills`（用户级）+ `<项目根>/.zcode/skills`（项目级）
- **frontmatter 字段映射**（详见下表）：`when_to_use` → `whenToUse`、宽松布尔、Codex `agents/openai.yaml` 的 `policy.allow_implicit_invocation` 等
- **名称规范化**：外来名不符合 dsh kebab-case 时自动 slug 化（如 `_references` → `references`、`code_review` → `code-review`），可关闭
- **description 合成**：Claude 允许缺省 description，而 dsh 必填——自动取正文首段合成（可关闭）
- **优先级体系**：dsh 原生技能永远压过同名导入技能；项目级导入压过用户级导入
- **诊断聚合**：无效文件、命名冲突等按问题集合变化输出 warn，不刷屏
- YAML 用官方同款 `yaml` 包解析——块标量（`>-`、`|`）、嵌套 metadata 都能正确处理

## 字段映射表

| 外来字段 | Claude Code | Codex | ZCode | 映射到 dsh |
|---|---|---|---|---|
| `name` | 可选（缺省取目录名） | 必填 | 可选（缺省取目录名） | 必填；缺省用目录名，不合规则 slug 化 |
| `description` | 可选 | 必填 | 可选 | 必填；缺失时从正文首段合成（可关） |
| `when_to_use` | 有 | 无 | 有 | `whenToUse`（snake → camel） |
| `disable-model-invocation` | 有 | 无 | 无 | `invocation.modelInvocable` |
| `user-invocable` | 有 | 无 | 无 | `invocation.userInvocable` |
| `agents/openai.yaml` 的 `policy.allow_implicit_invocation: false` | 无 | 有 | 无 | `invocation.modelInvocable: false` |
| `allowed-tools` / `disallowed-tools` | 有 | 有（空格分隔） | 无 | 保留在 `metadata`（dsh 无对应物） |
| `model` / `effort` / `hooks` / `paths` / `shell` / `argument-hint` 等 | 有 | 无 | 无 | 保留在 `metadata` |
| `license` / `compatibility` | 有 | 有 | 容忍 | 保留在 `metadata` |
| `metadata`（map） | 有 | 有 | 有 | 原样保留 |

整个原始 frontmatter 会全量保真进 `metadata`，不做静默丢弃。

## 优先级（rank，越小越优先）

| 来源 | 目录 | rank | 语义 |
|---|---|---|---|
| dsh 原生 project-dsh | `<项目根>/.dsh/skills` | 100 | 永远压过导入 |
| dsh 原生 project-agents | `<项目根>/.agents/skills` | 200 | 永远压过导入 |
| **claude-code 项目级** | `<项目根>/.claude/skills` | **210** | 输给 dsh 原生项目级 |
| **zcode 项目级** | `<项目根>/.zcode/skills` | **220** | 同上 |
| dsh 原生 custom | `Config.customSkillDirs` | 300 | |
| **extraDirs** | 任意目录 | **300**（可按目录覆盖） | 与官方 custom 同档 |
| dsh 原生 user-dsh | `~/.dsh/skills` | 400 | |
| **claude-code 用户级** | `~/.claude/skills` | **450** | 输给 dsh 原生用户级 |
| **codex 用户级** | `~/.codex/skills` | **460** | |
| **zcode 用户级** | `~/.zcode/skills` | **470** | |
| dsh 原生 user-agents / bundled | `~/.agents/skills` / 内置 | 500 / 600 | |

同名技能裁决由 dsh 官方注册表完成（rank → provider 注册序 → list 内顺序），本插件只负责给出确定的 rank。

## 安装

| 方式 | 命令 / 操作 |
|---|---|
| CLI（npm 包） | `dsh plugin --profile <你的profile> add dsh-skill-compat-plus` |
| 桌面端 | 插件页安装 `dsh-skill-compat-plus`，或：`ELECTRON_RUN_AS_NODE=1 "/d/DeepSeek Harness/DeepSeek Harness.exe" --expose-internals "D:/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js" plugin --profile desktop add dsh-skill-compat-plus`（Git Bash，先完全退出应用含托盘） |
| git 直装（始终最新 main） | `dsh plugin --profile <你的profile> add git+https://github.com/shuxidemosheng/dsh-skill-compat-plus.git` |
| 本地 tgz | `npm pack` 后 `dsh plugin --profile <你的profile> add file:<你的打包路径>/dsh-skill-compat-plus-0.1.0.tgz` |

## 配置

配置写在 `cordis.patch.yml` 的 entry `config` 下（profile 层可覆盖，整体替换语义）：

| 键 | 默认 | 说明 |
|---|---|---|
| `providerName` | `skill-compat-plus` | provider 注册名（`runtime` 为保留字，不可用） |
| `sources.claude` | `true` | `boolean` 或 `{ enabled?, project?, root?, rank? }` |
| `sources.codex` | `true` | 同上 |
| `sources.zcode` | `true` | 同上 |
| `extraDirs` | `[]` | `{ path, label?, rank? }[]`，任意额外技能目录 |
| `watch` | `true` | 文件变化热更新 |
| `watchUsePolling` | `false` | 网络盘/特殊文件系统上开启轮询监视 |
| `watchStabilityThresholdMs` | `200` | awaitWriteFinish 稳定阈值 |
| `watchPollIntervalMs` | `100` | awaitWriteFinish 轮询间隔 |
| `watchMaxProjects` | `128` | 项目根监视 LRU 上限 |
| `slugifyNames` | `true` | 关闭后不合规名直接 skip |
| `synthesizeDescription` | `true` | 关闭后缺 description 的技能直接 skip |

未知配置键会直接报错（fail-fast，不做静默忽略）。

## 本地开发

```bash
# Git Bash
npm install
npm test              # vitest，32 个用例（含 Windows 路径、真实时序 watch 测试、与上游文法的对拍）
npm run build         # tsc d.ts + esbuild bundle（yaml/chokidar 为外部运行时依赖）
node scripts/smoke.mjs   # 用构建产物直接扫描本机真实技能目录并打印清单
```

## 安全

- 本插件**只读**外部技能目录：唯一的写操作是 chokidar/fs.watchFile 的监视句柄。
- 技能内容由 dsh 官方 `skill` 工具管线加载，本插件不执行任何技能内代码。
- **产物最小化**：`yaml`/`chokidar` 作为运行时依赖（由 plugin-manager 安装进 profile），构建产物只含第一方代码——安全扫描面与攻击面都最小。
- **Mimosa 深度扫描封印**（2026-10-11，v0.1.0，最终产物）：
  - 发布前复核：scanId `scan-2026-10-11T10-22-46.363Z-046924c5dc3e`，seal `sha256:8b6abe1217fbf677d8f9577792cf63a89ba5c97b04f85c6ae67027340a0f93a7`，findings 0，依赖风险 0
  - seal: `sha256:f35ddf0890c53725a25589f8515b20f3b13025d213f8901af52a28d2dc77ccf1`
  - findings 0，依赖风险 0。
  - 历史记录：最初的 472KB 自包含产物曾报 6 条静态 advisory（scanId `scan-2026-10-11T09-25-20.462Z-3a00d7a1835b`，全部位于当时打包进去的上游闭包——`yaml` scalar 解析器、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-skill` 注册表内部，属静态污点分析对官方包内部实现的误报模式）。据此改为外部依赖方案后复扫归零。

## 已知限制

- Claude/ZCode **插件包内部**的技能（`~/.claude/plugins`、`~/.zcode/cli/plugins/cache` 等）不在默认发现范围，可用 `extraDirs` 手动挂载；自动识别（`.claude-plugin/plugin.json` 等）留待后续版本。
- 项目级只扫描最近 `.git` 祖先**一级**（对齐 dsh 官方）；ZCode 式的 CWD→worktree 多级扫描不做。
- Claude Code 的嵌套 `<subdir>/.claude/skills`、`--add-dir`、企业托管目录不支持。
- `allowed-tools` / `model` / `hooks` 等执行语义字段在 dsh 没有对应物，仅保留在 `metadata` 供追溯。
- 大量导入技能会增大模型端 catalog（每个会话一条 `<available_skills>` 提醒）；建议用 `sources.*.enabled` / `extraDirs` 精选。
- dsh 处于 developer preview：peerDependencies 锁 `@deepseek-ai/dsh-skill >=0.2.0-rc.2`，上游 breaking change 需跟进。

## FAQ

**Q: 会不会和 dsh 原生技能冲突？**
同名时 dsh 原生优先（见 rank 表），不会出现不可预测的覆盖；本插件发现的重名会在日志里给出 `duplicate skill name` 诊断。

**Q: `~/.agents/skills` 里的技能为什么没被本插件列出？**
那本来就是 dsh 原生扫描的目录（同时也是 Codex 新官方用户根），无需桥接。

**Q: 技能文件改了但没生效？**
确认 `watch: true`；网络盘请开 `watchUsePolling: true`。watch 的存在性轮询约 2.5s，内容事件走 chokidar（亚秒级）。

## 上游致谢

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) —— SkillProvider 接缝、`dsh-skill-filesystem` 参考实现、插件 bundle 机制
- 格式参考：[Claude Code skills 文档](https://code.claude.com/docs/en/skills)、[Codex skills 文档](https://developers.openai.com/codex/skills)、[Agent Skills 开放规范](https://agentskills.io)
- 同类项目：[YTyangtao666/dsh-skills-bridge](https://github.com/YTyangtao666/dsh-skills-bridge)（首发思路），本插件在目录覆盖面、YAML 解析、Windows 路径正确性、诊断聚合与测试覆盖上做了全面增强

## 许可证

[MIT](LICENSE)
