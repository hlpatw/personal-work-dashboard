/**
 * 阶段 2 验收：柯基多会话（迁移 + 菜单 + 新建/切换/删除 + 刷新保持）。
 * 用法：node scripts/verify-corgi-sessions.mjs（需 dev 已启动）
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:5173';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'corgi-sessions');
mkdirSync(OUT, { recursive: true });

/* ---------- mock 上游（固定回复，慢速 SSE） ---------- */
const upstream = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    frame({ choices: [{ delta: { role: 'assistant' } }] });
    let i = 0;
    const REPLY = ['好', '的', '哟', '～'];
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
  },
  version: 0,
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

const ok = (name, cond) => {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${name}`);
  if (!cond) process.exitCode = 1;
};
const readStore = () => page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-corgi-chat') ?? '{}'));

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
// 造一份 v0 旧数据（扁平 messages）+ mock AI 配置
await page.evaluate(
  ([cfg]) => {
    localStorage.setItem('dashboard-ai-config', JSON.stringify(cfg));
    localStorage.setItem(
      'dashboard-corgi-chat',
      JSON.stringify({
        state: {
          messages: [
            { role: 'user', content: '旧会话的第一句话，聊了点工作' },
            { role: 'assistant', content: '旧的回复内容' },
          ],
          open: true,
        },
        version: 0,
      }),
    );
  },
  [aiConfig],
);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 1. v0 → v1 迁移：旧消息变成一个会话，标题取首条 user 消息
let store = await readStore();
ok('迁移后 version:1', store.version === 1);
ok('旧消息迁移为 1 个会话', store.state?.sessions?.length === 1);
ok('标题取首条用户消息', store.state?.sessions?.[0]?.title === '旧会话的第一句话，聊了点工作');
ok('旧消息内容完整保留', store.state?.sessions?.[0]?.messages?.length === 2);
ok('旧会话被激活', store.state?.activeSessionId === store.state?.sessions?.[0]?.id);
ok('界面显示旧会话消息', (await page.locator('text=旧的回复内容').count()) === 1);

// 2. 会话菜单：展开、列表、当前项高亮
await page.click('[data-testid="corgi-session-trigger"]');
await page.waitForTimeout(350);
ok('菜单展开', (await page.locator('[data-testid="corgi-session-menu"]').count()) === 1);
ok('菜单里有会话条目', (await page.locator('[data-testid="corgi-session-menu"] .group').count()) === 1);
await page.screenshot({ path: join(OUT, 'a-会话菜单.png') });

// 3. 新对话 → 空会话（欢迎卡）→ 发消息 → 惰性入列 + 自动标题
await page.click('[data-testid="corgi-new-session"]');
await page.waitForTimeout(300);
ok('新对话为空（欢迎卡出现）', (await page.locator('text=嗨，我是柯基').count()) === 1);
ok('空会话未入列', (await readStore()).state?.sessions?.length === 1);
await page.fill('textarea', '帮我看看这周的安排');
await page.keyboard.press('Enter');
await page.waitForSelector('text=好的哟～', { timeout: 8000 });
store = await readStore();
ok('首条发言后惰性入列', store.state?.sessions?.length === 2);
const newSession = store.state.sessions.find((s) => s.title.includes('这周的安排'));
ok('新会话自动命名', Boolean(newSession));
ok('新会话消息齐（user+assistant）', newSession?.messages?.length === 2);

// 4. 切回旧会话 → 消息隔离
await page.click('[data-testid="corgi-session-trigger"]');
await page.waitForTimeout(300);
await page.click('[data-testid="corgi-session-menu"] .group:has-text("旧会话的第一句话")');
await page.waitForTimeout(300);
ok('切回旧会话显示旧消息', (await page.locator('text=旧的回复内容').count()) === 1);
ok('切换后无新会话内容', (await page.locator('text=帮我看看这周的安排').count()) === 0);
await page.screenshot({ path: join(OUT, 'b-切回旧会话.png') });

// 5. 删除当前旧会话 → 自动切到另一会话
await page.click('[data-testid="corgi-session-trigger"]');
await page.waitForTimeout(300);
await page.click('[data-testid="corgi-session-menu"] .group:has-text("旧会话的第一句话") >> button[title="删除会话"]');
await page.waitForTimeout(400);
store = await readStore();
ok('删除后会话数 -1', store.state?.sessions?.length === 1);
// 菜单仍开着：标题会同时出现在菜单行 + 消息气泡两处，故断言 ≥1
ok('删除当前会话自动切换', (await page.locator('text=帮我看看这周的安排').count()) >= 1);
ok('旧会话内容已消失', (await page.locator('text=旧的回复内容').count()) === 0);

// 6. 刷新 → 会话保持
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
store = await readStore();
ok('刷新后会话保持', store.state?.sessions?.length === 1 && Boolean(store.state?.activeSessionId));
ok('刷新后消息保持', (await page.locator('text=帮我看看这周的安排').count()) === 1);
await page.screenshot({ path: join(OUT, 'c-刷新后保持.png') });

await browser.close();
upstream.closeAllConnections?.();
await new Promise((r) => upstream.close(() => r()));
console.log(errors.length ? `\n[控制台错误 ${errors.length} 条]\n` + errors.slice(0, 5).join('\n') : '\n[无控制台错误]');
console.log('截图目录:', OUT);
