# 票4 / Issue #6 — README & About 首屏吸引力审计（AFK 研究）

> **研究性质**：只做研究，不改代码。远程抓取真实 `README.md` 首屏与 `gh api repos/...` 的 `description` / `homepage` / `topics`，逐项判定是否具备「吸引新用户一键试用」能力。  
> **研究日期**：2026-08-20  
> **研究员**：wayfinder（AFK）  
> **关联 Issue**：[#6 票4：检查 GitHub README 和 About 是否吸引用户](https://github.com/FeatherHunter/dsh-chinese-skill-patch/issues/6) · 上游 [#2](https://github.com/FeatherHunter/dsh-chinese-skill-patch/issues/2)  
> **硬标准**（Issue #6 澄清版）：首屏价值主张一句说清中文技能痛点与收益、一键安装命令 `dsh plugin --profile web add dsh-chinese-skill-patch`、修复前后对比表、最小 `SKILL.md` 示例（`name: 私家大厨`）

---

## 1. 研究方法

- **主数据源**：远程 GitHub API（`gh api repos/FeatherHunter/dsh-chinese-skill-patch` 与 `.../contents/README.md`），非本地缓存推测。
- **辅助校验**：本地 `README.md`（`D:\dsh-plugin\dsh-chinese-skill-patch\README.md`）、`package.json` 的 `homepage`/`description`、`docs/README.en.md` 对照。
- **About 定义**：GitHub 仓库页右侧 About 区块 = `description` + `homepage` + `topics` + 默认分支/可见性。
- **判定粒度**：四要素逐项 `PASS` / `FAIL` / `PASS*`（通过但可优化），并给出不达标时的具体 `diff` 行。

---

## 2. 远程抓取证据（可复现）

### 2.1 About（`gh api repos/...`）

```bash
gh api repos/FeatherHunter/dsh-chinese-skill-patch \
  --jq '{description, homepage, topics, html_url}'
```

**2026-08-20 实测返回**：

```json
{
  "description": "让 DSH 原生支持中文技能名 · Make DSH discover Chinese skill names without renaming — /私 → 私家大厨 · More by @FeatherHunter: 🎨 dsh-opencode-palette · ⚡ dsh-prompt",
  "homepage": null,
  "html_url": "https://github.com/FeatherHunter/dsh-chinese-skill-patch",
  "topics": ["chinese","cjk","deepseek-harness","dsh","dsh-plugin","i18n","skill","skills","slash","unicode"]
}
```

- `description` 长度：`148` 字符（`gh api ... --jq '.description | length'`）。
- `homepage`：`null`（同时以 `--jq '.homepage'` 单字段复核为 `null`）。
- `topics` 数量：`10` 项，含 `dsh-plugin`。
- `updated_at`：`2026-08-20T07:51:16Z`，`default_branch`：`main`。

> 来源：`gh api repos/FeatherHunter/dsh-chinese-skill-patch`（GitHub REST API，`topics` 需 `mercy-preview` 头，当前 API 已直接返回）。

### 2.2 README 首屏（远程 `contents/README.md`）

```bash
gh api repos/FeatherHunter/dsh-chinese-skill-patch/contents/README.md \
  --jq '.content' | base64 -d | head -n 15
```

**远程与本地一致**（节选，第 1–10 行）：

```md
# 🈶 dsh-chinese-skill-patch

**🌐 [中文](README.md) · [English](docs/README.en.md)**

**让 DeepSeek Harness 原生支持中文技能名：`私家大厨` / `卡路里` / `作息管家` 无需改英文，`/私` 即补全，`/私家大厨` 直达，`skill({name:"私家大厨"})` 亦可。**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-chinese-skill-patch)](https://www.npmjs.com/package/dsh-chinese-skill-patch)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-orange.svg)](https://github.com/FeatherHunter/dsh-chinese-skill-patch)
[![platform](https://img.shields.io/badge/platform-DeepSeek%20Harness-1f6feb.svg)](https://github.com/deepseek-ai/deepseek-harness)
```

### 2.3 本地 `package.json` 对照

```json
{
  "homepage": "https://github.com/FeatherHunter/dsh-chinese-skill-patch#readme",
  "description": "让 DSH 自动支持中文技能名（私家大厨/卡路里/作息管家 等）| Make DeepSeek Harness discover Chinese SKILL.md without renaming — slash /私 → 私家大厨, /私家大厨 直达, skill({name:\"私家大厨\"}) 均可用"
}
```

`package.json` 的 `homepage` 已正确指向 `#readme`，但 **GitHub 仓库的 `homepage` 字段（About 外链）为 `null`**，未同步。

---

## 3. 硬标准逐项评审

### 3.1 README.md 四要素

| # | 硬标准 | 位置 | 判定 | 证据与备注 |
|---|--------|------|------|------------|
| R1 | **首屏价值主张一句说清中文技能痛点与收益** | `README.md:5` 加粗句 | **PASS** | `让 DeepSeek Harness 原生支持中文技能名：私家大厨/卡路里/作息管家 无需改英文，/私即补全，/私家大厨直达，skill({name:"私家大厨"})亦可。` 痛点（中文技能名需改英文才可用）与收益（斜杠补全/直达/模型调用）均在首屏一句内；附 `🈶` 标题与 badges 形成视觉锚点。**可优化**：句长约 52 字符，移动端折行；见 §4.1。 |
| R2 | **一键安装命令 `dsh plugin --profile web add dsh-chinese-skill-patch`** | `README.md:34-35` | **PASS** | 位于 `## 一条命令安装`，代码块精确匹配硬标准字符串（`--profile web` 显式）。前置 `npm install -g @deepseek-ai/dsh` 说明 DSH CLI 依赖，零配置与卸载说明完整。 |
| R3 | **修复前后对比表** | `README.md:49-53` | **PASS** | `## 它为你修了什么` 三列表 `输入 | 修复前 | 修复后`，覆盖 `/私` 无补全→有补全、`/私家大厨` 回车无匹配→`CN_GESTURE` 命中、`skill({name:"私家大厨"})` 抛错→正常加载。表格位于首屏下方 1 屏内可见。 |
| R4 | **最小 `SKILL.md` 示例（`name: 私家大厨`）** | `README.md:62-65` | **PASS** | `## 使用示例` 给出完整 frontmatter：`name: 私家大厨`、`description`、`whenToUse`，路径示例含 `~/.dsh/skills/私家大厨/SKILL.md` 与 `D:\3DeepSeekHarness\agents\xiaoshan\.dsh\skills\私家大厨\SKILL.md`，并声明目录名/name/description 完整保留 + `_chinese_skill_patch_list` 验证。 |

**README 小结**：**4/4 PASS**。首屏已具备一键试用说服力；主要风险不在缺失而在首句过长与对比表可读性。

### 3.2 About（`description` + `homepage` + `topics`）

| # | 硬标准 | 判定 | 证据与备注 |
|---|--------|------|------------|
| A1 | **description 是否吸引且一句说清** | **PASS*** | 当前 `让 DSH 原生支持中文技能名 · Make DSH discover Chinese skill names without renaming — /私 → 私家大厨 · More by @FeatherHunter: 🎨 dsh-opencode-palette · ⚡ dsh-prompt`（148 字符）痛点/收益/case 均有，且双语。但 **尾部 `More by ...` 在 GitHub 移动端/卡片分享时被截断**（GitHub About 描述在搜索结果与社交卡片约 100–120 字符后省略），建议缩短；见 §4.2。 |
| A2 | **homepage 是否设置** | **FAIL** | `homepage: null`。仓库页右侧 About 不显示外链，新用户无法一键跳 npm/README 锚点。`package.json` 已有 `homepage` 但未同步到 GitHub。需补。 |
| A3 | **topics 是否含 `dsh-plugin` 且覆盖发现关键词** | **PASS** | `10` 项：`chinese, cjk, deepseek-harness, dsh, dsh-plugin, i18n, skill, skills, slash, unicode`。`dsh-plugin` 存在，利于 `awesome-dsh-plugin` 与 GitHub topic 搜索发现；`dsh`/`deepseek-harness` 双覆盖。**可优化**：可追加 `deepseek`（`package.json keywords` 已有）以对齐 npm 关键词，但非硬标准。 |

**About 小结**：**2 PASS* + 1 FAIL**。唯一硬性不达标为 `homepage` 为空。

### 3.3 英文 README 对齐

`docs/README.en.md` 同步包含四要素英文版（首句 `Make DeepSeek Harness natively support Chinese skill names ...`、One-command install、What it fixes 表、Example `name: 私家大厨`），与中文版一致，利于非中文用户。

---

## 4. 改写建议（仅建议，不在本票执行）

> 本票为 **AFK 研究**，按任务要求 **不改代码**。以下 `diff` 供负责改写的票（Issue #6 验收阶段）直接应用。

### 4.1 README 首句（可选收紧）

当前（`README.md:5`）已 PASS，若追求更强一句说清，可将 52 字符压缩为 **痛点→方案→收益** 三段式，并保留 code 锚点：

```diff
- **让 DeepSeek Harness 原生支持中文技能名：`私家大厨` / `卡路里` / `作息管家` 无需改英文，`/私` 即补全，`/私家大厨` 直达，`skill({name:"私家大厨"})` 亦可。**
+ **让 DeepSeek Harness 原生支持中文技能名——`私家大厨`等无需改英文，`/私` 即补全、`/私家大厨` 直达、`skill({name:"私家大厨"})` 亦可。**
```

或更短（≤40 字符主句 + 副句注释）：

```md
**DSH 中文技能名即装即用：`/私` 补全 `私家大厨`，`skill({name:"私家大厨"})` 亦可，无需改英文。**（副句：覆盖 `卡路里` / `作息管家`，卸载即回退）
```

**理由**：首屏首句在 GitHub 折叠预览与社交卡片中权重最高，缩短可避免移动端 2 行截断。

### 4.2 `description`（建议缩短至 ≤120 字符）

当前 148 字符，GitHub 在列表页截断。建议：

```diff
- 让 DSH 原生支持中文技能名 · Make DSH discover Chinese skill names without renaming — /私 → 私家大厨 · More by @FeatherHunter: 🎨 dsh-opencode-palette · ⚡ dsh-prompt
+ 让 DSH 原生支持中文技能名 · /私 → 私家大厨，无需改英文 · Make DSH discover Chinese skills — no renaming
```

- 保留：中文痛点 + `/私 → 私家大厨` 收益锚点 + 英文关键词（利于 GitHub 搜索 `chinese skill`）。
- 移除：尾部 `More by ...`（作者关联可由 `topics` 与 README 底部 `同作者` 承担，About 描述应聚焦本仓库）。

若需保留作者关联，改为 `homepage` 承载（见 4.3），而非挤占 `description`。

### 4.3 `homepage`（**必补**，FAIL 修复）

执行其一即可（推荐 npm，便于一键安装闭环）：

```bash
# 方案 A — 指向 npm（推荐，新用户一键试用路径最短）
gh repo edit FeatherHunter/dsh-chinese-skill-patch --add-homepage https://www.npmjs.com/package/dsh-chinese-skill-patch

# 方案 B — 指向 README 锚点（与 package.json 一致）
gh repo edit FeatherHunter/dsh-chinese-skill-patch --add-homepage https://github.com/FeatherHunter/dsh-chinese-skill-patch#readme

# 方案 C — API 直写
gh api repos/FeatherHunter/dsh-chinese-skill-patch -X PATCH -f homepage="https://www.npmjs.com/package/dsh-chinese-skill-patch"
```

**验证**：

```bash
gh api repos/FeatherHunter/dsh-chinese-skill-patch --jq '{description, homepage, topics}'
# 预期 homepage 非 null
```

### 4.4 `topics`（可选）

```diff
  topics: [chinese, cjk, deepseek-harness, dsh, dsh-plugin, i18n, skill, skills, slash, unicode]
+ topics: [chinese, cjk, deepseek-harness, dsh, dsh-plugin, deepseek, i18n, skill, skills, slash, unicode]
```

增加 `deepseek` 以对齐 `package.json keywords`，提升 `deepseek` 关键词搜索命中。

### 4.5 对比表可读性（可选）

当前表头 `输入 | 修复前 | 修复后` 可加 emoji 强化扫视：

```diff
- | 输入 | 修复前 | 修复后 |
+ | 输入 | 修复前 ❌ | 修复后 ✅ |
```

---

## 5. 一键试用路径走查

以新用户视角（未装过本插件）：

1. 搜索或点入 GitHub 仓库 → 首屏即见 **中文技能痛点 + `/私` 补全** 加粗句 + badges（信任感）。
2. 向下半屏即见 **`dsh plugin --profile web add dsh-chinese-skill-patch`** 可复制命令（无需翻页）。
3. 对比表在 1 屏内回答「装了有啥用」。
4. `SKILL.md` 示例可直接复制建 `~/.dsh/skills/私家大厨/SKILL.md`。
5. **断点**：About 无 `homepage`，点击仓库标题无法直达 npm，手机端用户需自行拼 `npm view`。

---

## 6. 结论

- **README.md**：**PASS 4/4**，已具备吸引新用户一键试用的完整首屏。改写非必需，仅建议收紧首句与表头以提升扫视效率。
- **About**：**2/3 PASS，1 FAIL（`homepage: null`）**。`description` 与 `topics` 已达标，`homepage` 为唯一硬性缺口，补上即满足 Issue #6 硬标准。
- **下一动作**（非本研究票执行）：由负责改写的执行票应用 §4.3 的 `homepage` 修复，并可选应用 §4.2 的 `description` 缩短，然后以 `gh api repos/... --jq` 复核贴图关闭 #6。

---

## 7. 附录：复现命令清单

```bash
# About
gh api repos/FeatherHunter/dsh-chinese-skill-patch --jq '{description, homepage, topics}'
gh api repos/FeatherHunter/dsh-chinese-skill-patch --jq '.description | length'
gh api repos/FeatherHunter/dsh-chinese-skill-patch --jq '.homepage'

# README 远程
gh api repos/FeatherHunter/dsh-chinese-skill-patch/contents/README.md --jq '.content' | base64 -d | head -n 20

# 本地对照
cat README.md | head -n 15
cat package.json | jq '{homepage, description}'
```

---

*本文件仅为研究产出，未修改 `README.md` / `description` / `homepage` / `topics` 任何代码或配置。*
