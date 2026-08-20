#!/usr/bin/env node
// 测试修复后：无论 handler 顺序如何，中文技能仅注入一次

const CN_KEBAB = /^[\p{L}0-9]+(?:-[\p{L}0-9]+)*$/u;
const CN_GESTURE = /(^|\s)\/([\p{L}0-9]+(?:-[\p{L}0-9]+)*)(?=\s|$)/gu;

// 模拟修复后的插件 handler（带 nativeSupportsCN 早期返回 + alreadyInjected 去重）
async function createPatchedPluginHandler(nativeSupportsCN) {
  return async function pluginHandler({ messages }, next) {
    const decision = await next();
    if (decision.kind === 'reject') return decision;
    if (nativeSupportsCN) {
      // 原生已支持，插件让位
      return decision;
    }
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
    if (names.length === 0) return decision;
    const alreadyInjected = new Set(
      (decision.messages ?? [])
        .filter(m => m?.source?.kind === 'skill-invocation')
        .map(m => m.source.name)
    );
    const injections = [];
    for (const n of names) {
      if (alreadyInjected.has(n)) continue;
      if (/^[a-z0-9-]+$/.test(n)) continue;
      if (!CN_KEBAB.test(n)) continue;
      // mock skill exists for中文
      injections.push({ source: { kind: 'skill-invocation', name: n }, content: `skill_content:${n}` });
    }
    if (injections.length === 0) return decision;
    return { kind: 'enter', messages: [...decision.messages, ...injections] };
  };
}

// 模拟原生 handler（已打 CN 补丁）
async function nativeHandler({ messages }, next) {
  const decision = await next();
  if (decision.kind === 'reject') return decision;
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
  if (names.length === 0) return decision;
  const injections = names.map(n => ({ source: { kind: 'skill-invocation', name: n }, content: `skill_content:${n}` }));
  if (injections.length === 0) return decision;
  return { kind: 'enter', messages: [...decision.messages, ...injections] };
}

function baseDecision() {
  return { kind: 'enter', messages: [] };
}

async function simulate({ pluginIsOuter, nativeSupportsCN, input }) {
  const messages = [{ source: { kind: 'user' }, content: [{ type: 'text', text: input }] }];
  const plugin = await createPatchedPluginHandler(nativeSupportsCN);
  // 构建 next 链
  // 情况1: plugin outer, native inner => plugin(next=native(next=base))
  // 情况2: native outer, plugin inner => native(next=plugin(next=base))

  let result;
  if (pluginIsOuter) {
    result = await plugin({ messages }, async () => await nativeHandler({ messages }, async () => baseDecision()));
  } else {
    result = await nativeHandler({ messages }, async () => await plugin({ messages }, async () => baseDecision()));
  }
  return result;
}

async function run() {
  console.log('=== 测试1: 原生已支持 CN（打过补丁后常规状态） ===');
  for (const outer of ['plugin outer', 'native outer']) {
    const pluginIsOuter = outer === 'plugin outer';
    for (const input of ['/备忘录 Help', '/私家大厨', '/卡路里', '/私家大厨 做菜', '/备忘录', '/help']) {
      const res = await simulate({ pluginIsOuter, nativeSupportsCN: true, input });
      const skillMsgs = res.messages.filter(m => m.source?.kind === 'skill-invocation');
      const names = skillMsgs.map(m => m.source.name);
      const dup = names.length !== new Set(names).size;
      const expected = input.trim().startsWith('/备忘录') || input.trim().startsWith('/私家大厨') || input.trim().startsWith('/卡路里');
      // /help 是 ascii，不应算中文重复，但原生会注入 help（如果存在），这里 mock 都会注入，所以只检查中文去重
      const isChinese = /[\p{L}]/u.test(input.split(/\s/)[0].slice(1)) && !/^[a-z0-9-]+$/.test(input.split(/\s/)[0].slice(1));
      const pass = isChinese ? (skillMsgs.length === 1 && !dup) : true;
      console.log(`  ${outer} | "${input}" => injections:${names.length} ${JSON.stringify(names)} ${dup?'DUPLICATE!':''} ${pass?'PASS':'FAIL'}`);
      if (!pass) {
        console.error('FAIL detected');
        process.exit(1);
      }
    }
  }

  console.log('\n=== 测试2: 原生未支持 CN（首次安装未重启，fallback） ===');
  for (const outer of ['plugin outer', 'native outer']) {
    const pluginIsOuter = outer === 'plugin outer';
    for (const input of ['/备忘录 Help', '/私家大厨']) {
      const res = await simulate({ pluginIsOuter, nativeSupportsCN: false, input });
      const skillMsgs = res.messages.filter(m => m.source?.kind === 'skill-invocation');
      const names = skillMsgs.map(m => m.source.name);
      // 原生未支持时，中文应由 plugin 注入 1 次（原生此时其实不支持中文，但我们的 mock 仍会注入；为模拟真实未补丁，原生应不注入中文）
      // 修正：当 native 未打补丁时，它应只匹配 ascii，不会注入中文。所以这里 native 注入应为空，plugin 注入 1 次
      // 但我们的 native mock 始终是 CN，我们需要另一个 mock：oldNative

      // 手动模拟 old native（ascii only）
      async function oldNativeHandler({ messages }, next) {
        const decision = await next();
        const names = [];
        const OLD_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;
        for (const m of messages) {
          if (m.source?.kind !== 'user') continue;
          for (const block of m.content ?? []) {
            if (block.type !== 'text') continue;
            OLD_GESTURE.lastIndex = 0;
            for (const match of block.text.matchAll(OLD_GESTURE)) {
              const n = match[2];
              if (n && !names.includes(n)) names.push(n);
            }
          }
        }
        if (names.length === 0) return decision;
        const injections = names.map(n => ({ source: { kind: 'skill-invocation', name: n }, content: `skill_content:${n}` }));
        return { kind: 'enter', messages: [...decision.messages, ...injections] };
      }
      // 重新模拟：plugin outer + old native inner
      let res2;
      if (pluginIsOuter) {
        const plugin = await createPatchedPluginHandler(false);
        res2 = await plugin({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: input }] }] }, async () => await oldNativeHandler({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: input }] }] }, async () => baseDecision()));
      } else {
        const plugin = await createPatchedPluginHandler(false);
        res2 = await oldNativeHandler({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: input }] }] }, async () => await plugin({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: input }] }] }, async () => baseDecision()));
      }
      const skillMsgs2 = res2.messages.filter(m => m.source?.kind === 'skill-invocation');
      const names2 = skillMsgs2.map(m => m.source.name);
      const pass2 = names2.length === 1 && names2[0] === input.split(/\s/)[0].slice(1);
      console.log(`  ${outer} (fallback) | "${input}" => injections:${names2.length} ${JSON.stringify(names2)} ${pass2?'PASS':'FAIL'}`);
      if (!pass2) {
        console.error('FAIL fallback');
        process.exit(1);
      }
    }
  }

  console.log('\n=== 测试3: 英文技能不应受影响（单一注入） ===');
  for (const input of ['/help', '/skill-test', '/my-skill arg']) {
    const res = await simulate({ pluginIsOuter: true, nativeSupportsCN: true, input });
    const skillMsgs = res.messages.filter(m => m.source?.kind === 'skill-invocation');
    const names = skillMsgs.map(m => m.source.name);
    // 英文应由原生注入一次，插件跳过英文（if /^[a-z0-9-]+$/ skip）
    const pass = names.length === 1 && !names.includes('') ;
    console.log(`  "${input}" => ${JSON.stringify(names)} ${pass?'PASS':'FAIL'}`);
    if (!pass) {
      console.error('FAIL english');
      process.exit(1);
    }
  }

  console.log('\n=== 测试4: 同一 Turn 多个中文技能名，去重且各一次 ===');
  {
    const input = '/备忘录 /私家大厨 帮我';
    const res = await simulate({ pluginIsOuter: true, nativeSupportsCN: true, input });
    const names = res.messages.filter(m => m.source?.kind === 'skill-invocation').map(m => m.source.name);
    console.log(`  "${input}" => ${JSON.stringify(names)}`);
    const pass = names.length === 2 && names.includes('备忘录') && names.includes('私家大厨');
    console.log(`  ${pass?'PASS':'FAIL'}`);
    if (!pass) process.exit(1);
  }

  console.log('\n=== 测试5: 已有 decision 含注入时的幂等 ===');
  {
    // 模拟 plugin 收到 decision 已含相同注入（outer 场景）
    const plugin = await createPatchedPluginHandler(false); // fallback 但 decision 已有
    const decisionWithInject = { kind: 'enter', messages: [{ source: { kind: 'skill-invocation', name: '备忘录' }, content: 'existing' }] };
    const res = await plugin({ messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '/备忘录 Help' }] }] }, async () => decisionWithInject);
    const names = res.messages.filter(m => m.source?.kind === 'skill-invocation').map(m => m.source.name);
    console.log(`  decision已含备忘录，再次请求 /备忘录 => ${JSON.stringify(names)} count=${names.length}`);
    const pass = names.length === 1;
    console.log(`  ${pass?'PASS':'FAIL'}`);
    if (!pass) process.exit(1);
  }

  console.log('\nAll tests PASS ✅');
}

run().catch(e => { console.error(e); process.exit(1); });
