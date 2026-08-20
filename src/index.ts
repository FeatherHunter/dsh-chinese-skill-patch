// @ts-nocheck
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/**
 * @dsh-external/dsh-chinese-skill-patch
 * 让 DSH 自动支持中文技能名（私家大厨 / 卡路里 / 作息管家 等）。
 *
 * 根因：DSH 三处硬编码只接受 kebab-case ascii:
 *   1. dsh-skill: SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
 *      - validateCandidate / validateRuntimeSkill / validateDefinition / SkillRegistry.get
 *   2. dsh-skill-filesystem: parseSkillFile -> isSkillName(name) -> warn skipped
 *   3. dsh-tool-skill: SKILL_GESTURE + skill tool isSkillName 检查
 *      - 输入框 /私 不能匹配，模型 skill({name:"私家大厨"}) 被拒
 *
 * 修复：
 *  - 运行时：直接改写 SkillRegistry 原型方法（get/register/listLayerCandidates）为 CN 版，
 *    并注册一个 CN 感知的 filesystem provider（chinese-skill-patch）来补齐中文发现；
 *    再加一个 agent/pre-step 对 CN_GESTURE 的注入，实现 /私家大厨 直达。
 *  - 持久化：把 agent/node_modules 下三文件的正则改成 CN 版，重启后即使不注入也生效。
 */

export const name = 'dsh-chinese-skill-patch'
export const inject = ['skills', 'tools'] as const

export interface Config {
  allowPunycode?: boolean
  /** 额外 agents 聚合目录（如 D:\3DeepSeekHarness\agents），用于把其子目录的 .dsh/skills 也纳入发现；不设则不扫描，避免硬编码 */
  extraAgentsDir?: string
}
export const Config: any = z.object({
  allowPunycode: z.boolean().default(false),
  extraAgentsDir: z.string().required(false),
})

const CN_KEBAB = /^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u
const CN_GESTURE = /(^|\s)\/([\p{L}0-9]+(?:-[\p{L}0-9]+)*)(?=\s|$)/gu
// 用于检测是否需要补丁的旧正则字符串
const OLD_SKILL_NAME_SRC = '^[a-z0-9]+(?:-[a-z0-9]+)*$'
const OLD_GESTURE_SRC = '(^|\\s)\\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\\s|$)'

function isCN(name: string): boolean {
  return CN_KEBAB.test(name)
}

// ---------- 辅助：复刻 dsh-skill 内部校验（仅把 name 校验换成 CN） ----------
function validateInvocation(inv: any, subject: string) {
  if (inv === undefined) return
  if (typeof inv !== 'object' || inv === null || Array.isArray(inv)) throw new TypeError(`${subject} with a non-object invocation policy`)
  if (typeof inv.modelInvocable !== 'boolean') throw new TypeError(`${subject} with a non-boolean invocation.modelInvocable`)
  if (typeof inv.userInvocable !== 'boolean') throw new TypeError(`${subject} with a non-boolean invocation.userInvocable`)
}
function validateCandidateCN(candidate: any, providerName: string) {
  if (typeof candidate.name !== 'string') throw new TypeError(`skill provider "${providerName}" returned a non-string skill name`)
  if (!CN_KEBAB.test(candidate.name)) throw new Error(`skill provider "${providerName}" returned invalid skill name "${candidate.name}"`)
  if (typeof candidate.description !== 'string') throw new TypeError(`skill provider "${providerName}" returned skill "${candidate.name}" with a non-string description`)
  if (candidate.description.length === 0) throw new Error(`skill provider "${providerName}" returned skill "${candidate.name}" without a description`)
  validateInvocation(candidate.invocation, `skill provider "${providerName}" returned skill "${candidate.name}"`)
  if (candidate.whenToUse !== undefined && typeof candidate.whenToUse !== 'string') throw new TypeError(`skill provider "${providerName}" returned skill "${candidate.name}" with a non-string whenToUse`)
  if (typeof candidate.source !== 'string') throw new TypeError(`skill provider "${providerName}" returned skill "${candidate.name}" with a non-string source`)
  if (typeof candidate.rank !== 'number' || !Number.isFinite(candidate.rank)) throw new Error(`skill provider "${providerName}" returned skill "${candidate.name}" with an invalid rank`)
  if (typeof candidate.provider !== 'string') throw new TypeError(`skill provider "${providerName}" returned skill "${candidate.name}" with a non-string provider`)
  if (candidate.provider !== providerName) throw new Error(`skill provider "${providerName}" returned skill "${candidate.name}" for provider "${candidate.provider}"`)
  if (candidate.path !== undefined && typeof candidate.path !== 'string') throw new TypeError(`skill provider "${providerName}" returned skill "${candidate.name}" with a non-string path`)
}
function validateRuntimeSkillCN(skill: any) {
  if (!CN_KEBAB.test(skill.name)) throw new Error(`invalid skill name "${skill.name}"`)
  if (skill.description.length === 0) throw new Error(`skill "${skill.name}" requires a description`)
  validateInvocation(skill.invocation, `runtime skill "${skill.name}"`)
}
function validateDefinitionCN(skill: any) {
  const n = skill.name
  if (typeof n !== 'string') throw new TypeError('loaded skill name must be a string')
  if (!CN_KEBAB.test(n)) throw new Error(`loaded skill has invalid name "${n}"`)
  if (typeof skill.description !== 'string') throw new TypeError(`loaded skill "${n}" description must be a string`)
  if (skill.description.length === 0) throw new Error(`loaded skill "${n}" requires a description`)
  validateInvocation(skill.invocation, `loaded skill "${n}"`)
  if (skill.whenToUse !== undefined && typeof skill.whenToUse !== 'string') throw new TypeError(`loaded skill "${n}" whenToUse must be a string`)
  if (typeof skill.source !== 'string') throw new TypeError(`loaded skill "${n}" source must be a string`)
  if (typeof skill.provider !== 'string') throw new TypeError(`loaded skill "${n}" provider must be a string`)
  if (typeof skill.content !== 'string') throw new TypeError(`loaded skill "${n}" content must be a string`)
  if (skill.path !== undefined && typeof skill.path !== 'string') throw new TypeError(`loaded skill "${n}" path must be a string`)
}
function toError(e: any): Error {
  try { if (e instanceof Error) return e } catch {}
  try { return new Error(String(e)) } catch { return new Error('[unrenderable thrown value]') }
}
function errorMessage(e: any): string {
  try { return String(e) } catch { return '[unrenderable thrown value]' }
}
function throwIfAborted(signal?: AbortSignal) {
  if ((signal as any)?.aborted === true) throw toError((signal as any).reason)
}
function waitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(toError((signal as any).reason)) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(v => { cleanup(); resolve(v) }, err => { cleanup(); reject(toError(err)) })
  })
}
function normalizeProviderObservation(output: any, providerName: string) {
  if (Array.isArray(output)) return { candidates: output, complete: true }
  if (output === null || typeof output !== 'object') throw new TypeError(`skill provider "${providerName}" list() must return an array or { candidates, complete } observation`)
  if (!Array.isArray((output as any).candidates) || typeof (output as any).complete !== 'boolean') throw new TypeError(`skill provider "${providerName}" list() must return an array or { candidates, complete } observation`)
  return output as { candidates: any[]; complete: boolean }
}
const RUNTIME_RANK = 250
const RUNTIME_PROVIDER = 'runtime'
function runtimeCandidate(skill: any) {
  return {
    name: skill.name,
    description: skill.description,
    ...(skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {}),
    invocation: skill.invocation,
    source: skill.source,
    provider: skill.provider,
    ...(skill.resourceBase !== undefined ? { resourceBase: skill.resourceBase } : {}),
    rank: RUNTIME_RANK,
    locator: skill,
    ...(skill.path !== undefined ? { path: skill.path } : {}),
    ...(skill.metadata !== undefined ? { metadata: skill.metadata } : {}),
  }
}
function compareCodePoints(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0 }
function compareIndexedCandidates(a: any, b: any) {
  return a.candidate.rank - b.candidate.rank || a.providerOrder - b.providerOrder || a.localOrder - b.localOrder
}

// ---------- 文件持久化补丁 ----------
async function patchFilesOnDisk(ctx: Context) {
  try {
    const { createRequire } = await import('node:module')
    const require = createRequire(import.meta.url)
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const os = await import('node:os')
    async function resolveFile(id: string): Promise<string | null> {
      try {
        const r = require.resolve(id)
        // 若解析到的是包目录，尝试补全 lib/index.js
        try {
          const st = await fs.stat(r)
          if (st.isFile()) return r
        } catch {}
        // 兼容 package 导出指向 lib/index.js 的情况已是文件；若是目录则拼接
        return r
      } catch {}
      const pkg = id.replace(/^@deepseek-ai\//, '')
      const bases: string[] = []
      try { bases.push(path.join(os.homedir(), 'AppData', 'Roaming', 'DSH Desktop', 'agent', 'node_modules', '@deepseek-ai', pkg, 'lib', 'index.js')) } catch {}
      try { bases.push(path.join(os.homedir(), '.dsh', 'agent', 'node_modules', '@deepseek-ai', pkg, 'lib', 'index.js')) } catch {}
      const envAgent = (process.env as any).AGENT_RUNTIME ?? (process as any).env?.AGENT_RUNTIME
      if (envAgent) bases.push(path.join(String(envAgent), 'node_modules', '@deepseek-ai', pkg, 'lib', 'index.js'))
      for (const drive of ['C:', 'D:']) {
        try {
          const user = path.basename(os.homedir())
          if (user) bases.push(path.join(drive, 'Users', user, 'AppData', 'Roaming', 'DSH Desktop', 'agent', 'node_modules', '@deepseek-ai', pkg, 'lib', 'index.js'))
        } catch {}
      }
      // WSL fallback: /mnt/c/Users/...
      try {
        const user = path.basename(os.homedir())
        if (user) {
          for (const mnt of ['/mnt/c', '/mnt/d']) {
            bases.push(path.join(mnt, 'Users', user, 'AppData', 'Roaming', 'DSH Desktop', 'agent', 'node_modules', '@deepseek-ai', pkg, 'lib', 'index.js'))
          }
        }
      } catch {}
      for (const b of bases) {
        try { await fs.access(b); return b } catch {}
      }
      return null
    }
    const tryPatch = async (id: string, replacements: Array<[string | RegExp, string]>, alreadyPatchedMarker: string | string[]) => {
      const file = await resolveFile(id)
      if (!file) {
        ctx.logger.warn?.(`[dsh-chinese-skill-patch] patch ${id} skipped: file not found`)
        return
      }
      // dsh-skill: lib/index.js, dsh-skill-filesystem, dsh-tool-skill
      // 对于 package 形式，require.resolve('@deepseek-ai/dsh-skill') 会指向 lib/index.js  via exports
      // 但我们要的是 lib/index.js 路径；若解析到的是 package.json，再拼接
      try {
        const content = await fs.readFile(file, 'utf8')
        // 幂等保护：文件已是 CN 版时直接跳过，避免重复替换把 /u 叠成 /uu 破坏语法
        const markers = Array.isArray(alreadyPatchedMarker) ? alreadyPatchedMarker : [alreadyPatchedMarker]
        if (markers.some(m => content.includes(m))) {
          ctx.logger.info?.(`[dsh-chinese-skill-patch] ${id} already patched, skip -> ${file}`)
          return
        }
        let next = content
        for (const [from, to] of replacements) {
          if (typeof from === 'string') next = next.split(from).join(to)
          else next = next.replace(from as any, to)
        }
        if (next !== content) {
          await fs.writeFile(file, next, 'utf8')
          ctx.logger.info?.(`[dsh-chinese-skill-patch] patched ${id} -> ${file}`)
        } else {
          ctx.logger.info?.(`[dsh-chinese-skill-patch] patch ${id} no change -> ${file}`)
        }
      } catch (e) {
        ctx.logger.warn?.(`[dsh-chinese-skill-patch] patch ${id} failed: ${errorMessage(e)}`)
      }
    }
    // 1. dsh-skill: SKILL_NAME
    await tryPatch('@deepseek-ai/dsh-skill', [
      [/const SKILL_NAME = \/.*?\//, 'const SKILL_NAME = /^[\\p{L}0-9]+(?:-[\\p{L}0-9]+)*$/u'],
      ['/^[a-z0-9]+(?:-[a-z0-9]+)*$/', '/^[\\p{L}0-9]+(?:-[\\p{L}0-9]+)*$/u'],
    ], '/^[\\p{L}0-9]+(?:-[\\p{L}0-9]+)*$/u')
    // 2. dsh-skill-filesystem: isSkillName
    await tryPatch('@deepseek-ai/dsh-skill-filesystem', [
      ['if (!isSkillName(name))', 'if (!/^[\\p{L}0-9]+(?:-[\\p{L}0-9]+)*$/u.test(name))'],
    ], '/^[\\p{L}0-9]+(?:-[\\p{L}0-9]+)*$/u')
    // 3. dsh-tool-skill: GESTURE + isSkillName
    await tryPatch('@deepseek-ai/dsh-tool-skill', [
      ['const SKILL_GESTURE = /(^|\\s)\\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\\s|$)/g;', 'const SKILL_GESTURE = /(^|\\s)\\/([\\p{L}0-9]+(?:-[\\p{L}0-9]+)*)(?=\\s|$)/gu;'],
      ['if (!isSkillName(args.name))', 'if (!/^[\\p{L}0-9]+(?:-[\\p{L}0-9]+)*$/u.test(args.name))'],
    ], ['/([\\p{L}0-9]+(?:-[\\p{L}0-9]+)*)(?=\\s|$)/gu', '/^[\\p{L}0-9]+(?:-[\\p{L}0-9]+)*$/u.test(args.name)'])
  } catch (e) {
    // ignore
  }
}

// ---------- 前置解析：复刻 filesystem 的 findProjectRoot / parse 前置 ----------
async function findProjectRoot(cwd: string, fs?: any): Promise<string> {
  const path = await import('node:path')
  const fsp = await import('node:fs/promises')
  let current = path.resolve(cwd)
  while (true) {
    try {
      // 优先用 ctx.fs (若有)，否则用 node fs
      if (fs) {
        try {
          const target = await fs.resolve(path.join(current, '.git'))
          const st = await fs.stat(target)
          if (st) return current
        } catch { /* fallback to node */ }
      }
      await fsp.access(path.join(current, '.git'))
      return current
    } catch {}
    const parent = path.dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}
function parseFrontmatterRaw(raw: string): { data: any; body: string } | null {
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
  const nl = raw.indexOf('\n')
  if (nl < 0) return null
  if (raw.slice(0, nl).replace(/\r$/, '') !== '---') return null
  const start = nl + 1
  let p = start
  while (p <= raw.length) {
    const n = raw.indexOf('\n', p)
    const end = n < 0 ? raw.length : n
    if (raw.slice(p, end).replace(/\r$/, '') === '---') {
      return { data: raw.slice(start, p), body: raw.slice(n < 0 ? raw.length : n + 1) }
    }
    if (n < 0) return null
    p = n + 1
  }
  return null
}
async function parseSkillFileCN(filePath: string, ctx: Context, signal?: AbortSignal): Promise<any | undefined> {
  const fs = await import('node:fs/promises')
  let raw: string | undefined
  try {
    raw = await fs.readFile(filePath, { encoding: 'utf8', signal } as any)
    if (raw && raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1)
  } catch {
    return undefined
  }
  signal?.throwIfAborted()
  if (raw === undefined) return undefined
  // 尝试用 yaml parse，若失败回退到手写
  let data: any = null
  let body = ''
  const fm = parseFrontmatterRaw(raw)
  if (!fm) {
    ctx.logger.warn?.(`skill file ${filePath} ignored: missing YAML frontmatter`)
    return undefined
  }
  body = fm.body
  const yamlBlock = fm.data
  try {
    // 优先用 yaml 库（先尝试标准 import，再回退到 agent 物理路径，避免 plugin 未 link yaml 时 fallback 失效）
    let yamlMod: any = null
    try { yamlMod = await import('yaml') } catch {}
    if (!yamlMod?.parse) {
      try {
        const { createRequire } = await import('node:module')
        const os = await import('node:os')
        const path = await import('node:path')
        const fs = await import('node:fs/promises')
        const candidates = [
          path.join(os.homedir(), 'AppData', 'Roaming', 'DSH Desktop', 'agent', 'node_modules', 'yaml', 'dist', 'yaml.js'),
          path.join(os.homedir(), 'AppData', 'Roaming', 'DSH Desktop', 'agent', 'node_modules', 'yaml', 'dist', 'yaml.mjs'),
        ]
        for (const cand of candidates) {
          try { await fs.access(cand); const req = createRequire(import.meta.url); yamlMod = req(cand); if (yamlMod?.parse) break } catch {}
        }
        if (!yamlMod?.parse) {
          // 最后尝试用 agent 的 require 机制
          try {
            const agentBase = path.join(os.homedir(), 'AppData', 'Roaming', 'DSH Desktop', 'agent', 'node_modules', 'yaml')
            const req2 = createRequire(path.join(agentBase, 'package.json'))
            yamlMod = req2('yaml')
          } catch {}
        }
      } catch {}
    }
    if (yamlMod?.parse) {
      data = yamlMod.parse(yamlBlock)
    } else {
      throw new Error('no yaml')
    }
  } catch {
    // 手写极简解析（兼容中文，支持 `description: >` 折叠语法）
    data = {}
    const lines = yamlBlock.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
      if (!m) continue
      const key = m[1]
      let v: any = m[2].trim()
      if (v === '>' || v === '|' || v === '>-' || v === '|-' || v === '>-' || v === '|-') {
        // 收集后续缩进块（YAML folded / literal）
        const buf: string[] = []
        for (let j = i + 1; j < lines.length; j++) {
          const nxt = lines[j]
          if (nxt.trim() === '') { buf.push(''); continue }
          if (/^\s/.test(nxt)) {
            buf.push(nxt.trim())
          } else {
            break
          }
        }
        v = buf.join(v === '>' || v === '>-' ? ' ' : '\n').replace(/\s+/g, ' ').trim()
        if (!v) v = ''
      } else {
        // 去掉首尾引号
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
        // 布尔处理
        if (v === 'true') v = true
        else if (v === 'false') v = false
      }
      // 仅在值非空时写入，避免把 `>` 本身写成 ">"
      if (v !== '' || key === 'name' || key === 'description') {
        if (key === 'description' && (v === '>' || v === '|' || v === '')) continue
        data[key] = v
      }
    }
    // 若 description 仍缺失但 yamlBlock 中包含 description: >，尝试用更宽松的正则兜底
    if (!data.description || data.description === '>' || data.description === '|') {
      const m2 = yamlBlock.match(/description:\s*[>|]\s*\n([\s\S]*?)(?:\n[A-Za-z][A-Za-z0-9_-]*:|\n---|\s*$)/)
      if (m2) {
        const rawDesc = m2[1].split('\n').map(s => s.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
        if (rawDesc) data.description = rawDesc
      }
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    ctx.logger.warn?.(`skill file ${filePath} ignored: invalid YAML frontmatter`)
    return undefined
  }
  const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : undefined
  const description = typeof data.description === 'string' && data.description.length > 0 ? data.description : undefined
  if (!name || !description) {
    ctx.logger.warn?.(`skill file ${filePath} ignored: frontmatter requires name and description`)
    return undefined
  }
  if (!CN_KEBAB.test(name)) {
    ctx.logger.warn?.(`skill file ${filePath} ignored: invalid skill name "${name}"`)
    return undefined
  }
  // invocation
  let invocation = { modelInvocable: true, userInvocable: true }
  try {
    const dm = (data as any)['disable-model-invocation']
    const ui = (data as any)['user-invocable']
    if (dm !== undefined) {
      const v = dm === true || dm === 'true' || dm === 1 || dm === '1' ? true : dm === false || dm === 'false' || dm === 0 || dm === '0' ? false : (() => { throw new TypeError('disable-model-invocation must be boolean') })()
      invocation.modelInvocable = v !== true
    }
    if (ui !== undefined) {
      const v = ui === true || ui === 'true' || ui === 1 || ui === '1' ? true : ui === false || ui === 'false' || ui === 0 || ui === '0' ? false : (() => { throw new TypeError('user-invocable must be boolean') })()
      invocation.userInvocable = v !== false
    }
    // legacy 拒绝
    if (Object.hasOwn(data, 'disableModelInvocation') || Object.hasOwn(data, 'modelInvocable') || Object.hasOwn(data, 'userInvocable')) {
      throw new Error('legacy invocation key')
    }
  } catch (e) {
    ctx.logger.warn?.(`skill file ${filePath} ignored: invalid invocation frontmatter: ${errorMessage(e)}`)
    return undefined
  }
  const whenToUse = typeof data.whenToUse === 'string' && data.whenToUse.length > 0 ? String(data.whenToUse) : undefined
  const metadata = typeof data.metadata === 'object' && data.metadata !== null && !Array.isArray(data.metadata) ? data.metadata : undefined
  return {
    name: String(name),
    description: String(description),
    ...(whenToUse ? { whenToUse } : {}),
    invocation,
    ...(metadata ? { metadata } : {}),
    content: body.trim(),
  }
}

export function apply(ctx: Context, config: Config): void {
  // 1. 文件持久化（重启后仍生效）
  ctx.effect(() => {
    patchFilesOnDisk(ctx)
    return () => {}
  }, 'dsh-chinese-skill-patch: patch files')

  // 2. 运行时：打 SkillRegistry 原型
  ctx.effect(() => {
    const skills: any = (ctx as any).skills ?? (ctx as any).get?.('skills')
    if (!skills) {
      ctx.logger.warn?.('[dsh-chinese-skill-patch] skills service not found, skip registry patch')
      return
    }
    const proto = Object.getPrototypeOf(skills)
    // 保存原方法以便卸载时恢复（可选）
    const origGet = proto.get
    const origRegister = proto.register
    const origListLayerCandidates = proto.listLayerCandidates

    // Patch get
    proto.get = async function(name: string, options: any = {}) {
      if (!CN_KEBAB.test(name)) return undefined
      const collected = await this.collect(options)
      throwIfAborted(options.signal)
      const match = collected.entries.get(name)
      if (match === undefined) return undefined
      const definition = await waitWithAbort(match.provider.get(match.candidate, options), options.signal)
      if (definition === undefined) return undefined
      validateDefinitionCN(definition)
      if (definition.name !== match.candidate.name) {
        this.invalidateEntry(match)
        return undefined
      }
      return definition
    }

    // Patch register (简化：统一写入 global，兼容中文)
    proto.register = function(skill: any) {
      validateRuntimeSkillCN(skill)
      const existingLayer = this.layers.global
      if (existingLayer.runtime.has(skill.name)) {
        this.ctx.logger.warn(`runtime skill "${skill.name}" ignored because it is already registered`)
        return () => {}
      }
      const definition = {
        ...skill,
        invocation: skill.invocation ?? { modelInvocable: true, userInvocable: true },
        provider: skill.provider ?? RUNTIME_PROVIDER,
      }
      return this.layers.effect(this.ctx, (layer: any) => {
        layer.runtime.set(definition.name, definition)
        try { this.invalidateCache() } catch {}
        return () => {
          layer.runtime.delete(definition.name)
          try { this.invalidateCache() } catch {}
        }
      }, { label: 'skills.register() [cn-patched]' })
    }

    // Patch listLayerCandidates -> 用 CN 校验
    proto.listLayerCandidates = async function(layer: any, options: any) {
      throwIfAborted(options.signal)
      const candidates: any[] = []
      let cacheable = true
      let runtimeOrder = 0
      for (const skill of [...layer.runtime.values()].sort((a: any, b: any) => compareCodePoints(a.name, b.name))) {
        candidates.push({
          candidate: runtimeCandidate(skill),
          provider: { name: RUNTIME_PROVIDER, list() { return Promise.resolve([]) }, get(candidate: any) { return Promise.resolve(candidate.locator) } },
          providerOrder: -1,
          localOrder: runtimeOrder,
          layer,
        })
        runtimeOrder += 1
      }
      // providers
      const providers: Array<{ provider: any; order: number }> = [...layer.providers.values()] as any
      for (const { provider, order } of providers) {
        let localOrder = 0
        let output: any
        try {
          output = await waitWithAbort(provider.list(options), options.signal)
        } catch (error) {
          if (options.signal?.aborted === true) throw toError((options.signal as any).reason)
          cacheable = false
          this.ctx.logger.warn(`skill provider "${provider.name}" skipped: ${errorMessage(error)}`)
        }
        if (output === undefined) continue
        const observation = normalizeProviderObservation(output, provider.name)
        if (!observation.complete) cacheable = false
        for (const candidate of observation.candidates) {
          try {
            validateCandidateCN(candidate, provider.name)
          } catch (e) {
            // 沿用原 warn 行为，但抛错会导致整层失败；我们改为 warn 并跳过该 candidate
            this.ctx.logger.warn(`skill provider "${provider.name}" returned invalid skill name "${(candidate as any).name}" ignored (cn-patch)`)
            continue
          }
          candidates.push({ candidate, provider, providerOrder: order, localOrder, layer })
          localOrder += 1
        }
      }
      return { entries: candidates, cacheable }
    }

    // 立即失效缓存，让下次 list 重新走新逻辑
    try { skills.invalidateCache() } catch {}
    ctx.logger.info?.('[dsh-chinese-skill-patch] SkillRegistry patched to CN_KEBAB')

    return () => {
      // 卸载时恢复（尽力）
      try {
        proto.get = origGet
        proto.register = origRegister
        proto.listLayerCandidates = origListLayerCandidates
        skills.invalidateCache()
      } catch {}
    }
  }, 'dsh-chinese-skill-patch: registry prototype')

  // 3. 注册 CN 感知的 provider（补齐中文发现）
  ctx.effect(() => {
    const provider = {
      name: 'chinese-skill-patch',
      async list(options: any = {}) {
        const cwd = options?.cwd ? String(options.cwd) : process.cwd()
        const path = await import('node:path')
        const os = await import('node:os')
        // 复用 filesystem 的 roots 逻辑（简化版，覆盖 99% 场景）
        const roots: Array<{ path: string; source: string; rank: number; skipSystem?: boolean }> = []
        // project roots
        try {
          const projectRoot = await findProjectRoot(cwd, (ctx as any).get?.('fs'))
          roots.push({ path: path.join(projectRoot, '.dsh', 'skills'), source: 'project-dsh', rank: 100 })
          roots.push({ path: path.join(projectRoot, '.agents', 'skills'), source: 'project-agents', rank: 200 })
        } catch {}
        // user roots
        const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
        roots.push({ path: path.join(dshHome, 'skills'), source: 'user-dsh', rank: 400, skipSystem: true })
        const agentsHome = process.env.DSH_AGENTS_HOME ?? path.join(os.homedir(), '.agents')
        roots.push({ path: path.join(agentsHome, 'skills'), source: 'user-agents', rank: 500 })
        // 可选：若配置了 DSH_AGENTS_DIR（或插件 Config.extraAgentsDir），则把其子目录的 .dsh/skills 也视为 project 候选
        const extraBase = (config as any)?.extraAgentsDir ?? process.env.DSH_AGENTS_DIR
        if (extraBase) {
          try {
            const fs = await import('node:fs/promises')
            const ents = await fs.readdir(extraBase, { withFileTypes: true }).catch(() => [] as any)
            for (const e of ents as any) {
              if (!e.isDirectory()) continue
              const p = path.join(extraBase, e.name, '.dsh', 'skills')
              if (!roots.some(r => r.path === p)) {
                try { const st = await fs.stat(p); if (st.isDirectory()) roots.push({ path: p, source: 'project-dsh', rank: 100 }) } catch {}
              }
            }
          } catch {}
        }

        const candidates: any[] = []
        const fs = await import('node:fs/promises')
        for (const root of roots) {
          let entries: any[] = []
          try {
            entries = await fs.readdir(root.path, { withFileTypes: true, encoding: 'utf8' } as any) as any
          } catch { continue }
          for (const ent of entries) {
            if (root.skipSystem && ent.name === '.system') continue
            try {
              let locator: { path: string; directory: string } | undefined
              let skillPath: string | undefined
              if (ent.isDirectory()) {
                skillPath = path.join(root.path, ent.name, 'SKILL.md')
                locator = { path: skillPath, directory: path.join(root.path, ent.name) }
              } else if (ent.isFile() && ent.name.endsWith('.md')) {
                skillPath = path.join(root.path, ent.name)
                locator = { path: skillPath, directory: root.path }
              } else if (ent.isSymbolicLink()) {
                const full = path.join(root.path, ent.name)
                try {
                  const st = await fs.stat(full)
                  if (st.isDirectory()) {
                    skillPath = path.join(full, 'SKILL.md')
                    locator = { path: skillPath, directory: full }
                  } else if (st.isFile() && ent.name.endsWith('.md')) {
                    skillPath = full
                    locator = { path: skillPath, directory: root.path }
                  }
                } catch { continue }
              }
              if (!locator || !skillPath) continue
              const parsed = await parseSkillFileCN(skillPath, ctx, options.signal)
              if (!parsed) continue
              candidates.push({
                name: parsed.name,
                description: parsed.description,
                ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
                invocation: parsed.invocation,
                source: root.source,
                provider: 'chinese-skill-patch',
                rank: root.rank,
                locator,
                resourceBase: { kind: 'directory', path: locator.directory },
                path: skillPath,
                ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
              })
            } catch {}
          }
        }
        return candidates
      },
      async get(candidate: any, options: any = {}) {
        const parsed = await parseSkillFileCN(candidate.locator.path, ctx, options.signal)
        if (!parsed) return undefined
        return {
          name: parsed.name,
          description: parsed.description,
          ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
          invocation: parsed.invocation,
          source: candidate.source,
          provider: 'chinese-skill-patch',
          resourceBase: { kind: 'directory', path: candidate.locator.directory },
          path: candidate.locator.path,
          ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
          content: parsed.content,
        }
      },
    }
    const dispose = (ctx as any).skills.registerProvider(() => provider) as unknown as () => void
    // 触发一次失效
    try { (ctx as any).skills.invalidateCache() } catch {}
    ctx.logger.info?.('[dsh-chinese-skill-patch] provider chinese-skill-patch registered')
    return () => {
      try { dispose() } catch {}
      try { (ctx as any).skills.invalidateCache() } catch {}
    }
  }, 'dsh-chinese-skill-patch: provider')

  // 4. 额外 agent/pre-step：让 /私家大厨 这种 CN gesture 也能注入（无需改 dsh-tool-skill 文件即可即时生效）
  // 根因修复：持久化补丁已使原生 dsh-tool-skill 的 SKILL_GESTURE 支持 CN 时，若插件仍注入会导致同一中文名双份 <skill_content>（seq 11/12 identical）。
  // 去重策略（经 grilling 定夺）：以原生为单一真实来源——当原生已支持 CN 时插件让位，仅当原生未支持（如首次安装未重启）时插件兜底；同时对 decision 已有注入做幂等去重，兼容 handler 注册顺序的两种情况。
  ctx.effect(() => {
    // 缓存原生是否已支持 CN，避免每 Turn 重复探测
    let nativeSupportsCNCache: boolean | undefined
    async function nativeSupportsCN(): Promise<boolean> {
      if (nativeSupportsCNCache !== undefined) return nativeSupportsCNCache
      try {
        const mod: any = await import('@deepseek-ai/dsh-skill')
        if (mod?.isSkillName?.('备忘录') && mod?.isSkillName?.('私家大厨')) {
          nativeSupportsCNCache = true
          return true
        }
      } catch {}
      try {
        const fs = await import('node:fs/promises')
        const { createRequire } = await import('node:module')
        const require = createRequire(import.meta.url)
        let file: string | null = null
        try { file = require.resolve('@deepseek-ai/dsh-tool-skill') } catch {}
        if (file) {
          const content = await fs.readFile(file, 'utf8').catch(() => '')
          if (content && content.includes('\\p{L}')) {
            nativeSupportsCNCache = true
            return true
          }
        }
      } catch {}
      nativeSupportsCNCache = false
      return false
    }
    const off = (ctx as any).on('agent/pre-step', async ({ agent, messages, signal }: any, next: any) => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      // 若原生已支持 CN，则插件不再抢注——避免与原生各注入一次的 duplication（inner/outer 两种顺序都会重）
      // 该分支使插件成为 fallback，仅在原生未打补丁的窗口期生效
      if (await nativeSupportsCN()) {
        // 额外幂等：若 decision 已含中文注入（outer 情况），也已是单份，直接返回
        return decision
      }
      // 只处理用户侧的 skill 注入，不干扰 compaction 等
      // 扫描所有 user 消息中的 CN gesture
      const names: string[] = []
      const seen = new Set<string>()
      for (const m of messages) {
        if (m.source?.kind !== 'user') continue
        for (const block of m.content ?? []) {
          if (block.type !== 'text' || typeof block.text !== 'string') continue
          // 重要：CN_GESTURE 有 g 标志，需重置 lastIndex
          CN_GESTURE.lastIndex = 0
          for (const mat of block.text.matchAll(CN_GESTURE as any)) {
            const n: string | undefined = mat[2]
            if (n && !seen.has(n)) { seen.add(n); names.push(n) }
          }
        }
      }
      if (names.length === 0) return decision
      signal?.throwIfAborted()
      // 幂等去重：decision 已含的 skill-invocation（处理 outer 已注入的场景）
      const alreadyInjected = new Set<string>(
        (decision.messages ?? [])
          .filter((m: any) => m?.source?.kind === 'skill-invocation' && typeof m.source.name === 'string')
          .map((m: any) => m.source.name as string)
      )
      // 过滤出真正的中文名（CN 且在 catalog 中且 userInvocable）
      const lookup = { cwd: agent.session.header.cwd, signal, scope: agent }
      const injections: any[] = []
      // 动态取依赖，避免顶层 import 循环
      let renderSkillContent: any
      let createUserMessage: any
      try {
        const modSkill = await import('@deepseek-ai/dsh-skill')
        renderSkillContent = (modSkill as any).renderSkillContent
      } catch {}
      try {
        const modLlm = await import('@deepseek-ai/dsh-llm')
        createUserMessage = (modLlm as any).createUserMessage
      } catch {}
      if (!renderSkillContent || !createUserMessage) return decision
      for (const n of names) {
        if (alreadyInjected.has(n)) continue
        // 只处理中文名，ascii 交给原 handler
        if (/^[a-z0-9-]+$/.test(n)) continue
        if (!CN_KEBAB.test(n)) continue
        const skill = await (ctx as any).skills.get(n, lookup).catch(() => undefined)
        signal?.throwIfAborted()
        if (!skill) continue
        if (skill.invocation && skill.invocation.userInvocable === false) continue
        injections.push(createUserMessage({
          content: [{ type: 'text', text: renderSkillContent(skill) }],
          source: { kind: 'skill-invocation', name: n, form: 'instructions' },
        }))
      }
      if (injections.length === 0) return decision
      return { kind: 'enter', messages: [...decision.messages, ...injections] }
    })
    return () => { try { off() } catch {} }
  }, 'dsh-chinese-skill-patch: cn gesture injection')

  // 4b. 模型侧 skill 工具补丁：让 skill({name:"私家大厨"}) 也能通过
  ctx.effect(() => {
    const CN = CN_KEBAB
    // 用 defineTool 注册一个 CN 版 skill，覆盖全局缺失的 skill 工具
    // 若原 skill 已在全局则会冲突，这里先尝试注册，失败则忽略（原工具已支持 CN）
    try {
      const skillTool = defineTool({
        name: 'skill',
        description: 'Load the full instructions for an available skill. Call this with the exact skill name (CN supported) from the session skill catalog before acting on a task that names or clearly matches that skill.',
        parameters: { name: { type: 'string', required: true, description: 'The exact skill name from the available skills list.' } } as any,
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', required: true },
              provider: { type: 'string', required: true },
              resourceBase: { oneOf: [{ type: 'object', properties: { kind: { const: 'directory', type: 'string', required: true }, path: { type: 'string', required: true } }, additionalProperties: false }, { type: 'object', properties: { kind: { const: 'url', type: 'string', required: true }, url: { type: 'string', required: true } }, additionalProperties: false }, { type: 'object', properties: { kind: { const: 'opaque', type: 'string', required: true }, description: { type: 'string', required: true } }, additionalProperties: false }] },
              content: { type: 'string', required: true },
            },
          } as any,
          render: (_args: unknown, value: any) => [{ type: 'text', text: value.content ?? JSON.stringify(value) }],
        } as any,
        async execute(args: any, exec: any) {
          if (!CN.test(args.name)) throw new Error(`invalid skill name "${args.name}"`)
          const lookup = { cwd: exec.agent?.session.header.cwd, signal: exec.signal, scope: exec.agent }
          const skills: any = (ctx as any).skills
          const summary = (await skills.list(lookup)).find((s: any) => s.name === args.name)
          if (!summary) throw new Error(`skill "${args.name}" is unknown or no longer available`)
          if (summary.invocation && summary.invocation.modelInvocable === false) throw new Error(`skill "${args.name}" is not available for model invocation`)
          const skill = await skills.get(args.name, lookup)
          if (!skill) throw new Error(`skill "${args.name}" is unknown or no longer available`)
          if (skill.invocation && skill.invocation.modelInvocable === false) throw new Error(`skill "${args.name}" is not available for model invocation`)
          return { name: skill.name, provider: skill.provider, ...(skill.resourceBase ? { resourceBase: { ...skill.resourceBase } } : {}), content: skill.content }
        },
        presentCall(args: any) { return { card: 'generic', title: `Load skill ${args.name}`, kind: 'read', rawInput: args.name } as any },
      } as any)
      const dispose = ctx.tools.register(skillTool as any)
      ctx.logger.info?.('[dsh-chinese-skill-patch] skill tool (CN) registered')
      return () => { try { (dispose as any)() } catch {} }
    } catch (e) {
      ctx.logger.warn?.(`[dsh-chinese-skill-patch] skill tool register skipped: ${errorMessage(e)}`)
      return () => {}
    }
  }, 'dsh-chinese-skill-patch: skill tool CN')

  // 5. 调试工具
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

  ctx.logger.info?.('[dsh-chinese-skill-patch] installed; SKILL_NAME relaxed to CN_KEBAB, gesture patched, provider registered')
}

