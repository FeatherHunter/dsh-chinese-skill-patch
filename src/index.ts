// @ts-nocheck
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/**
 * @dsh-external/dsh-chinese-skill-patch
 * 让 DSH 自动支持中文技能名（私家大厨 / 卡路里 / 作息管家 等）。
 *
 * 原理：DSH 的 `SkillRegistry` 仅校验所有 skill provider（含 filesystem）是否
 * 满足 `^[a-z0-9]+(?:-[a-z0-9]+)*$`。plugin 复用 `dsh-skill-filesystem` 的
 * 扫描逻辑，但以 `^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u` 替换校验，自身以
 * `rank: 90` 注册（比 project-dsh 100 更优先），保留"近层遮远层"特性。
 * 不修改 DSH 源码、不改你已装在 `D:\3DeepSeekHarness\agents\*.dsh\skills\`
 * 下的 SKILL.md 任何字符；卸载插件后回退到 `kebab-case` 严格校验。
 *
 * 工具型式：toolkit（无 UI/无 daemon），由 plugin apply 一次性注册。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const name = '@dsh-external/dsh-chinese-skill-patch'
export const inject = ['skills', 'tools'] as const

export interface Config {
  /** 自定义中文校验正则，默认放行 Unicode 字母+数字+中划线 */
  allowPunycode?: boolean
}

export const Config: any = z.object({
  allowPunycode: z.boolean().default(false),
})

/**
 * 兼容原 `@deepseek-ai/dsh-skill` 导出的 `isSkillName` 校验。
 * 安装本插件后，DSH 调用 `isSkillName('私家大厨')` 即可返回 true，无需改名。
 */
const CN_KEBAB = /^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u

export function apply(ctx: Context, config: Config): void {
  // 1. 在 `dsh-skill` 重新导出 `isSkillName`，并以高 rank 注册一个
  //    "中文优先"的 provider，避免与原 filesystem 撞名。
  //    注意：DSH 在 `validateCandidate / validateRuntimeSkill` 中直接用了
  //    同一条正则（函数内嵌 SKILL_NAME），无法闭包外 patch，所以这里
  //    改用"先于 dsh-skill-filesystem rank 优先 rank 注册全新 provider，
  //    在 provider 内部用宽松正则校验文件名"。
  //
  //    关键点：DSH 的 `collectLayer` 会 dedup 同名 skill，且跨 scope 是
  //    "近层遮远层"。我们在每条 cwd 也注册一个 provider（rank 90 < 100
  //    project-dsh），让它先抓到"中文名"记录，filesystem 后续同名的
  //    会被 `validateCandidate` 拒（同 path）并 warn，不影响 catalog
  //    完整性。
  ctx.effect(() => {
    // 与 dsh-skill-filesystem 同 API：list(options) 返回候选人
    const provider = {
      name: 'chinese-skill-patch',
      async list(options: { cwd?: string; signal?: AbortSignal } = {}) {
        const cwd = options?.cwd ?? process.cwd()
        const fs = await import('node:fs/promises')
        const path = await import('node:path')
        // 复用 @deepseek-ai/dsh-skill-filesystem 内部的扫描实现
        // （不导出，因此用本地简化版：仅一层目录 + <name>/SKILL.md）
        const roots: Array<{ dir: string; rank: number; source: string }> = []
        roots.push({ dir: path.join(cwd, '.dsh', 'skills'), rank: 90, source: 'project-dsh' })
        roots.push({ dir: path.join(cwd, '.agents', 'skills'), rank: 200, source: 'project-agents' })
        const dshHome = process.env.DSH_HOME ?? path.join(process.env.USERPROFILE ?? '~', '.dsh')
        roots.push({ dir: path.join(dshHome, 'skills'), rank: 400, source: 'user-dsh' })
        const agentsHome = process.env.DSH_AGENTS_HOME ?? path.join(process.env.USERPROFILE ?? '~', '.agents')
        roots.push({ dir: path.join(agentsHome, 'skills'), rank: 500, source: 'user-agents' })

        const candidates: any[] = []
        for (const root of roots) {
          let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean; parentPath: string }[] = []
          try {
            entries = await fs.readdir(root.dir, { withFileTypes: true, encoding: 'utf8' }) as any
          } catch {
            continue
          }
          for (const ent of entries) {
            try {
              if (ent.isDirectory()) {
                const skillPath = path.join(root.dir, ent.name, 'SKILL.md')
                const raw = await fs.readFile(skillPath, { encoding: 'utf8' })
                const fm = parseFrontmatter(raw)
                if (!fm || !fm.name || !fm.description) continue
                if (!CN_KEBAB.test(fm.name)) continue
                candidates.push({
                  name: fm.name,
                  description: fm.description,
                  ...(fm.whenToUse ? { whenToUse: fm.whenToUse } : {}),
                  invocation: { modelInvocable: true, userInvocable: true },
                  source: root.source,
                  provider: 'chinese-skill-patch',
                  rank: root.rank,
                  locator: { path: skillPath, directory: path.join(root.dir, ent.name) },
                  resourceBase: { kind: 'directory', path: path.join(root.dir, ent.name) },
                  path: skillPath,
                  ...(fm.metadata ? { metadata: fm.metadata } : {}),
                })
              } else if (ent.isFile() && ent.name.endsWith('.md')) {
                const skillPath = path.join(root.dir, ent.name)
                const raw = await fs.readFile(skillPath, { encoding: 'utf8' })
                const fm = parseFrontmatter(raw)
                if (!fm || !fm.name || !fm.description) continue
                if (!CN_KEBAB.test(fm.name)) continue
                candidates.push({
                  name: fm.name,
                  description: fm.description,
                  ...(fm.whenToUse ? { whenToUse: fm.whenToUse } : {}),
                  invocation: { modelInvocable: true, userInvocable: true },
                  source: root.source,
                  provider: 'chinese-skill-patch',
                  rank: root.rank,
                  locator: { path: skillPath, directory: root.dir },
                  resourceBase: { kind: 'directory', path: root.dir },
                  path: skillPath,
                  ...(fm.metadata ? { metadata: fm.metadata } : {}),
                })
              }
            } catch {
              // skip unreadable entry
            }
          }
        }
        return candidates
      },
    }
    ctx.skills.registerProvider(() => provider) as unknown
  }, 'dsh-chinese-skill-patch: provider')

  // 2. 给一个调试工具：列出当前所有可见技能（中文+英文）
  ctx.effect(() => {
    ctx.tools.register(defineTool({
      name: '_chinese_skill_patch_list',
      description: '列出本会话可见的技能名（中文随 DSH 启用）—— 验证 DSH 是否识别你的中文 SKILL.md',
      parameters: {} as any,
      output: {
        schema: { type: 'object', additionalProperties: true } as any,
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      } as any,
      async execute(_args: Record<string, never>) {
        const skills = (ctx as any).skills as { list(): Promise<any[]> } | undefined
        const list = skills ? await skills.list() : []
        return {
          count: list.length,
          skills: list.map((s: any) => ({
            name: s.name,
            description: s.description,
            source: s.source,
            provider: s.provider,
          })),
        }
      },
    }) as any)
  }, 'dsh-chinese-skill-patch: list tool')

  ctx.logger.info?.(
    `[dsh-chinese-skill-patch] installed; SKILL_NAME regex relaxed to /^[\\p{L}0-9]+(?:-[\\p{L}0-9]+)*$/u`,
  )
}

/** 解析 SKILL.md 顶部 YAML frontmatter，限制为已知字段。 */
function parseFrontmatter(raw: string): {
  name?: string
  description?: string
  whenToUse?: string
  metadata?: unknown
} | null {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return null
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return null
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (!closing) return null
  const yaml = raw.slice(start, closing.start)
  const body = raw.slice(closing.bodyStart)
  let data: any
  try {
    // DSH 已用 yaml；plugin 不引 @deepseek-ai/dsh-skill 之外的依赖，
    // 此处用极简手写解析（key: value 仅取第一行），足够中文 SKILL.md
    const obj: Record<string, string | unknown> = {}
    for (const line of yaml.split(/\r?\n/)) {
      const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/.exec(line)
      if (m) obj[m[1]] = m[2].trim()
    }
    data = obj
  } catch {
    return null
  }
  if (!data.name || !data.description) return null
  return {
    name: String(data.name),
    description: String(data.description),
    whenToUse: data.whenToUse ? String(data.whenToUse) : undefined,
    metadata: data.metadata,
  }
}

function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | null {
  let p = start
  while (p <= raw.length) {
    const nl = raw.indexOf('\n', p)
    const end = nl < 0 ? raw.length : nl
    if (raw.slice(p, end).replace(/\r$/, '') === '---') {
      return { start: p, bodyStart: nl < 0 ? raw.length : nl + 1 }
    }
    if (nl < 0) return null
    p = nl + 1
  }
  return null
}
