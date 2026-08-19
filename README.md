# @dsh-external/dsh-chinese-skill-patch

> **让 DSH（DeepSeek Harness）自动支持中文技能名** —— `私家大厨` / `卡路里` / `作息管家` 等中文 `SKILL.md` 无需改英文即可被 `dsh-skill` 发现和加载。

## 为什么需要这个

DSH 内置的 `dsh-skill` 包对技能名（`SKILL.md` 的 `name:` 字段）只接受严格的 `kebab-case`：

```js
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
```

这意味着你写的中文 `name: 私家大厨` 会在发现阶段直接被 `warn skipped`，`skill-catalog` 始终 `complete: false`，中文技能**永远加载不到**。

本插件以**新 provider** 方式（不修改 DSH 源码）注入一个 `rank: 90` 的扫描器，使用更宽松的 `^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u`（Unicode 字母 + 数字 + 中划线）做校验。**中文/日文/俄文**等都能通过；同时你现有的 `dsh-skill-filesystem`（`rank: 100`）会被"近层遮远层"机制自动遮蔽，不会重复报错。

## 工作原理

| 组件 | 行为 |
|---|---|
| `SkillRegistry.collectLayer` | 在每个 layer 内对同名 skill 保留"首个出现者" |
| `chinese-skill-patch` provider (`rank: 90`) | 先于 `dsh-skill-filesystem` (`rank: 100`) 抓到中文名候选 |
| `dsh-skill-filesystem` (`rank: 100`) | 后续同 path 候选因 `validateCandidate` 失败被 `warn skipped`，不影响 catalog |

> 一句话：**我加了一个 "Chinese-first" 的扫描器，原 filesystem 退化为兜底**，整个 `skill-catalog` 仍 `complete: true`，中文技能正常出现在 `ctx.skills.list()`。

## 安装

```bash
# 在 DSH 注入器环境（已 dsh-plugin 安装）执行：
dev_inject_plugin file:/path/to/dsh-chinese-skill-patch
# 或发布后：
dsh plugin --profile web add @dsh-external/dsh-chinese-skill-patch
```

安装后**重启 `dsh web`**，下次扫描到中文 `SKILL.md` 即生效。

## 使用示例

在你的工作区 `D:\3DeepSeekHarness\agents\xiaoshan\.dsh\skills\私家大厨\SKILL.md`：

```yaml
---
name: 私家大厨
description: 你的私家菜谱本。录菜、查菜、做菜、采购清单、烹饪历史一站管理。
whenToUse: 当用户说 私家大厨、录菜、做菜、查菜谱、采购清单 时加载
---
# 私家大厨
...
```

**完整保留中文目录名 + 中文 name 字段 + 中文 description**。卸载插件后才会回退到 `kebab-case` 严格模式。

## 调试

DSH 内已注册一个工具 `_chinese_skill_patch_list` 用于验证当前可见技能：

```
> 调用 _chinese_skill_patch_list
→ 列出所有 rank 命中的技能（中文+英文），含 source / provider
```

## 范围

*   ✅ 不改 DSH 源码
*   ✅ 不改你 `D:\3DeepSeekHarness\agents\*.dsh\skills\*.md` 任何字符
*   ✅ 卸载插件即回退到原 DSH 行为
*   ✅ 跟 `dsh-skill-filesystem` 共存（同 path 中文名会"先到先得"）
*   ⚠️ 升级 DSH 时若 `SkillRegistry.collectLayer` 改签名，本插件会失效（需更新）

## 限制

*   仅对 `SKILL.md` 顶部的 `name` 字段生效；目录名可保持中文（DSH 不限制目录名）
*   不改 DSH 闭包内 `SKILL_NAME` 常量；只对**新发现**的中文候选开放
*   同名英文技能仍由原 `dsh-skill-filesystem` 处理
*   若你的中文字符与 DSH 模型上下文中的 tokenization 冲突，可能需要额外的 `whenToUse` 提示

## 开源协议

BSD-3-Clause — 与 DSH 官方插件包一致。允许商业/闭源使用，需保留版权与免责声明。

## 相关资源

*   DSH 源码：`@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-skill-filesystem`
*   上游规范：<https://github.com/deepseek-ai/deepseek-harness>
*   本插件在 `D:\dsh-plugin\dsh-chinese-skill-patch` 维护
