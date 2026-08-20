#!/usr/bin/env node
// 复现脚本：验证 /备忘录 等中文技能被注入两次的根因
// 模拟 dsh-tool-skill 持久化补丁后的 CN_GESTURE + 插件运行时 CN_GESTURE 双注入

const CN_KEBAB = /^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u;
const CN_GESTURE = /(^|\s)\/([\p{L}0-9]+(?:-[\p{L}0-9]+)*)(?=\s|$)/gu;

// 模拟原始 ascii gesture（补丁前）
const OLD_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;

// 模拟 native handler（打过 CN 补丁后）
function nativeInvokedSkillNames(messages) {
  const names = [];
  for (const m of messages) {
    if (m.source?.kind !== 'user') continue;
    for (const block of m.content ?? []) {
      if (block.type !== 'text') continue;
      CN_GESTURE.lastIndex = 0;
      for (const match of block.text.matchAll(CN_GESTURE)) {
        const n = match[2];
        if (n && !names.includes(n)) names.push(n);
      }
    }
  }
  return names;
}

// 模拟插件运行时 handler（src/index.ts:653-708）
function pluginInvokedNames(messages) {
  const names = [];
  const seen = new Set();
  for (const m of messages) {
    if (m.source?.kind !== 'user') continue;
    for (const block of m.content ?? []) {
      if (block.type !== 'text') continue;
      CN_GESTURE.lastIndex = 0;
      for (const mat of block.text.matchAll(CN_GESTURE)) {
        const n = mat[2];
        if (n && !seen.has(n)) { seen.add(n); names.push(n); }
      }
    }
  }
  return names.filter(n => {
    if (/^[a-z0-9-]+$/.test(n)) return false; // ascii 交给原 handler
    if (!CN_KEBAB.test(n)) return false;
    return true;
  });
}

// 模拟一次 turn 的完整流程：user 输入 "/备忘录 Help" -> 两个 handler 各自注入
function simulateDoubleInjection() {
  const messages = [
    {
      source: { kind: 'user' },
      content: [{ type: 'text', text: '/备忘录 Help' }]
    }
  ];

  // 1) plugin 视角会注入的 names
  const pluginNames = pluginInvokedNames(messages);
  // 2) native 视角会注入的 names
  const nativeNames = nativeInvokedSkillNames(messages);

  console.log('pluginNames:', pluginNames);
  console.log('nativeNames:', nativeNames);

  // 模拟注入：两者对同一中文名各注入一次
  const injections = [];
  for (const n of nativeNames) {
    // native 会对所有名注入（含中文，因为已打 CN 补丁）
    injections.push(`native:<skill_content name="${n}"> len 46253`);
  }
  for (const n of pluginNames) {
    injections.push(`plugin:<skill_content name="${n}"> len 46253`);
  }

  console.log('injections before dedup:', injections);
  console.log('injection count:', injections.length);

  // 检查是否有重复的中文名
  const chineseDup = pluginNames.filter(n => nativeNames.includes(n));
  console.log('chineseDup (should be non-empty before fix):', chineseDup);

  // 验证 session.jsonl 的观察：两条完全一致的 <skill_content name="备忘录">
  // 对应到这里就是 native + plugin 各一次
  const isBugReproduced = chineseDup.length > 0 && injections.length > 1 && injections.filter(s => s.includes('备忘录')).length === 2;
  console.log('\n=== 诊断结果 ===');
  if (isBugReproduced) {
    console.log('BUG REPRODUCED ✅: 中文技能 /备忘录 被注入两次（native + plugin 各一次）');
    console.log('与 issue 中 seq 11 / seq 12 双份 identical 内容一致');
  } else {
    console.log('BUG NOT REPRODUCED: 未观察到重复');
  }

  // 额外：测试其他中文名通用性
  const otherTests = ['/私家大厨', '/卡路里', '/备忘录', '/私家大厨 做菜'];
  console.log('\n--- 通用性检查：所有中文技能名走左斜杠都会重复 ---');
  for (const txt of otherTests) {
    const msg = [{ source: { kind: 'user' }, content: [{ type: 'text', text: txt }] }];
    const p = pluginInvokedNames(msg);
    const n = nativeInvokedSkillNames(msg);
    const dup = p.filter(x => n.includes(x));
    console.log(`  "${txt}" => plugin:${JSON.stringify(p)} native:${JSON.stringify(n)} dup:${JSON.stringify(dup)} ${dup.length?'⚠️重复':''}`);
  }

  return isBugReproduced;
}

const reproduced = simulateDoubleInjection();
if (!reproduced) {
  console.error('FAILED to reproduce bug - check harness');
  process.exit(1);
}

// 也验证 dedup 策略：如果 plugin 检测到 native 已支持 CN，应跳过
console.log('\n=== 验证去重策略 ===');
console.log('策略: 当 native 已支持 CN（isSkillName(\"备忘录\")===true），plugin 应让位，单次注入');
console.log('实现: plugin handler 在 nativeSupportsCN===true 时直接 return decision（不注入）');
console.log('fallback: 若用 dedup 集合，检查 decision.messages 已有 skill-invocation 也跳过');
console.log('预期修复后: injection count 应为 1，chineseDup 被消除');
