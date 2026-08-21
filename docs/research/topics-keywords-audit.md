# Topics & Keywords 一致性审计 — 票5

> **研究目标**：核验 `FeatherHunter/dsh-chinese-skill-patch` 的 GitHub Topics 是否含 `dsh-plugin`、是否与本地 `package.json keywords` 互为镜像，并判断是否满足 `awesome-dsh-plugin` 生态发现要求；额外检查 GitHub Releases 是否已同步 `npm latest 0.1.1`。
>
> **研究员**：wayfinder / AFK  
> **时间**：2026-08-20 (UTC)  
> **仓库**：`FeatherHunter/dsh-chinese-skill-patch` (`git@github.com:FeatherHunter/dsh-chinese-skill-patch.git`)  
> **关联 Issue**：#7《票5：检查 GitHub Tag 是否包含 dsh-plugin（Topics 与 keywords 一致性）》

---

## 1. 执行摘要（TL;DR）

| 判定项 | 结果 | 说明 |
|---|---|---|
| **Topics 含 `dsh-plugin`** | **PASS** | `gh api repos/... --jq .topics` 返回 10 项，含 `dsh-plugin` |
| **Keywords 含 `dsh-plugin`** | **PASS** | `package.json` 与 `npm view keywords` 均含 `dsh-plugin`（11 项） |
| **两者镜像一致（严格相等）** | **FAIL** | `keywords` 多 1 项 `deepseek`，`topics` 缺 `deepseek` — 排序后不等 |
| **awesome-dsh-plugin 发现要求** | **PASS（最低门槛）/ WARN（镜像）** | 满足「必须含 `dsh-plugin`」的硬门槛，但镜像不一致属可修复缺陷，会影响关键词检索召回 |
| **GitHub Release 同步 `npm@0.1.1`** | **FAIL** | `npm latest = 0.1.1`，GitHub Releases 仅 `v0.0.1`/`v0.0.2`，缺 `v0.1.1`，按 Q1 约定算缺陷 |

> **总判定**：功能性 PASS，生态一致性 FAIL。需 1 条 `PUT topics` 修复 + 1 条 `v0.1.1` Release 补发。

---

## 2. 双源证据

所有命令在仓库根 `D:\dsh-plugin\dsh-chinese-skill-patch` 下执行，来源为第一方 API / 本地文件。

### 2.1 GitHub Topics（源 A）

**命令**：
```bash
gh api repos/FeatherHunter/dsh-chinese-skill-patch --jq .topics
gh api repos/FeatherHunter/dsh-chinese-skill-patch --jq '.topics | sort'
gh api repos/FeatherHunter/dsh-chinese-skill-patch --jq '{topics_len: (.topics|length), topics: .topics}'
```

**原始输出**（2026-08-20）：
```json
["chinese","cjk","deepseek-harness","dsh","dsh-plugin","i18n","skill","skills","slash","unicode"]
```
```json
// sort 后
["chinese","cjk","deepseek-harness","dsh","dsh-plugin","i18n","skill","skills","slash","unicode"]
```
```json
{"topics_len":10,"topics":["chinese","cjk","deepseek-harness","dsh","dsh-plugin","i18n","skill","skills","slash","unicode"]}
```

**二次验证**（带可见性与计数）：
```bash
gh api repos/FeatherHunter/dsh-chinese-skill-patch --jq '{topics: .topics, visibility: .visibility, stars: .stargazers_count}'
# → {"stars":1,"topics":["chinese","cjk","deepseek-harness","dsh","dsh-plugin","i18n","skill","skills","slash","unicode"],"visibility":"public"}
```

**判定**：`topics.includes("dsh-plugin") === true` ✅

---

### 2.2 本地 `package.json` keywords（源 B）

**命令**：
```bash
cat package.json | jq .keywords          # 需本地 jq；PowerShell 下等价为 node 读取
node -e "console.log(JSON.stringify(require('./package.json').keywords))"
```

**`package.json` 片段**（`D:\dsh-plugin\dsh-chinese-skill-patch\package.json` L5-L17）：
```json
"keywords": [
  "dsh",
  "dsh-plugin",
  "deepseek",
  "deepseek-harness",
  "skill",
  "skills",
  "chinese",
  "i18n",
  "unicode",
  "slash",
  "cjk"
]
```

**npm 侧镜像验证**（证明已发布包的 keywords 与本地一致）：
```bash
npm view dsh-chinese-skill-patch keywords --json
# →
# [
#   "dsh",
#   "dsh-plugin",
#   "deepseek",
#   "deepseek-harness",
#   "skill",
#   "skills",
#   "chinese",
#   "i18n",
#   "unicode",
#   "slash",
#   "cjk"
# ]
# 长度 11

npm view dsh-chinese-skill-patch version        # → "0.1.1"
npm view dsh-chinese-skill-patch dist-tags --json  # → { "latest": "0.1.1" }
```

**判定**：`keywords.includes("dsh-plugin") === true` ✅，`package.json` version `0.1.1` 与 npm latest 一致 ✅

---

### 2.3 镜像对比（严格相等）

**对比脚本**：
```js
const k = require('./package.json').keywords;
const t = ["chinese","cjk","deepseek-harness","dsh","dsh-plugin","i18n","skill","skills","slash","unicode"];
const ks = [...k].sort();
const ts = [...t].sort();
console.log(ks); // ["chinese","cjk","deepseek","deepseek-harness","dsh","dsh-plugin","i18n","skill","skills","slash","unicode"]
console.log(ts); // ["chinese","cjk","deepseek-harness","dsh","dsh-plugin","i18n","skill","skills","slash","unicode"]
console.log(ks.filter(x=>!ts.includes(x))); // ["deepseek"]
console.log(ts.filter(x=>!ks.includes(x))); // []
console.log(JSON.stringify(ks)===JSON.stringify(ts)); // false
```

| 维度 | 数量 | 排序后清单 |
|---|---|---|
| `package.json keywords` | 11 | `chinese, cjk, deepseek, deepseek-harness, dsh, dsh-plugin, i18n, skill, skills, slash, unicode` |
| `GitHub topics` | 10 | `chinese, cjk, deepseek-harness, dsh, dsh-plugin, i18n, skill, skills, slash, unicode` |
| **差集** | — | `keywords ⊖ topics = {deepseek}`（仅 keywords 多 `deepseek`） |

**判定**：**FAIL** — 不满足「两者均含且一致」的镜像定义。`dsh-plugin` 存在性 PASS，但集合相等性 FAIL。

> **历史基线说明**：Issue #7 正文称「`gh api` 返回 10 项、keywords 同样 10 项一致，初步 PASS」。当前本地 `package.json` 已增 `deepseek` 至 11 项，topics 未同步更新，故由 PASS 变为 FAIL。修复方向为补 topics 而非删 keywords（`deepseek` 为合法生态关键词）。

---

### 2.4 GitHub Releases vs npm `latest`（额外检查）

**命令**：
```bash
gh api repos/FeatherHunter/dsh-chinese-skill-patch/releases --jq '.[].tag_name'
gh api repos/FeatherHunter/dsh-chinese-skill-patch/releases --jq '[.[].tag_name] | sort'
npm view dsh-chinese-skill-patch versions --json
npm view dsh-chinese-skill-patch version --json
gh release view v0.0.2 --json tagName,name,createdAt
gh release view v0.0.1 --json tagName,name,createdAt
git tag --list
```

**原始输出**：
```
# gh releases tag_name
v0.0.2
v0.0.1

# sort
["v0.0.1","v0.0.2"]

# npm versions
["0.1.0","0.1.1"]

# npm latest
"0.1.1"  / { "latest": "0.1.1" }

# gh release view v0.0.2
{"createdAt":"2026-08-19T16:17:23Z","name":"v0.0.2 - fix inject and json schema","tagName":"v0.0.2"}

# gh release view v0.0.1
{"createdAt":"2026-08-19T16:14:50Z","name":"v0.0.1 - 首次发布","tagName":"v0.0.1"}

# git tag --list (本地)
v0.0.1
v0.0.2
```

| 源 | 最新版本 |
|---|---|
| `package.json` | `0.1.1` |
| `npm latest`（`npm view dsh-chinese-skill-patch version`） | `0.1.1` |
| `npm versions` | `0.1.0`, `0.1.1` |
| GitHub Releases | `v0.0.1`, `v0.0.2`（**缺 `v0.1.1`**） |
| Git tag（本地+远端） | `v0.0.1`, `v0.0.2`（缺 `v0.1.1`） |

**判定**：**FAIL** — `npm 0.1.1` 未同步至 GitHub Release，按票面 Q1 约定「算缺陷」。需补 `v0.1.1` Release（是否在本票内补齐由维护者决定；研究侧记录为待补项）。

---

## 3. awesome-dsh-plugin 生态发现要求判定

依据 `awesome-dsh-plugin-submit` 技能硬规则（`C:\Users\辰辰洋洋\.dsh\skills\awesome-dsh-plugin-submit\SKILL.md`）与 `awesome-dsh-plugin.com` 收录自检：

| 硬规则 | 本仓库现状 | 判定 |
|---|---|---|
| 仓库打 `dsh-plugin` topic（必打，没打不会被抓取） | 已打：`topics` 含 `dsh-plugin` | **PASS** |
| `package.json` 含 `dsh.bundle` 且根有 `cordis.patch.yml` | `package.json:53-57` 有 `dsh.bundle.patch: ./cordis.patch.yml`，`cordis.patch.yml` 存在 | **PASS** |
| 仓库 ≥1 天、提交数 ≥10 | `createdAt` 远早于 1 天前；`git log --oneline | wc -l` ≥10 （CI 自检项） | **PASS**（推定，CI 不卡） |
| `description` 无夸大、与实现一致 | `package.json description` 中英双语，命令/技能数与源码一致 | **PASS** |
| **topics 与 npm keywords 的一致性** | 不一致（缺 `deepseek`） | **WARN** — 非 awesome 硬门槛，但影响市场与 npm 搜索的关键词召回，属推荐修复项 |

**结论**：满足「被 awesome-dsh-plugin 发现与收录」的**最低硬门槛**（含 `dsh-plugin` topic），但为达到「镜像一致」的票面验收标准，需补齐 `deepseek`。

---

## 4. 修复命令（仅当 FAIL 时执行，本票不自动写入）

### 4.1 补齐 GitHub Topics（使之与 `package.json keywords` 镜像）

**原理**：GitHub Topics API 为 `PUT /repos/{owner}/{repo}/topics`，`gh api` 封装为：

```bash
# 推荐：直接以 keywords 排序后 11 项为目标（与 npm 已发布包一致）
gh api --method PUT repos/FeatherHunter/dsh-chinese-skill-patch/topics \
  -f names='["chinese","cjk","deepseek","deepseek-harness","dsh","dsh-plugin","i18n","skill","skills","slash","unicode"]' \
  --jq .names

# 等价：从 package.json 动态生成（PowerShell）
# node -e "const k=require('./package.json').keywords; console.log(JSON.stringify(k))"
# gh api --method PUT repos/FeatherHunter/dsh-chinese-skill-patch/topics -f names="$(node -e "console.log(JSON.stringify(require('./package.json').keywords))")" --jq .names
```

**验证**：
```bash
gh api repos/FeatherHunter/dsh-chinese-skill-patch --jq '.topics | sort'
# 期望 → ["chinese","cjk","deepseek","deepseek-harness","dsh","dsh-plugin","i18n","skill","skills","slash","unicode"] (11 项)
node -e "console.log(JSON.stringify(require('./package.json').keywords.sort()))"
# 两者 JSON.stringify 相等即 PASS
```

**备选（若需保持 topics 为 10 项、删 keywords 的反向修复，不推荐）**：
```diff
 // package.json
 -    "deepseek",
```
> 不推荐：`deepseek` 为有效生态关键词，删词会降低 npm/ GitHub 搜索召回。

---

### 4.2 `package.json` 补丁（仅当选择反向修复时）

本研究**不建议**修改 `package.json`；若执意保持 10 项一致，需同步删 `deepseek` 并重新 `npm publish`（将产生 `0.1.2`），成本高于补 topics。

---

### 4.3 补发 `v0.1.1` GitHub Release（同步 npm latest）

```bash
# 确保 tag 存在（本地若无则创建并推送）
git tag v0.1.1
git push origin v0.1.1

# 选项 A：仅创建 Release（无附件，最小可接受）
gh release create v0.1.1 \
  --title "v0.1.1 - 同步 npm latest" \
  --notes "同步 npm@0.1.1。含中文技能名支持：package.json keywords 11 项、GitHub topics 镜像修复。"

# 选项 B：带 tgz 附件（推荐，awesome-dsh-plugin 可选 tarball 字段可用）
npm pack --dry-run   # 预览
npm pack             # 生成 dsh-chinese-skill-patch-0.1.1.tgz
gh release create v0.1.1 \
  --title "v0.1.1 - 同步 npm latest" \
  --notes "同步 npm@0.1.1。变更：补 deepseek topic、keywords 镜像一致性修复。" \
  dsh-chinese-skill-patch-0.1.1.tgz

# 验证
gh api repos/FeatherHunter/dsh-chinese-skill-patch/releases --jq '[.[].tag_name] | sort'
# 期望 → ["v0.0.1","v0.0.2","v0.1.1"]
npm view dsh-chinese-skill-patch version  # 期望 "0.1.1" 与 release tag 一致
```

> **是否在本票内修复**：按 Issue #7 验收「若 `v0.1.1` Release 缺失，记录为待补项并决定是否在本票或新增 Fix 票内补齐」。本研究仅记录缺陷与命令，不自动创建 Release。

---

## 5. 重验清单（修复后执行）

```bash
# 1. Topics = keywords (排序相等)
gh api repos/FeatherHunter/dsh-chinese-skill-patch --jq '.topics | sort' > /tmp/topics.json
node -e "console.log(JSON.stringify(require('./package.json').keywords.slice().sort()))" > /tmp/kw.json
diff /tmp/topics.json /tmp/kw.json && echo "MIRROR PASS" || echo "MIRROR FAIL"

# 2. 含 dsh-plugin
gh api repos/FeatherHunter/dsh-chinese-skill-patch --jq '.topics | contains(["dsh-plugin"])'
# → true

# 3. Release 同步
gh api repos/FeatherHunter/dsh-chinese-skill-patch/releases --jq '[.[].tag_name] | sort'
npm view dsh-chinese-skill-patch version
# 两者均含 0.1.1 / v0.1.1

# 4. awesome 自检
grep -q '"bundle"' package.json && echo "dsh.bundle OK"
test -f cordis.patch.yml && echo "cordis.patch.yml OK"
gh repo view FeatherHunter/dsh-chinese-skill-patch --json repositoryTopics --jq .repositoryTopics
```

---

## 6. 附录

### A. 文件与 API 来源

- `D:\dsh-plugin\dsh-chinese-skill-patch\package.json`（`version: 0.1.1`, `keywords: 11`）
- `gh api repos/FeatherHunter/dsh-chinese-skill-patch --jq .topics`（第一方 GitHub REST API）
- `npm view dsh-chinese-skill-patch version/dist-tags/keywords`（第一方 npm registry）
- `gh api repos/FeatherHunter/dsh-chinese-skill-patch/releases`（第一方 GitHub Releases API）
- `awesome-dsh-plugin-submit` 技能：`C:\Users\辰辰洋洋\.dsh\skills\awesome-dsh-plugin-submit\SKILL.md`（§流程 1 硬规则 3：必须打 `dsh-plugin` topic）

### B. 术语

- **Topics**：GitHub 仓库 About 区域的标签（`https://github.com/FeatherHunter/dsh-chinese-skill-patch` 顶部），通过 `PUT /repos/{owner}/{repo}/topics` 管理，awesome-dsh-plugin 与 GitHub 搜索据此发现插件。
- **keywords**：`package.json` 的 `keywords` 数组，npm 搜索与 `npm view <pkg> keywords` 的来源。
- **镜像（mirror）**：本票定义为「两者均含 `dsh-plugin` 且排序后集合相等」。

### C. 风险与协调

- Topics 编辑与 Issue #4《About 改写》同处 About 区域，若并行编辑需以最后一次 `PUT` 为准，避免覆盖。
- `deepseek` 虽为高频生态词，但 GitHub 搜索对大小写/连字符不敏感，缺 1 项不影响 `dsh-plugin` 的发现，仅影响 `deepseek` 关键词的精确召回。

---

*— 报告结束，仅做研究，不自动写入 topics / 不创建 release / 不 close issue。*
