# 🈶 dsh-chinese-skill-patch

**🌐 [中文](../README.md) · [English](README.en.md)**

**Make DeepSeek Harness natively support Chinese skill names: `私家大厨` / `卡路里` / `作息管家` — no renaming, `/私` completes to `私家大厨`, `/私家大厨` jumps directly, `skill({name:"私家大厨"})` works.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![npm](https://img.shields.io/npm/v/dsh-chinese-skill-patch)](https://www.npmjs.com/package/dsh-chinese-skill-patch)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-orange.svg)](https://github.com/FeatherHunter/dsh-chinese-skill-patch)
[![platform](https://img.shields.io/badge/platform-DeepSeek%20Harness-1f6feb.svg)](https://github.com/deepseek-ai/DeepSeek-Harness)

## Why

DSH's `dsh-skill` only accepts

```js
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
```

`name: 私家大厨` is `warn skipped` forever, `skill-catalog` never completes, Chinese skills never load, `/私` never completes and `/私家大厨` never triggers.

This plugin patches the three hard-coded spots with `^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u` without touching DSH source or your `SKILL.md`. Uninstall to revert.

## One-command install

Requires **DSH CLI**:

```bash
npm install -g @deepseek-ai/dsh
dsh plugin --profile web add dsh-chinese-skill-patch
```

Zero-config: `cordis.patch.yml` is bundled, `dsh plugin add` writes `dsh.profile.bundles` and `dsh plugin remove` cleans up. Restart `dsh web`.

> Dev (source inject):
> ```bash
> git clone https://github.com/FeatherHunter/dsh-chinese-skill-patch
> cd dsh-chinese-skill-patch && npm install && npm run build
> dev_inject_plugin file:$(pwd)
> ```

## What it fixes

| Input | Before | After |
|---|---|---|
| `/私` | no completion | dropdown shows `私家大厨` |
| `/私家大厨` Enter | no match | `CN_GESTURE` hits, `agent/pre-step` injects `<skill_content>` |
| `skill({name:"私家大厨"})` | `invalid skill name` | loads |

Handles `BOM` (`\uFEFF`) and `description: >` folded YAML.

## Example

In `D:\3DeepSeekHarness\agents\xiaoshan\.dsh\skills\私家大厨\SKILL.md` or `~/.dsh/skills/私家大厨/SKILL.md`:

```yaml
---
name: 私家大厨
description: Your private recipe book.
whenToUse: When user says 私家大厨
---
# 私家大厨
...
```

Keep directory, `name` and `description` in Chinese. Verify with `_chinese_skill_patch_list`.

## How it works

* **SkillRegistry prototype patch**: `get`/`register`/`listLayerCandidates` → `CN` validators, `validateCandidateCN` only warns and skips.
* **CN-aware provider** `chinese-skill-patch`: mirrors `dsh-skill-filesystem` roots (`findProjectRoot` + `~/.dsh/skills`) and `parseSkillFileCN` (`yaml` first, manual fallback, `BOM` stripped).
* **Gesture/tool**: `agent/pre-step` for `CN_GESTURE`; global `skill` tool (CN) for model.
* **Persistence**: `require.resolve` locates `dsh-skill/dsh-skill-filesystem/dsh-tool-skill` `lib/index.js` and replaces regex, idempotent (skips if already `/u`), survives restart until next DSH upgrade.

> No hard-coded `D:\3DeepSeekHarness\agents`; set `DSH_AGENTS_DIR` or plugin config `extraAgentsDir` if you need extra aggregated dirs globally.

## Config

```ts
{
  extraAgentsDir: "D:\\3DeepSeekHarness\\agents"
}
```

Or env `DSH_AGENTS_DIR`, `DSH_HOME`, `DSH_AGENTS_HOME`.

## FAQ

**Still no completion?** Check `_chinese_skill_patch_list`, restart `dsh web`, ensure first line is `---` and `name` matches.

**Will others get it?** Yes, `npm i` + `dsh plugin add dsh-chinese-skill-patch`, no hard-coded paths, `require.resolve` adapts.

## Development

```bash
npm run typecheck
npm run build  # tsc → lib/
```

Source `src/index.ts` (`@ts-nocheck`, three patches).

## Changelog

- **0.1.1** (2026-08-20): Fix #1 — double injection for Chinese slash gesture (`seq11/12 identical`). Single source via patched native `CN_GESTURE`, plugin falls back only when native not yet CN-capable, dedup against `decision` injections (both handler orders).
- **0.1.0**: Initial — Unicode `[\p{L}0-9]` across `dsh-skill/filesystem/tool-skill`, `BOM`/`>` compatible.

## License

MIT — same as `dsh-prompt`.
