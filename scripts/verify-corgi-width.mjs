/** 阶段 1 验收：柯基侧栏拖拽调宽（真实 dev 界面，非原型） */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:5173';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'corgi-width');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const ok = (name, cond) => {
  console.log(`${cond ? '[ok]' : '[FAIL]'} ${name}`);
  if (!cond) process.exitCode = 1;
};
const asideWidth = () =>
  page.evaluate(() => document.querySelector('[data-testid="corgi-sidebar"]')?.getBoundingClientRect().width ?? 0);

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
// 清掉旧 localStorage（避免旧数据里的宽度干扰），保留干净起点
await page.evaluate(() => localStorage.removeItem('dashboard-corgi-chat'));
await page.reload({ waitUntil: 'networkidle' });
await page.click('button[title="展开柯基助手"]');
await page.waitForTimeout(400);

// 1. 默认宽 320
ok('默认宽度 320', Math.abs((await asideWidth()) - 320) < 2);
await page.screenshot({ path: join(OUT, 'a-默认320.png') });

// 2. 拖到 480：把手覆盖侧栏左缘 [-4px, +2px)，取中点 asideX-1
const asideX = (await page.evaluate(() => document.querySelector('[data-testid="corgi-sidebar"]')?.getBoundingClientRect().x)) ?? 0;
await page.mouse.move(asideX - 1, 400);
await page.mouse.down();
await page.mouse.move(1280 - 480, 400, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(300);
ok('拖拽后宽度 480', Math.abs((await asideWidth()) - 480) < 2);
await page.screenshot({ path: join(OUT, 'b-拖宽480.png') });

// 3. 拖过头 clamp 到 640（1280 屏 innerWidth-560=720 → 上限 640）
await page.mouse.move(1280 - 480 - 1, 400);
await page.mouse.down();
await page.mouse.move(200, 400, { steps: 10 }); // 想拖到 1080 宽
await page.mouse.up();
await page.waitForTimeout(300);
ok('上限 clamp 640', Math.abs((await asideWidth()) - 640) < 2);

// 4. 持久化：localStorage 记住 640，刷新后保持
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-corgi-chat') ?? '{}'));
ok('localStorage 记住宽度', stored.state?.width === 640);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
ok('刷新后宽度保持 640', Math.abs((await asideWidth()) - 640) < 2);
await page.screenshot({ path: join(OUT, 'c-刷新后保持640.png') });

// 5. 双击把手回默认 320
await page.mouse.dblclick(1280 - 640 - 1, 400);
await page.waitForTimeout(400);
ok('双击回默认 320', Math.abs((await asideWidth()) - 320) < 2);

await browser.close();
console.log(errors.length ? `\n[控制台错误 ${errors.length} 条]\n` + errors.slice(0, 5).join('\n') : '\n[无控制台错误]');
console.log('截图目录:', OUT);
