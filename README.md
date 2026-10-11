<div align="center">

# dsh-skill-compat-plus

**一条命令，让你 Claude Code / Codex / ZCode 里的技能在 dsh 原地复活。**

零迁移 · 只读挂载 · 改完即生效 · 模型自动用、用户随手 `/`

社区插件生态：[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

[![npm version](https://img.shields.io/npm/v/dsh-skill-compat-plus)](https://www.npmjs.com/package/dsh-skill-compat-plus)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-brightgreen.svg)](package.json)
[![dsh](https://img.shields.io/badge/dsh-%E2%89%A50.2.0--rc.2-4176E6.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![tests](https://img.shields.io/badge/tests-32%20passing-2EA44F.svg)](#本地开发)
[![audit](https://img.shields.io/badge/Mimosa%20audit-clean-2EA44F.svg)](#安全)

</div>

你在 Claude Code 里攒了一堆 skills，Codex 和 ZCode 里又各有一套——切到 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness)，一个都带不过去，只能逐个复制 `SKILL.md` 再手动同步。**本插件把这三家的技能目录作为只读技能来源直接挂进 dsh**：技能原地不动，模型按需自动加载，用户敲 `/名字` 随手调用，文件一改秒级生效。

> [!TIP]
> ## Quick Start
>
> CLI（推荐带版本号，规避 profile 安装端的 `minimumReleaseAge` 冷却）：
>
> ```bash
> dsh plugin --profile <你的profile> add dsh-skill-compat-plus@0.1.0
> ```
>
> 桌面端：**插件页搜索 `dsh-skill-compat-plus` 一键安装**，装完重启。装完什么都不用配——三家来源默认全开，目录不存在自动跳过。

## 效果一览（示意）

```text
用户敲 / ────────────────────────────────────────┐
│ 4drawio          数学建模非数据型图示绘制阶段…      │
│ nature-figure    Create, revise, audit, and …    │
│ 1start-mathmodel 数学建模竞赛工作流入口。用于启动…   │
│ …（本机实测：Claude 30 个 + Codex 20 个一次到位）    │
└────────────────────────────────────────────────┘
模型侧：同一批技能进入 skill 工具的 <available_skills> 目录，按需自动加载。
```

## 为什么是"挂"而不是"搬"

- **原地不动**。技能文件留在原目录，不复制、不改写、卸载即恢复原状——对齐 modlens 的"一个插件、零侵入"哲学。
- **双侧可用**。`user-invocable` 技能自动获得 dsh 原生 `/名字` 手势入口（host 端 pre-step 解析，无需注册命令）；模型侧进入 catalog 按需加载。
- **热更新**。chokidar 监听 + 存在性轮询双通道：目录里增删改技能、甚至整个目录后建，都不用重启。
- **名称规范化**。`_references` → `references`、`code_review` → `code-review` 自动 slug 化；Claude 缺省的 description 从正文首段合成——dsh 的两条硬约束（kebab 名 + 非空描述）由插件兜底。
- **优先级刻死**。dsh 原生技能永远坐 C 位，同名导入技能让位；项目级导入压过用户级导入。不会出现导入悄悄覆盖原生的情况。
- **诊断不刷屏**。无效文件、命名冲突按"问题集合变化"输出 warn， catalog 重建再多次也只有变化时说一句。

## 支持的来源

| 来源 | 目录 | 默认 |
|---|---|---|
| `claude-code` | `~/.claude/skills` + `<项目根>/.claude/skills` | 开 |
| `codex` | `~/.codex/skills`（旧约定；新官方 `~/.agents/skills` dsh 原生已扫） | 开 |
| `zcode` | `~/.zcode/skills` + `<项目根>/.zcode/skills` | 开 |
| `extraDirs` | 任意额外目录（`{ path, label?, rank? }`） | 空 |

目录不存在静默跳过；每家可单独开关、自定义路径与 rank。

## 字段映射（外来 frontmatter → dsh）

| 外来字段 | 映射 |
|---|---|
| `name` | 缺省取目录名；不合 dsh kebab 规则 → slug 化（可关） |
| `description` | 缺失（Claude 允许）→ 正文首段合成（可关） |
| `when_to_use` / `whenToUse` | → `whenToUse` |
| `disable-model-invocation` | → `invocation.modelInvocable: false` |
| `user-invocable` | → `invocation.userInvocable` |
| Codex `agents/openai.yaml` 的 `policy.allow_implicit_invocation: false` | → `invocation.modelInvocable: false` |
| `allowed-tools` / `model` / `hooks` / `license` / `compatibility` 等 | 原样保留进 `metadata`（dsh 无对应物，不静默丢弃） |

整个原始 frontmatter 全量保真进 `metadata`，可追溯。

<details>
<summary><strong>完整优先级表（rank，越小越优先）</strong></summary>

| 来源 | 目录 | rank |
|---|---|---|
| dsh 原生 project-dsh | `<项目根>/.dsh/skills` | 100 |
| dsh 原生 project-agents | `<项目根>/.agents/skills` | 200 |
| **claude-code 项目级** | `<项目根>/.claude/skills` | **210** |
| **zcode 项目级** | `<项目根>/.zcode/skills` | **220** |
| dsh 原生 custom / **extraDirs** | 配置目录 | 300 |
| dsh 原生 user-dsh | `~/.dsh/skills` | 400 |
| **claude-code 用户级** | `~/.claude/skills` | **450** |
| **codex 用户级** | `~/.codex/skills` | **460** |
| **zcode 用户级** | `~/.zcode/skills` | **470** |
| dsh 原生 user-agents / bundled | `~/.agents/skills` / 内置 | 500 / 600 |

同名裁决由 dsh 官方注册表完成（rank → provider 注册序 → list 内顺序），本插件保证 rank 确定且原生恒优先。

</details>

## 配置

写在 `cordis.patch.yml` 的 entry `config` 下（profile 层可覆盖，整体替换语义），未知键 fail-fast：

| 键 | 默认 | 说明 |
|---|---|---|
| `providerName` | `skill-compat-plus` | provider 注册名（`runtime` 为保留字） |
| `sources.claude` / `.codex` / `.zcode` | `true` | `boolean` 或 `{ enabled?, project?, root?, rank? }` |
| `extraDirs` | `[]` | `{ path, label?, rank? }[]` |
| `watch` | `true` | 热更新开关 |
| `watchUsePolling` | `false` | 网络盘/特殊文件系统开启 |
| `watchStabilityThresholdMs` / `watchPollIntervalMs` | 200 / 100 | awaitWriteFinish 参数 |
| `watchMaxProjects` | `128` | 项目根监视 LRU 上限 |
| `slugifyNames` | `true` | 关闭后不合规名直接 skip |
| `synthesizeDescription` | `true` | 关闭后缺 description 的技能直接 skip |

> [!NOTE]
> 导入技能会进入每个会话的 `<available_skills>` 目录提醒，挂太多会持续占用模型上下文——建议用 `sources.*.enabled` / `extraDirs` 按需精选。

## 安装方式

| 方式 | 命令 / 操作 |
|---|---|
| CLI（npm 包） | `dsh plugin --profile <你的profile> add dsh-skill-compat-plus@0.1.0` |
| 桌面端 | 插件页搜索安装；或 `ELECTRON_RUN_AS_NODE=1 "/d/DeepSeek Harness/DeepSeek Harness.exe" --expose-internals "D:/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js" plugin --profile desktop add dsh-skill-compat-plus`（Git Bash，先完全退出应用含托盘） |
| git 直装（始终最新 main） | `dsh plugin --profile <你的profile> add git+https://github.com/shuxidemosheng/dsh-skill-compat-plus.git` |
| 本地 tgz | `npm pack` 后 `dsh plugin --profile <你的profile> add file:<你的打包路径>/dsh-skill-compat-plus-0.1.0.tgz` |

## 已知限制

- Claude/ZCode **插件包内部**的技能（plugin cache、`.claude-plugin` 等）不在默认发现范围，可用 `extraDirs` 手动挂载；自动识别留待后续版本。
- 项目级只扫最近 `.git` 祖先**一级**（对齐 dsh 官方）；ZCode 式 CWD→worktree 多级扫描不做。
- Claude 的嵌套 `<subdir>/.claude/skills`、`--add-dir`、企业托管目录不支持。
- `allowed-tools` / `model` / `hooks` 等执行语义字段仅保留在 `metadata`，dsh 侧无执行效果。

## FAQ

**Q: 会不会覆盖 dsh 原生技能？**
不会。同名时原生恒优先（见优先级表），本插件发现的重名会输出 `duplicate skill name` 诊断。

**Q: `~/.agents/skills` 里的技能怎么没被列出？**
那本来就是 dsh 原生扫描目录（同时也是 Codex 新官方用户根），无需桥接。

**Q: 技能文件改了没生效？**
确认 `watch: true`；网络盘开 `watchUsePolling: true`。存在性轮询约 2.5s，内容事件走 chokidar（亚秒级）。

## 本地开发

```bash
npm install
npm test              # vitest，32 个用例（含 Windows 路径、真实时序 watch、上游文法对拍）
npm run build         # tsc d.ts + esbuild bundle（yaml/chokidar 为外部运行时依赖）
node scripts/smoke.mjs   # 构建产物直接扫描本机真实技能目录并打印清单
```

## 安全

- 只读挂载：唯一的系统写入是 watcher 句柄；技能内容由 dsh 官方 `skill` 管线加载，本插件不执行技能内代码。
- 产物只含第一方代码（`yaml`/`chokidar` 为运行时依赖），扫描面与攻击面最小化。
- Mimosa 深度扫描（2026-10-11，v0.1.0）：scanId `scan-2026-10-11T11-54-46.891Z-47166d49d84b`，seal `sha256:c5a95c8ed6f9b2079af39ecb487126b7814a52e362212f4104b3ae137a58cd57`，findings 0，依赖风险 0。历史：自包含产物曾报 6 条上游闭包静态误报（scanId `...3a00d7a1835b`），改外部依赖后归零。

## 同类与致谢

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) —— SkillProvider 接缝、`dsh-skill-filesystem` 参考实现、bundle 机制
- 格式规范：[Claude Code skills](https://code.claude.com/docs/en/skills) · [Codex skills](https://developers.openai.com/codex/skills) · [Agent Skills 开放规范](https://agentskills.io)
- 同类项目：[YTyangtao666/dsh-skills-bridge](https://github.com/YTyangtao666/dsh-skills-bridge)（首发思路）——本插件在其之上补齐了目录覆盖面（三家来源 + 项目级）、标准 YAML 解析、slug 化与 description 合成、Windows 路径正确性、诊断聚合与 32 个单测

## 许可证

[MIT](LICENSE)
