/**
 * v1.6.1 热修验收：tools 被上游拒绝时的降级链路 + schema 保守化。
 * mock 上游：带 tools 的请求 → 400（报错含 tool，模拟严格校验的提供商）；
 * 不带 tools 的请求 → 正常流式回复。
 * 断言：11 工具仍发送、schema 无数组 type、降级 notice 可见、降级后正常回复、
 * 第二次请求不带 tools、system 守则仍在、无控制台错误。
 * 用法：node scripts/verify-corgi-tools-fallback.mjs（需 dev 已启动）
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:5173';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'corgi-tools-fallback');
mkdirSync(OUT, { recursive: true });

const REPLY = ['抱歉呀，', '我这轮没有工具可用。'];
const calls = [];

const upstream = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body);
    calls.push(j);
    if (Array.isArray(j.tools) && j.tools.length) {
      // 模拟严格校验的 OpenAI 兼容端：拒绝工具 schema
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: "Invalid schema for tool 'update_tasks': In context 'functions.0', 'type' must be a string." },
        }),
      );
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    frame({ choices: [{ delta: { role: 'assistant' } }] });
    let i = 0;
    const tick = () => {
      if (i < REPLY.length) {
        frame({ choices: [{ delta: { content: REPLY[i++] } }] });
        setTimeout(tick, 120);
      } else {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    };
    setTimeout(tick, 120);
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const aiConfig = {
  state: {
    baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
    apiKey: 'sk-test',
    model: 'mock-model',
    systemPrompt: '',
    todayContext: false,
    toolsEnabled: true,
  },
  version: 0,
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errors = [];
// 本场景 502 是降级的正常触发器（后端如实转发上游 400），浏览器的资源报错是预期噪音
page.on('console', (m) => {
  if (m.type() === 'error' && !/\(Bad Gateway\)|502/.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

const ok = (name, cond) => {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${name}`);
  if (!cond) process.exitCode = 1;
};

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate((cfg) => {
    localStorage.setItem('dashboard-ai-config', JSON.stringify(cfg));
    localStorage.setItem('dashboard-corgi-chat', JSON.stringify({ state: { sessions: [], activeSessionId: '', open: true, width: 380 }, version: 1 }));
  }, aiConfig);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  await page.fill('textarea', '帮我删掉一个任务');
  await page.keyboard.press('Enter');

  // 1. 第一轮上游收到 11 个工具
  await page.waitForTimeout(1200); // 等降级重试完成
  const c1 = calls[0];
  ok('第一轮带 11 个 tools', c1?.tools?.length === 11);
  const toolsJson = JSON.stringify(c1?.tools ?? []);
  ok('schema 无数组 type（保守化生效）', !toolsJson.includes('["string","null"]') && !toolsJson.includes('["number","null"]'));

  // 2. 降级 notice 可见
  const notice = page.locator('[data-testid="corgi-fallback-notice"]');
  ok('降级 notice 出现', (await notice.count()) === 1);
  const noticeText = (await notice.textContent()) ?? '';
  ok('notice 含降级说明与原因', noticeText.includes('降级') && noticeText.includes('tool'));

  // 3. 降级后回复正常渲染（不是报错中断）
  await page.waitForSelector('text=我这轮没有工具可用', { timeout: 8000 });
  ok('降级后正常流式回复', true);
  await page.screenshot({ path: join(OUT, 'a-降级提示与回复.png') });

  // 4. 第二次上游请求不带 tools；system 守则仍在
  const c2 = calls[1];
  ok('重试请求不带 tools', c2 && c2.tools === undefined);
  ok('system 守则仍在（HINT 不受降级影响）', (c2?.messages?.find((m) => m.role === 'system')?.content ?? '').includes('使用守则'));

  ok('无控制台错误', errors.length === 0);
} finally {
  await browser.close();
  upstream.closeAllConnections?.();
  await new Promise((r) => upstream.close(() => r()));
}

console.log(errors.length ? `\n[控制台错误 ${errors.length} 条]\n` + errors.slice(0, 8).join('\n') : '\n[无控制台错误]');
console.log('截图目录:', OUT);
