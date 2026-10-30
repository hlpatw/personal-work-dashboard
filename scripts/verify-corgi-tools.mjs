/**
 * 阶段 4 验收：柯基工具调用全链路（mock 上游 + 真实 REST 落库）。
 * 覆盖：tools 透传 → 确认卡（勾选/标题微调）→ 执行落库 → 工具结果回传 →
 * 流式总结 → 跳过路径。创建的验收任务在 finally 里删除，不污染数据。
 * 用法：node scripts/verify-corgi-tools.mjs（需 dev 已启动）
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:5173';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'corgi-tools');
mkdirSync(OUT, { recursive: true });

/* ---------- mock 上游：按调用序号路由 ---------- */
const TASKS = [
  { title: '验收任务A 写周报', category: '工作', priority: 'high' },
  { title: '验收任务B 订会议室', category: '工作', priority: 'medium' },
  { title: '验收任务C 学ALLMIND架构', category: '学习', priority: 'low' },
];
const SUMMARY = ['搞定啦～', '已创建 2 个任务，', '跳过 1 个。', '加油！'];
const SKIP_REPLY = ['好叭，', '那这轮就不操作啦～'];
const calls = []; // 记录每次上游请求的 body

const upstream = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body);
    calls.push(j);
    const idx = calls.length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const streamText = (arr, done) => {
      frame({ choices: [{ delta: { role: 'assistant' } }] });
      let i = 0;
      const tick = () => {
        if (i < arr.length) {
          frame({ choices: [{ delta: { content: arr[i++] } }] });
          setTimeout(tick, 120);
        } else {
          res.write('data: [DONE]\n\n');
          res.end();
          if (done) done();
        }
      };
      setTimeout(tick, 120);
    };

    if (idx === 1) {
      // 第 1 轮：分片返回 create_tasks 工具调用
      frame({ choices: [{ delta: { role: 'assistant' } }] });
      frame({
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_create_1', function: { name: 'create_tasks', arguments: '{"ta' } }] } }],
      });
      frame({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: `sks":${JSON.stringify(TASKS)}}` } }] } }],
      });
      res.write('data: [DONE]\n\n');
      res.end();
    } else if (idx === 2) {
      streamText(SUMMARY); // 确认执行后的总结
    } else if (idx === 3) {
      // 第 2 轮：create_inspirations（之后走"全部跳过"）
      frame({ choices: [{ delta: { role: 'assistant' } }] });
      frame({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_insp_1', function: { name: 'create_inspirations', arguments: '{"inspirations":[{"content":"今晚早点睡"}]}' } },
              ],
            },
          },
        ],
      });
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      streamText(SKIP_REPLY);
    }
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

/* ---------- 浏览器 ---------- */
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const ok = (name, cond) => {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${name}`);
  if (!cond) process.exitCode = 1;
};
const api = (path) => page.evaluate((p) => fetch(p).then((r) => r.json()), path);
const createdTaskIds = [];

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate((cfg) => {
    localStorage.setItem('dashboard-ai-config', JSON.stringify(cfg));
    localStorage.setItem('dashboard-corgi-chat', JSON.stringify({ state: { sessions: [], activeSessionId: '', open: true, width: 380 }, version: 1 }));
  }, aiConfig);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // 1. 发送 → 确认卡出现
  await page.fill('textarea', '帮我整理成任务');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="corgi-tool-card"]', { timeout: 8000 });
  const card = page.locator('[data-testid="corgi-tool-card"]');
  ok('确认卡出现', true);
  ok('卡头显示 3 个任务', ((await card.textContent()) ?? '').includes('创建 3 个任务'));
  const boxes = card.locator('input[type="checkbox"]');
  ok('3 个条目全部默认勾选', (await boxes.count()) === 3);

  // 2. 上游第 1 次请求：带 5 个 tools + system 含工具守则
  const c1 = calls[0];
  ok('上游收到 tools（5 个）', c1?.tools?.length === 5);
  ok('system 注入工具守则', (c1?.messages?.find((m) => m.role === 'system')?.content ?? '').includes('使用守则'));

  // 3. 标题微调 + 去勾一条 → 确认执行
  await card.locator('input:not([type="checkbox"])').nth(0).fill('验收任务A 写周报（改）');
  await page.uncheck('[data-testid="corgi-tool-check-0-2"]'); // 去掉任务C
  await page.screenshot({ path: join(OUT, 'a-确认卡-待确认.png') });
  await page.click('[data-testid="corgi-tool-confirm"]');

  // 4. 卡翻结果态：成功 2 · 跳过 1
  await page.waitForSelector('[data-testid="corgi-tool-card"]:has-text("成功 2 项")', { timeout: 8000 });
  ok('结果态显示 成功2/跳过1', ((await card.textContent()) ?? '').includes('跳过 1 项'));

  // 5. 真实落库：A（改后标题）与 B 存在，C 不存在
  const tasks = await api('/api/tasks?q=' + encodeURIComponent('验收任务'));
  const titles = tasks.map((t) => t.title);
  ok('任务A 按微调标题创建', titles.includes('验收任务A 写周报（改）'));
  ok('任务B 创建', titles.includes('验收任务B 订会议室'));
  ok('任务C 未创建（被去勾）', !titles.some((t) => t.includes('ALLMIND')));
  for (const t of tasks) createdTaskIds.push(t.id);

  // 6. 流式总结渲染 + 上游第 2 次收到工具结果
  await page.waitForSelector(`text=已创建 2 个任务`, { timeout: 8000 });
  ok('总结流式渲染', true);
  const c2 = calls[1];
  const toolMsg = c2?.messages?.find((m) => m.role === 'tool');
  ok('工具结果以 role:tool 回传', Boolean(toolMsg));
  ok('结果含 skip 状态', (toolMsg?.content ?? '').includes('"skip"'));
  ok('assistant tool_calls 一并回传', c2?.messages?.some((m) => m.role === 'assistant' && Array.isArray(m.tool_calls)));
  ok('第二轮仍带 tools', c2?.tools?.length === 5);
  await page.screenshot({ path: join(OUT, 'b-结果卡与总结.png') });

  // 7. localStorage 持久化：tool 消息 + 工具调用记录
  const stored = await page.evaluate(() => localStorage.getItem('dashboard-corgi-chat'));
  ok('toolCalls 记录已持久化', stored.includes('"toolCalls"'));
  ok('tool 结果已持久化', stored.includes('"role":"tool"'));

  // 8. 跳过路径：再触发一轮工具 → 全部跳过 → 上游收到 skipped:true → 不落库
  await page.fill('textarea', '帮我记个灵感');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="corgi-tool-card"]:has-text("记录 1 条灵感")', { timeout: 8000 });
  await page.screenshot({ path: join(OUT, 'c-确认卡-灵感.png') });
  await page.click('[data-testid="corgi-tool-skip"]');
  await page.waitForSelector('text=那这轮就不操作啦', { timeout: 8000 });
  const c4 = calls[3];
  // 历史里混着上一轮的 tool 消息，按 tool_call_id 精确找本轮跳过结果
  const skipMsg = c4?.messages?.find((m) => m.role === 'tool' && m.tool_call_id === 'call_insp_1');
  ok('跳过回传 skipped:true', (skipMsg?.content ?? '').includes('"skipped":true'));
  const insp = await api('/api/inspirations?q=' + encodeURIComponent('今晚早点睡'));
  ok('灵感未落库（跳过）', insp.length === 0);
  await page.screenshot({ path: join(OUT, 'd-跳过后总结.png') });
} finally {
  // 清理现场：删除验收建的任务（不动其他数据）
  for (const id of createdTaskIds) {
    await page.evaluate((tid) => fetch(`/api/tasks/${tid}`, { method: 'DELETE' }).catch(() => {}), id).catch(() => {});
  }
  await browser.close();
  upstream.closeAllConnections?.();
  await new Promise((r) => upstream.close(() => r()));
}

console.log(errors.length ? `\n[控制台错误 ${errors.length} 条]\n` + errors.slice(0, 8).join('\n') : '\n[无控制台错误]');
console.log('截图目录:', OUT);
