# 🈶 dsh-chinese-skill-patch

**🌐 [中文](README.md) · [English](docs/README.en.md)**

**让 DeepSeek Harness 原生支持中文技能名：`私家大厨` / `卡路里` / `作息管家` 无需改英文，`/私` 即补全，`/私家大厨` 直达，`skill({name:"私家大厨"})` 亦可。**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-chinese-skill-patch)](https://www.npmjs.com/package/dsh-chinese-skill-patch)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-orange.svg)](https://github.com/FeatherHunter/dsh-chinese-skill-patch)
[![platform](https://img.shields.io/badge/platform-DeepSeek%20Harness-1f6feb.svg)](https://github.com/deepseek-ai/deepseek-harness)

## 为什么需要这个

DSH 内置 `dsh-skill` 对 `SKILL.md` 的 `name` 字段只认

```js
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
```

`name: 私家大厨` 会在发现阶段被 `warn skipped`，`skill-catalog` 永远 `complete: false`，中文技能永远加载不到，输入框 `/私` 不补全、` /私家大厨` 强行回车也不触发、模型 `skill({name:"私家大厨"})` 抛 `invalid skill name`。

本插件在**不改 DSH 源码、不改你 `SKILL.md` 一个字符**的前提下，用 `^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u`（Unicode 字母+数字+中划线）打通三处硬编码：`dsh-skill` 校验、`dsh-skill-filesystem` 扫描、`dsh-tool-skill` 手势/工具。卸载即回退。

## 一条命令安装

需要 **DSH CLI**：

```bash
npm install -g @deepseek-ai/dsh
```

装进你的 profile（`web` 为默认桌面 profile）：

```bash
dsh plugin --profile web add dsh-chinese-skill-patch
```

**当前最新版本：`0.1.2`**（npm 徽章与[更新日志](#更新日志)同步）。

**零配置**：包内自带 `cordis.patch.yml`，`dsh plugin add` 自动写入 `dsh.profile.bundles`；`dsh plugin remove dsh-chinese-skill-patch` 干净卸载。重启 `dsh web`（或刷新页面）即生效。

> 源码注入（开发）：
> ```bash
> git clone https://github.com/FeatherHunter/dsh-chinese-skill-patch
> cd dsh-chinese-skill-patch && npm install && npm run build
> dev_inject_plugin file:$(pwd)   # 或 dsh-super-injector 的 dev_inject_plugin
> ```

## 它为你修了什么

| 输入 | 修复前 | 修复后 |
|---|---|---|
| `/私` | 无补全 | 下拉出现 `私家大厨`（`startsWith("私")`） |
| `/私家大厨` 回车 | 无匹配，`SKILL_GESTURE` 仅 `a-z0-9` | 命中 `CN_GESTURE`，`agent/pre-step` 注入 `<skill_content>` |
| `skill({name:"私家大厨"})` | `invalid skill name` | 正常加载，`content` 返回 |

已处理 `BOM`（`\uFEFF`）导致的 `---` 解析失败，兼容 `description: >` 折叠语法。

## 使用示例

在 `D:\3DeepSeekHarness\agents\xiaoshan\.dsh\skills\私家大厨\SKILL.md`（或任意 `~/.dsh/skills/私家大厨/SKILL.md`）：

```yaml
---
name: 私家大厨
description: 你的私家菜谱本。录菜、查菜、做菜、采购清单、烹饪历史一站管理。
whenToUse: 当用户说 私家大厨、录菜、做菜 时加载
---
# 私家大厨
...
```

目录名、中文 `name`、中文 `description` **完整保留**。`_chinese_skill_patch_list` 工具可验证：

```
> 调用 _chinese_skill_patch_list
→ {count: 73, skills: [{name:"私家大厨", provider:"chinese-skill-patch"}]}
```

## 工作原理

* **SkillRegistry 原型补丁**：`get`/`register`/`listLayerCandidates` 换成 `CN` 校验，`validateCandidateCN` 对非法候选中仅 `warn跳过` 而非让整层失败。
* **CN 感知 provider** `chinese-skill-patch`：复刻 `dsh-skill-filesystem` 的 `roots`（`findProjectRoot` + `~/.dsh/skills` + `~/.agents/skills`）与 `parseSkillFileCN`（优先 `yaml` 库，失败回退手写，`BOM` 已处理），`rank` 与原 filesystem 一致。
* **手势/工具**：`agent/pre-step` 新增 `CN_GESTURE` 分支（中文走新分支，英文走原分支）；全局注册 `skill` 工具的 `CN` 版，使模型侧亦可调用。
* **持久化**：`require.resolve` 动态定位 `dsh-skill/dsh-skill-filesystem/dsh-tool-skill` 的 `lib/index.js`，字符串替换为 `CN` 正则，幂等保护（已含 `/u` 则跳过），重启后即便不注入亦生效（下次 `DSH` 升级被覆盖时插件会重打）。

> 设计取舍：不再硬编码 `D:\3DeepSeekHarness\agents`；需全局可见请显式 `set DSH_AGENTS_DIR=D:\3DeepSeekHarness\agents` 或插件配置 `extraAgentsDir`，否则按标准 `cwd → projectRoot` 发现（`xiaoshan` 会话内 `/私` 自然可见）。

## 配置

```ts
// cordis 插件配置（可选）
{
  extraAgentsDir: "D:\\3DeepSeekHarness\\agents" // 把该目录下所有 .dsh/skills 也视为 project
}
```

或环境变量 `DSH_AGENTS_DIR`、`DSH_HOME`、`DSH_AGENTS_HOME`。

## 常见问题

**Q: 装了仍不补全？**  
`_chinese_skill_patch_list` 看 `count` 是否含中文；`dsh web` 是否已重启；`SKILL.md` 首行是否为 `---`（无 `BOM` 外多余空行）；`name` 是否完全匹配目录内 `SKILL.md` 的 `name`；最后一个常见原因：**在安装插件/新增技能之前已打开的旧会话里，`/` 菜单不会刷新**（DSH Web 按会话缓存技能目录，这是 DSH 自身行为，对所有技能含英文名一致）——**新开会话或刷新页面**（连接重置会清缓存）即可。注意：对话侧技能目录（`system-reminder` / `_chinese_skill_patch_list`）每轮都会刷新，不受旧会话影响。

**Q: 别人装能用吗？**  
能。`npm i dsh-chinese-skill-patch` 后 `dsh plugin add dsh-chinese-skill-patch`，无本机硬编码，`require.resolve` 自动适配各机器 `agent` 路径。`private` 已去，`files` 白名单仅 `lib` + `cordis.patch.yml`。

**Q: 卸载？**  
`dsh plugin --profile web remove dsh-chinese-skill-patch` 并重启；磁盘 `lib/index.js` 的 `CN` 正则会保留至下次 `DSH` 升级（不影响）。

## 开发

```bash
npm run typecheck  # tsc --noEmit
npm run build      # tsc → lib/
```

源码 `src/index.ts`（`@ts-nocheck`，含 `SKILL_NAME` 复刻校验与 `provider`/`pre-step`/`skill` 三补丁）。无 `client` 构建。

## 相关

* DSH 源码：`@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-skill-filesystem`、`@deepseek-ai/dsh-tool-skill`
* 上游：https://github.com/deepseek-ai/deepseek-harness
* 同作者：`dsh-prompt`（Prompt 工具箱）、`dsh-opencode-palette`（主题）

## 更新日志

- **0.1.2**（2026-08-22）：`#9` 排查结论落地 — ① peerDependencies 范围修正（`@deepseek-ai/dsh-tools` 显式带 prerelease 分支，消除 rc 版本 ERESOLVE）；② README FAQ 补充「旧会话菜单不刷新（DSH 会话级技能目录缓存）」说明；③ 新增 `scripts/test_rc2_dryrun.mjs` 回归测试（钉住磁盘补丁配方 vs 官方 npm rc.2 源码）；④ 新增相关插件导流与 ISSUE 引导。
- **0.1.1**（2026-08-20）：修复 `#1` — 左斜杠中文技能双次注入（`seq11/12 identical`）。以原生持久化 `CN_GESTURE` 为单一来源，插件仅在原生未支持时兜底，并对 `decision` 已有注入幂等去重，兼容 `inner/outer` 双顺序；新增 `session.jsonl` 集成回归与 5 场景去重测试。
- **0.1.0**：首发 — Unicode `[\p{L}0-9]` 打通 `dsh-skill/filesystem/tool-skill`，`BOM`/`>` 兼容，`_chinese_skill_patch_list` 验证。

## 许可

MIT — 与 `dsh-prompt` 一致。允许商用，需保留版权。

## 反馈与联系

> 🐞 **欢迎大家提交 [ISSUE](https://github.com/FeatherHunter/dsh-chinese-skill-patch/issues/new)**：遇到问题、有改进建议、想聊聊插件开发，都欢迎！
> 也可扫码通过飞书联系作者交流（提交 Issue 前建议先看[常见问题](#常见问题)）。

<p align="center">
  <img src="docs/assets/feishu-qr.png" alt="作者飞书二维码" width="280" />
</p>

## 相关插件（作者出品）

- 🎨 [dsh-opencode-palette](https://github.com/FeatherHunter/dsh-opencode-palette) — 看腻了默认皮肤？34 款 opencode 经典配色一键换肤（tokyonight / dracula / gruvbox / matrix…），即点即换
- ⚡ [dsh-prompt](https://github.com/FeatherHunter/dsh-prompt) — Prompt 工具箱：24 条深度模板随手点，`/prompt` 与智能推荐兜底，装好即用可自定义
- 🧠 [dsh-mattpocock-skills-deck](https://github.com/FeatherHunter/dsh-mattpocock-skills-deck) — Matt Pocock 技能游戏化任务系统：map 拨开迷雾，任务栏推进一步
- 🔬 [dsh-plugin-ui-debug](https://github.com/FeatherHunter/dsh-plugin-ui-debug) — 插件 UI 调试神器：让 AI 在真实 Chrome 里帮你看界面、点按钮、拖组件，一键安装零配置
- 🈶 dsh-chinese-skill-patch（本插件） — 让 DSH 原生支持中文技能名，`/私` 即补全

> 均已（或即将）收录于 [awesome-dsh-plugin 官方策展](https://awesome-dsh-plugin.com)，欢迎一键安装体验。
