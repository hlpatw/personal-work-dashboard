/**
 * 柯基 AI 增强 验收：流式输出、今日安排开关、周报卡点评、check-pop 修复。
 * （柯基形象进界面已于 2026-10-18 按用户反馈回退，本脚本不再验证像素组件，
 *   反向断言界面里没有像素犬 svg。）
 * 用法：node scripts/verify-corgi.mjs（需 dev 已启动）
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:5173';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'corgi');
mkdirSync(OUT, { recursive: true });

/* ---------- mock OpenAI 兼容上游（慢速 SSE，保证能截到中间态） ---------- */
const REPLY = ['今天', '记得', '喝', '水~'];
const calls = [];
let chunkGap = 300;

const upstream = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body);
    const system = j.messages?.find((m) => m.role === 'system')?.content ?? '';
    const lastUser = [...(j.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '';
    calls.push({ stream: j.stream === true, system, lastUser });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    frame({ choices: [{ delta: { role: 'assistant' } }] }); // role-only 首块
    let i = 0;
    const tick = () => {
      if (i < REPLY.length) {
        frame({ choices: [{ delta: { content: REPLY[i++] } }] });
        setTimeout(tick, chunkGap);
      } else {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    };
    setTimeout(tick, chunkGap);
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const upstreamPort = upstream.address().port;
const aiConfig = {
  state: {
    baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
    apiKey: 'sk-test',
    model: 'mock-model',
    systemPrompt: '',
    todayContext: true,
  },
  version: 0,
};

/* ---------- 浏览器 ---------- */
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const ok = (name, cond) => {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${name}`);
  if (!cond) process.exitCode = 1;
};

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate((cfg) => localStorage.setItem('dashboard-ai-config', JSON.stringify(cfg)), aiConfig);
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('button[title="展开柯基助手"]');
  await page.waitForTimeout(400);

  // 1. 形象回退确认：侧栏里没有像素犬 svg（🐕 emoji 回归）
  ok('界面无像素犬（已回退）', (await page.locator('aside svg[shape-rendering]').count()) === 0);

  // 2. 今日安排 chip 默认开
  const chip = page.locator('button', { hasText: '今日安排' }).first();
  ok('今日安排 chip 默认开', (await chip.textContent())?.includes('开'));

  // 3. 流式发送：中间态 + 完整回复 + 上游收到 stream:true 与今日快照
  const callsBefore = calls.length;
  await page.fill('textarea', '你好');
  await page.keyboard.press('Enter');
  let sawIntermediate = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(120);
    const t = await page.locator('.corgi-md').last().textContent().catch(() => '');
    if (t && t.length > 0 && t.length < 6) sawIntermediate = true;
  }
  await page.waitForSelector(`text=今天记得喝水~`, { timeout: 8000 });
  ok('流式逐段渲染（观测到中间态）', sawIntermediate);
  await page.screenshot({ path: join(OUT, 'a-流式完成.png') });
  const c1 = calls[callsBefore];
  ok('上游收到 stream:true', c1?.stream === true);
  ok('system 注入今日快照（开关开）', c1?.system.includes('今日工作台快照'));
  const stored = await page.evaluate(() => localStorage.getItem('dashboard-corgi-chat'));
  ok('回复完整持久化', stored.includes('今天记得喝水~'));

  // 4. 关掉今日安排再发：system 不含快照，然后还原
  await chip.click();
  await page.fill('textarea', '再说一句');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const c2 = calls[calls.length - 1];
  ok('开关关 → 不注入快照', c2 && !c2.system.includes('今日工作台快照'));
  await chip.click();

  // 5. 空对话快捷指令：新对话（会话菜单入口）→ 填入但不直接发送
  page.on('dialog', (d) => d.accept());
  await page.click('[data-testid="corgi-session-trigger"]');
  await page.waitForTimeout(300);
  await page.click('[data-testid="corgi-new-session"]');
  await page.waitForTimeout(300);
  const quick = page.locator('button', { hasText: '帮我安排今天' });
  if (await quick.count()) {
    await quick.click();
    const draftVal = await page.inputValue('textarea');
    ok('快捷指令填入输入框（不发送）', draftVal.includes('安排'));
  } else {
    ok('快捷指令按钮存在', false);
  }

  // 6. 周报卡：存在 + 点评联动（自动发送含【本周周报】的消息）
  await page.goto(BASE + '/stats', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=本周周报');
  await page.screenshot({ path: join(OUT, 'b-周报卡.png') });
  ok('周报卡渲染', true);
  const callsBefore2 = calls.length;
  await page.click('button:has-text("让柯基点评")');
  await page.waitForTimeout(2200);
  const c3 = calls[callsBefore2];
  ok('点评消息含周报数据', (c3?.lastUser ?? '').includes('本周周报'));
  await page.screenshot({ path: join(OUT, 'c-柯基点评.png') });

  // 7. check-pop 动画修复保留：样式表里有 checkPop 规则
  const hasCheckPop = await page.evaluate(() =>
    [...document.styleSheets].some((ss) => {
      try {
        return [...ss.cssRules].some((r) => r.cssText.includes('checkPop'));
      } catch {
        return false;
      }
    })
  );
  ok('check-pop 动画 CSS 存在（修复保留）', hasCheckPop);

  // 8. 浅色主题关键截图（侧栏可能已展开，容错）
  await page.click('button[title="切换主题"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'f-周报卡-浅.png') });
  const handleBtn = page.locator('button[title="展开柯基助手"]');
  if ((await handleBtn.count()) > 0) await handleBtn.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, 'g-柯基侧栏-浅.png') });
} finally {
  await browser.close();
  upstream.closeAllConnections?.();
  await new Promise((r) => upstream.close(() => r()));
}

console.log(errors.length ? `\n[控制台错误 ${errors.length} 条]\n` + errors.slice(0, 8).join('\n') : '\n[无控制台错误]');
console.log('截图目录:', OUT);
