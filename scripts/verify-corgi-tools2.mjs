/**
 * 柯基工具调用扩展验收：update_tasks / update_goals / delete_tasks 全链路。
 * 覆盖：更新卡属性微调（date/select 编辑器，微调值覆盖模型 args）→ 子任务保留的合并 PUT →
 * 目标合并保留（target_date/note 不丢）→ 删除卡红色警示 → 真实落库与回传。
 * 种子任务/目标走真实 REST 创建，finally 里删除，不污染数据。
 * 用法：node scripts/verify-corgi-tools2.mjs（需 dev 已启动）
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:5173';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'corgi-tools2');
mkdirSync(OUT, { recursive: true });

const localDate = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const TASK_TITLE = '验收任务U 更新链路';
const GOAL_TITLE = '验收目标U';
const GOAL_RENAMED = '验收目标U 改名';

/* ---------- mock 上游：按调用序号路由 ---------- */
const SUMMARY1 = ['改好了～', '截止和优先级都按确认卡上的值更新了。'];
const SUMMARY2 = ['目标名改好了～'];
const SUMMARY3 = ['删掉啦～', '子任务也一并清理了。'];
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
      toolCall('call_upd_1', 'update_tasks', {
        tasks: [{ title: TASK_TITLE, due_date: '2026-11-10', priority: 'high' }],
      });
    } else if (idx === 2) {
      streamText(SUMMARY1); // 确认执行后的总结
    } else if (idx === 3) {
      toolCall('call_goal_1', 'update_goals', {
        goals: [{ title: GOAL_TITLE, new_title: GOAL_RENAMED }],
      });
    } else if (idx === 4) {
      streamText(SUMMARY2);
    } else if (idx === 5) {
      toolCall('call_del_1', 'delete_tasks', {
        tasks: [{ title: TASK_TITLE }],
      });
    } else if (idx === 6) {
      streamText(SUMMARY3);
    } else {
      streamText(['嗯？']);
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
let cleaning = false; // finally 清理期对已删资源的 404 是预期行为，不计入
page.on('console', (m) => { if (m.type() === 'error' && !cleaning) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', (r) => { if (!cleaning && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

const ok = (name, cond) => {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${name}`);
  if (!cond) process.exitCode = 1;
};
const api = (path) => page.evaluate((p) => fetch(p).then((r) => r.json()), path);
const apiPost = (path, body) =>
  page.evaluate(
    ({ p, b }) =>
      fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json()),
    { p: path, b: body },
  );

let taskId = 0;
let goalId = 0;

try {
  /* ---------- 种子：任务（带 2 个子任务 + 标签）与目标 ---------- */
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate((cfg) => {
    localStorage.setItem('dashboard-ai-config', JSON.stringify(cfg));
    localStorage.setItem('dashboard-corgi-chat', JSON.stringify({ state: { sessions: [], activeSessionId: '', open: true, width: 380 }, version: 1 }));
  }, aiConfig);
  const seededTask = await apiPost('/api/tasks', {
    title: TASK_TITLE,
    description: '',
    category: '工作',
    priority: 'low',
    status: 'todo',
    due_date: localDate(),
    estimated_minutes: null,
    tags: ['验收'],
    goal_id: null,
    image_url: null,
    subtasks: [
      { title: '子任务1', done: false },
      { title: '子任务2', done: true },
    ],
  });
  taskId = seededTask.id;
  const seededGoal = await apiPost('/api/goals', {
    title: GOAL_TITLE,
    note: '原备注',
    category: '工作',
    target_date: '2026-12-31',
    status: 'active',
    image_url: null,
  });
  goalId = seededGoal.id;
  ok('种子任务/目标已创建', taskId > 0 && goalId > 0);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  /* ---------- 1. update_tasks：确认卡 + 属性微调 ---------- */
  await page.fill('textarea', '把验收任务U的截止改到 11 月 10 号，优先级调高');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="corgi-tool-card"]', { timeout: 8000 });
  const card = page.locator('[data-testid="corgi-tool-card"]');
  ok('更新卡出现（更新 1 个任务）', ((await card.textContent()) ?? '').includes('更新 1 个任务'));

  const c1 = calls[0];
  ok('上游收到 tools（11 个）', c1?.tools?.length === 11);
  ok('system 守则含删除安全规则', (c1?.messages?.find((m) => m.role === 'system')?.content ?? '').includes('删除是危险操作'));

  const dateEditor = page.locator('[data-testid="corgi-tool-field-0-0-due_date"]');
  const priEditor = page.locator('[data-testid="corgi-tool-field-0-0-priority"]');
  ok('日期编辑器初值 = 模型值', (await dateEditor.inputValue()) === '2026-11-10');
  ok('优先级编辑器初值 = 模型值', (await priEditor.inputValue()) === 'high');

  // 卡上微调：改日期与优先级（应覆盖模型 args）
  await dateEditor.fill('2026-11-06');
  await priEditor.selectOption('urgent');
  await page.screenshot({ path: join(OUT, 'a-更新卡-微调后.png') });
  await page.click('[data-testid="corgi-tool-confirm"]');

  await page.waitForSelector('[data-testid="corgi-tool-card"]:has-text("成功 1 项")', { timeout: 8000 });
  ok('结果态成功 1 项 + 变更摘要', ((await card.textContent()) ?? '').includes('截止 2026-11-06'));

  const after = await api(`/api/tasks/${taskId}`);
  ok('截止日期 = 卡上微调值', after.due_date === '2026-11-06');
  ok('优先级 = 卡上微调值', after.priority === 'urgent');
  ok('子任务保留（合并 PUT 未清空）', after.subtask_total === 2);
  ok('未传字段不动（标签保留）', JSON.stringify(after.tags) === JSON.stringify(['验收']));
  await page.waitForSelector('text=截止和优先级都按确认卡上的值更新了', { timeout: 8000 });

  const c2 = calls[1];
  const toolMsg = c2?.messages?.find((m) => m.role === 'tool' && m.tool_call_id === 'call_upd_1');
  ok('微调值随 role:tool 回传模型', (toolMsg?.content ?? '').includes('2026-11-06') && (toolMsg?.content ?? '').includes('紧急'));
  ok('第二轮仍带 tools（11 个）', c2?.tools?.length === 11);

  /* ---------- 2. update_goals：改名 + 合并保留 ---------- */
  await page.fill('textarea', '把这个目标改个名');
  await page.keyboard.press('Enter');
  // 历史消息里已有上一轮的卡，按文案限定到本轮的卡（坑：同名 testid 多处出现）
  const goalCard = page.locator('[data-testid="corgi-tool-card"]:has-text("更新 1 个目标")');
  await goalCard.waitFor({ timeout: 8000 });
  ok('改名卡标题输入框 = 新名', (await goalCard.locator('input:not([type="checkbox"])').first().inputValue()) === GOAL_RENAMED);
  ok('改名卡带「原：」徽章', ((await goalCard.textContent()) ?? '').includes(`原：${GOAL_TITLE}`));
  await page.screenshot({ path: join(OUT, 'b-目标改名卡.png') });
  await goalCard.locator('[data-testid="corgi-tool-confirm"]').click();
  await page.waitForSelector('text=目标名改好了', { timeout: 8000 });

  const goalAfter = (await api('/api/goals')).find((g) => g.id === goalId);
  ok('目标已改名', goalAfter?.title === GOAL_RENAMED);
  ok('目标合并保留 target_date', goalAfter?.target_date === '2026-12-31');
  ok('目标合并保留 note', goalAfter?.note === '原备注');

  /* ---------- 3. delete_tasks：红色警示 + 真删 ---------- */
  await page.fill('textarea', '删掉验收任务U');
  await page.keyboard.press('Enter');
  const delCard = page.locator('[data-testid="corgi-tool-card"]:has-text("删除 1 个任务")');
  await delCard.waitFor({ timeout: 8000 });
  ok('删除卡带不可恢复警示行', ((await delCard.textContent()) ?? '').includes('删除操作不可恢复'));
  const confirmBtn = delCard.locator('[data-testid="corgi-tool-confirm"]');
  ok('确认按钮文案 = 确认删除', ((await confirmBtn.textContent()) ?? '').includes('确认删除'));
  const borderCls = (await delCard.getAttribute('class')) ?? '';
  ok('删除卡红色边框', borderCls.includes('border-red-500/35') && borderCls.includes('dark:border-red-400/30'));
  await page.screenshot({ path: join(OUT, 'c-删除卡-警示.png') });
  await confirmBtn.click();
  await page.waitForSelector('text=子任务也一并清理了', { timeout: 8000 });

  const gone = await api('/api/tasks?q=' + encodeURIComponent('验收任务U'));
  ok('任务已真实删除', gone.length === 0);

  /* ---------- 4. 持久化 ---------- */
  const stored = await page.evaluate(() => localStorage.getItem('dashboard-corgi-chat'));
  ok('toolCalls 记录已持久化', stored.includes('"toolCalls"') && stored.includes('update_tasks'));
  await page.screenshot({ path: join(OUT, 'd-删除后总结.png') });
} finally {
  cleaning = true;
  if (taskId) {
    await page.evaluate((tid) => fetch(`/api/tasks/${tid}`, { method: 'DELETE' }).catch(() => {}), taskId).catch(() => {});
  }
  if (goalId) {
    await page.evaluate((gid) => fetch(`/api/goals/${gid}`, { method: 'DELETE' }).catch(() => {}), goalId).catch(() => {});
  }
  await browser.close();
  upstream.closeAllConnections?.();
  await new Promise((r) => upstream.close(() => r()));
}

console.log(errors.length ? `\n[控制台错误 ${errors.length} 条]\n` + errors.slice(0, 8).join('\n') : '\n[无控制台错误]');
console.log('截图目录:', OUT);
