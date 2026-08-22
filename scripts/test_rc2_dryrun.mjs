#!/usr/bin/env node
// 回归测试：#9 诊断期间验证过的「磁盘补丁表 vs 官方 npm rc.2 源码」dry-run。
// 目的：插件 src/index.ts 里的替换串/幂等 marker 若与官方发行版源码失配（DSH 升级改写法），
// 补丁会静默失效（这正是 #9 用户侧症状的根因类别）。本测试在每次开发时把这条链路钉住。
//
// 兼容性说明：用字符级扫描器解析 src/index.ts 里的 tryPatch 调用（正则贪心在
// 「替换串含 )], 字符」时会失配），并对字符串字面量做 JS 语义 unescape，与插件运行时行为一致。
// 需要联网取 unpkg（官方 npm 包源）；离线时自动 SKIP（exit 0），不阻塞本地跑测试。

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcPath = path.resolve(here, '..', 'src', 'index.ts')
const PACKAGES = {
  '@deepseek-ai/dsh-skill': 'lib/index.js',
  '@deepseek-ai/dsh-skill-filesystem': 'lib/index.js',
  '@deepseek-ai/dsh-tool-skill': 'lib/index.js',
}
const TARGET_VERSION = '0.1.1-rc.2'
const EXPECTED_PAIRS = { '@deepseek-ai/dsh-skill': 2, '@deepseek-ai/dsh-skill-filesystem': 1, '@deepseek-ai/dsh-tool-skill': 2 }

let failures = 0
const fail = (msg) => { failures += 1; console.log('FAIL:', msg) }
const pass = (msg) => console.log('PASS:', msg)

// ---- JS 字符串字面量 unescape（与插件运行时拿到的值一致）----
function unescapeJs(s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch !== '\\') { out += ch; continue }
    const nxt = s[++i]
    if (nxt === undefined) { out += '\\'; break }
    switch (nxt) {
      case 'n': out += '\n'; break
      case 'r': out += '\r'; break
      case 't': out += '\t'; break
      case 'b': out += '\b'; break
      case 'f': out += '\f'; break
      case 'v': out += '\v'; break
      case '0': out += '\0'; break
      case 'u': {
        const hex = s.slice(i + 1, i + 5)
        if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 4 }
        else out += 'u'
        break
      }
      default: out += nxt // \\ \' \" \/ 等：去掉转义符
    }
  }
  return out
}

// ---- 字符级扫描：解析一个 tryPatch(id, [...], marker...) 调用 ----
class Scanner {
  constructor(body, key) {
    this.body = body
    this.i = body.indexOf(key)
    this.ok = this.i >= 0
    if (this.ok) this.i += key.length
  }
  skipWs() { while (this.i < this.body.length && /\s/.test(this.body[this.i])) this.i++ }
  readString() {
    if (this.body[this.i] !== "'") throw new Error(`expected string at ${this.i}`)
    this.i++
    let out = ''
    while (this.i < this.body.length) {
      const ch = this.body[this.i]
      if (ch === '\\') { out += ch + (this.body[this.i + 1] ?? ''); this.i += 2; continue }
      if (ch === "'") { this.i++; return out }
      out += ch; this.i++
    }
    throw new Error('unterminated string')
  }
  readRegexLiteral() {
    if (this.body[this.i] !== '/') throw new Error(`expected regex at ${this.i}`)
    let j = this.i + 1
    while (j < this.body.length) {
      if (this.body[j] === '\\') { j += 2; continue }
      if (this.body[j] === '/') break
      j++
    }
    const raw = this.body.slice(this.i, j + 1)
    this.i = j + 1
    while (this.i < this.body.length && /[a-z]/i.test(this.body[this.i])) this.i++
    return raw
  }
  readLiteral() {
    this.skipWs()
    if (this.body[this.i] === "'") return { kind: 'string', value: unescapeJs(this.readString()) }
    if (this.body[this.i] === '/') return { kind: 'regex', value: this.readRegexLiteral() }
    throw new Error(`expected literal at ${this.i}`)
  }
  scan() {
    if (!this.ok) return null
    try {
      // this.i 已指向数组首元素（构造函数 key 末尾含数组开括号）
      const pairs = []
      for (;;) {
        this.skipWs()
        if (this.body[this.i] === ']') { this.i++; break }
        if (this.body[this.i] !== '[') throw new Error('expected pair at ' + this.i)
        this.i++
        const from = this.readLiteral()
        this.skipWs()
        if (this.body[this.i] !== ',') throw new Error('expected comma in pair')
        this.i++
        const to = this.readLiteral()
        if (to.kind !== 'string') throw new Error('expected string replacement')
        this.skipWs()
        if (this.body[this.i] !== ']') throw new Error('expected pair end')
        this.i++
        this.skipWs()
        pairs.push({ from, to })
        if (this.body[this.i] === ',') { this.i++; continue }
        if (this.body[this.i] === ']') { this.i++; break }
        throw new Error('bad pair separator')
      }
      this.skipWs()
      if (this.body[this.i] !== ',') throw new Error('expected comma after array')
      this.i++
      this.skipWs()
      const markers = []
      if (this.body[this.i] === '[') {
        this.i++
        for (;;) {
          this.skipWs()
          if (this.body[this.i] === ']') { this.i++; break }
          const s = this.readString()
          this.skipWs()
          if (this.body[this.i] === ',') { this.i++; markers.push(unescapeJs(s)); continue }
          if (this.body[this.i] === ']') { this.i++; markers.push(unescapeJs(s)); break }
          throw new Error('bad marker array')
        }
      } else {
        markers.push(unescapeJs(this.readString()))
      }
      const parsedPairs = pairs.map(({ from, to }) => {
        if (from.kind === 'regex') {
          const lastSlash = from.value.lastIndexOf('/')
          return { from: new RegExp(from.value.slice(1, lastSlash), from.value.slice(lastSlash + 1)), to: to.value }
        }
        return { from: from.value, to: to.value }
      })
      return { pairs: parsedPairs, markers }
    } catch (e) {
      return { error: String(e) }
    }
  }
}

// ---- 1. 解析 src/index.ts ----
const src = await readFile(srcPath, 'utf8')
const patches = []
for (const id of Object.keys(PACKAGES)) {
  const scan = new Scanner(src, `tryPatch('${id}', [`)
  const r = scan.scan()
  if (r === null) { fail(`src/index.ts 中找不到 ${id} 的 tryPatch 调用（源码结构变了？）`); continue }
  if (r.error) { fail(`${id} tryPatch 解析失败: ${r.error}`); continue }
  if (r.pairs.length !== EXPECTED_PAIRS[id]) {
    fail(`${id}: 替换串数量异常（期望 ${EXPECTED_PAIRS[id]}，实际 ${r.pairs.length}）——请核对 src/index.ts`)
    continue
  }
  if (r.markers.length === 0) { fail(`${id}: 幂等 marker 解析为空`); continue }
  patches.push({ id, ...r })
}
if (patches.length !== Object.keys(PACKAGES).length) {
  console.log('用例不足，终止。')
  process.exit(1)
}

// ---- 2. 取官方 rc.2 源码 ----
const sources = {}
try {
  for (const [id, file] of Object.entries(PACKAGES)) {
    const url = `https://unpkg.com/${id}@${TARGET_VERSION}/${file}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15000)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      sources[id] = await res.text()
    } finally {
      clearTimeout(timer)
    }
  }
} catch (e) {
  console.log(`SKIP: 无法联网获取官方 ${TARGET_VERSION} 源码（${e.message}），跳过 rc.2 补丁配方校验`)
  process.exit(0)
}

// ---- 3. dry-run：幂等 marker 检查 → 替换 → 断言结果含 CN 正则 ----
for (const { id, pairs, markers } of patches) {
  const content = sources[id]
  if (content === undefined) { fail(`${id}: 未取到源码`); continue }

  const already = markers.some(s => content.includes(s))
  let next = content
  const applied = []
  if (!already) {
    for (const { from, to } of pairs) {
      if (typeof from === 'string') {
        if (next.includes(from)) { next = next.split(from).join(to); applied.push(`string:${from.slice(0, 40)}`) }
      } else if (from.test(next)) {
        next = next.replace(from, to)
        applied.push(`regex:${String(from).slice(0, 40)}`)
      }
    }
  }
  const resultHasCN = /\\p\{L\}/.test(next)
  if (process.env.TRIAGE9_DBG) {
    console.log('DBG', id, 'applied=', JSON.stringify(applied), 'nextHead=', JSON.stringify(next.slice(0, 160)), 'to0=', JSON.stringify(String(pairs[0]?.to).slice(0, 90)))
    // 单独验证 regex 直接替换结果
    const re0 = Object.create(null)
    for (const p of pairs) {
      if (typeof p.from !== 'string' && p.from.test(content)) {
        console.log('DBG directRegexReplace head:', JSON.stringify(content.replace(p.from, p.to).slice(0, 140)))
        break
      }
    }
  }

  if (already) {
    pass(`${id}: rc.2 已自带 CN 标记（幂等跳过，无需补丁）`)
  } else if (applied.length >= 1 && resultHasCN) {
    // 兜底替换串（如 dsh-skill 的 ascii 字面量 pair）在首个替换已改写同一处源码时
    // 会自然 miss——这是插件顺序替换的预期行为，断言以净效果为准。
    const skipped = pairs.length - applied.length
    pass(`${id}: ${applied.length}/${pairs.length} 条替换命中（${skipped} 条为已改写处的兜底串），结果已含 \\p{L}`)
  } else {
    fail(`${id}: 替换未命中（applied=${applied.length}/${pairs.length}, applied=[${applied.join(', ')}]）或结果缺 \\p{L}`)
  }

  const already2 = markers.some(s => next.includes(s))
  if (!already && !already2) {
    fail(`${id}: 补丁结果中未出现幂等 marker（重复加载会二次替换）`)
  } else if (!already) {
    pass(`${id}: 补丁结果含幂等 marker，重入安全`)
  }
}

if (failures > 0) {
  console.log(`\nrc.2 补丁配方校验失败 ${failures} 项 — DSH 升级可能让补丁静默失效，请更新 src/index.ts 替换串。`)
  process.exit(1)
}
console.log('\nrc.2 补丁配方校验全部通过')