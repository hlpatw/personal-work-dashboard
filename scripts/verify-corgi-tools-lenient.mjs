/**
 * v1.6.2 验收：坏调用诊断信息 + 参数宽容解析 + 模型自我纠正。
 * 场景：模型先调错（单数工具名 delete_task）→ 收到带名字的报错 →
 * 下一轮自我纠正（delete_tasks + 裸字符串数组）→ 宽容解析进确认卡 → 确认真删。
 * 用法：node scripts/verify-corgi-tools-lenient.mjs（需 dev 已启动）
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:5173';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'corgi-tools-lenient');
mkdirSync(OUT, { recursive: true });

const TASK_TITLE = '验收任务L 宽容解析';
const SUMMARY = ['这次调对啦～', '任务已删除。'];
const calls = [];

const upstream = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body);
    calls.push(j);
    const idx = calls.length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const toolCall = (id, name, args) => {
      frame({ choices: [{ delta: { role: 'assistant' } }] });
      frame({ choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] } }] });
      res.write('data: [DONE]\n\n');
      res.end();
    };
    const streamText = (arr) => {
      frame({ choices: [{ delta: { role: 'assistant' } }] });
      let i = 0;
      const tick = () => {
        if (i < arr.length) {
          frame({ choices: [{ delta: { content: arr[i++] } }] });
          setTimeout(tick, 120);
        } else {
          res.write('data: [DONE]\n\n');
          res.end();
        }
      };
      setTimeout(tick, 120);
    };

    if (idx === 1) {
      // 第 1 轮：弱模型典型错误——单数工具名
      toolCall('call_bad_1', 'delete_task', { task: TASK_TITLE });
    } else if (idx === 2) {
      // 第 2 轮：看到具体报错后自我纠正——工具名改对，但参数用裸字符串数组
      toolCall('call_ok_1', 'delete_tasks', { tasks: [TASK_TITLE] });
    } else {
      streamText(SUMMARY);
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

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errors = [];
let cleaning = false; // finally 清理期对已删资源的 404 是预期行为，不计入
page.on('console', (m) => { if (m.type() === 'error' && !cleaning) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const ok = (name, cond) => {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${name}`);
  if (!cond) process.exitCode = 1;
};
const api = (path) => page.evaluate((p) => fetch(p).then((r) => r.json()), path);

let taskId = 0;
try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate((cfg) => {
    localStorage.setItem('dashboard-ai-config', JSON.stringify(cfg));
    localStorage.setItem('dashboard-corgi-chat', JSON.stringify({ state: { sessions: [], activeSessionId: '', open: true, width: 380 }, version: 1 }));
  }, aiConfig);
  const seeded = await page.evaluate(
    (t) =>
      fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: t, description: '', category: '工作', priority: 'medium', status: 'todo', due_date: null, estimated_minutes: null, tags: [], goal_id: null, image_url: null, subtasks: [] }),
      }).then((r) => r.json()),
    TASK_TITLE,
  );
  taskId = seeded.id;
  ok('种子任务已创建', taskId > 0);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // 1. 坏调用：单数工具名 → 结果卡显示具体原因（含模型实际用的名字）
  //    注意：确认卡可能紧随其后出现，此处按文案精确定位坏调用卡（坑 19）
  await page.fill('textarea', '帮我删掉一个任务');
  await page.keyboard.press('Enter');
  const badCard = page.locator('[data-testid="corgi-tool-card"]:has-text("未知工具")');
  await badCard.waitFor({ timeout: 8000 });
  ok('坏调用卡显示「未知工具 delete_task」', ((await badCard.textContent()) ?? '').includes('未知工具 "delete_task"'));

  // 2. 报错随 role:tool 回传（模型下一轮才能看到）
  await page.waitForSelector('[data-testid="corgi-tool-card"]:has-text("删除 1 个任务")', { timeout: 8000 });
  const c2 = calls[1];
  const toolMsg = c2?.messages?.find((m) => m.role === 'tool' && m.tool_call_id === 'call_bad_1');
  ok('坏调用原因以 role:tool 回传模型', (toolMsg?.content ?? '').includes('未知工具'));

  // 3. 自我纠正的调用（裸字符串数组）被宽容解析进确认卡，条目标题正确
  const delCard = page.locator('[data-testid="corgi-tool-card"]:has-text("删除 1 个任务")');
  ok('宽容解析：字符串条目进了确认卡', (await delCard.locator('input:not([type="checkbox"])').first().inputValue()) === TASK_TITLE);
  await page.screenshot({ path: join(OUT, 'a-纠正后确认卡.png') });

  // 4. 确认 → 真删
  await delCard.locator('[data-testid="corgi-tool-confirm"]').click();
  await page.waitForSelector('text=任务已删除', { timeout: 8000 });
  const gone = await api('/api/tasks?q=' + encodeURIComponent(TASK_TITLE));
  ok('确认后任务真实删除', gone.length === 0);

  ok('无控制台错误', errors.length === 0);
} finally {
  cleaning = true;
  if (taskId) {
    await page.evaluate((tid) => fetch(`/api/tasks/${tid}`, { method: 'DELETE' }).catch(() => {}), taskId).catch(() => {});
  }
  await browser.close();
  upstream.closeAllConnections?.();
  await new Promise((r) => upstream.close(() => r()));
}

console.log(errors.length ? `\n[控制台错误 ${errors.length} 条]\n` + errors.slice(0, 8).join('\n') : '\n[无控制台错误]');
console.log('截图目录:', OUT);
