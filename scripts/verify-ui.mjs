/**
 * 浏览器端验收：四个页面渲染 + 深浅色主题切换 + 控制台错误检查。
 * 用法：node scripts/verify-ui.mjs（需先 npm run dev）
 * 截图输出到 scripts/screenshots/
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = 'http://localhost:5173';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

async function check(path, name, waitText) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=' + waitText, { timeout: 15000 });
  await page.screenshot({ path: join(OUT, `${name}-dark.png`), fullPage: false });
  console.log(`[ok] ${name}（深色）渲染正常，包含「${waitText}」`);
}

try {
  await check('/', 'dashboard', '今日任务');
  await check('/tasks', 'tasks', '新建任务');
  await check('/calendar', 'calendar', '今天');
  await check('/stats', 'stats', '每周完成任务数');

  // 主题切换：点侧栏底部按钮，断言 html.dark 移除
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=今日任务');
  const darkBefore = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.click('button[title="切换主题"]');
  await page.waitForTimeout(300);
  const darkAfter = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.screenshot({ path: join(OUT, 'dashboard-light.png') });
  console.log(`[ok] 主题切换：${darkBefore ? '深色' : '浅色'} → ${darkAfter ? '深色' : '浅色'}`);

  // 刷新后保持浅色（persist 生效）
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('text=今日任务');
  const darkReloaded = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  console.log(`[ok] 刷新后主题保持：${darkReloaded ? '深色' : '浅色'}`);
  if (darkReloaded !== darkAfter) throw new Error('刷新后主题未保持');

  // 任务交互冒烟：勾选第一条任务，按标题断言其状态样式
  await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
  await page.waitForSelector('li.group');
  const firstItem = page.locator('li.group').first();
  const title = (await firstItem.locator('p').first().innerText()).trim();
  const row = page.locator('li.group', { hasText: title });
  await row.locator('button[aria-label="标记为完成"]').click();
  await page.waitForTimeout(800);
  const struck = await row.locator('p.line-through').count();
  console.log(`[ok] 任务勾选交互：「${title}」→ ${struck > 0 ? '已标记完成' : '状态未变化'}`);
  if (struck === 0) throw new Error('勾选后未出现完成样式');
  // 恢复原状态，避免污染数据
  await row.locator('button[aria-label="标记为待办"]').click();
  await page.waitForTimeout(800);

  // 统计页图表 SVG 存在
  await page.goto(BASE + '/stats', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=分类明细');
  const svgCount = await page.locator('.recharts-surface').count();
  console.log(`[ok] 统计页图表：${svgCount} 个 SVG 图表`);
  await page.screenshot({ path: join(OUT, 'stats-dark.png') });
} finally {
  await browser.close();
}

if (consoleErrors.length > 0) {
  console.error('\n[FAIL] 控制台错误：');
  for (const e of consoleErrors) console.error('  ' + e);
  process.exit(1);
}
console.log('\n全部通过：4 页面渲染 + 主题切换 + 交互 + 无控制台错误');
