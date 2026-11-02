/**
 * README 素材截图：六个页面 × 暗/浅双主题 + 柯基侧栏展开态，并拼一张总览图。
 * 截图内容会公开，输出后需逐张人工审阅（scripts/screenshots/readme/）。
 * 用法：node scripts/capture-readme.mjs（需 dev 已启动）
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:5173';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'readme');
mkdirSync(OUT, { recursive: true });

const PAGES = [
  { name: 'overview', path: '/', label: '概览' },
  { name: 'tasks', path: '/tasks', label: '任务' },
  { name: 'calendar', path: '/calendar', label: '日历' },
  { name: 'inspirations', path: '/inspirations', label: '此刻灵感' },
  { name: 'goals', path: '/goals', label: '目标' },
  { name: 'stats', path: '/stats', label: '统计' },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });

const shots = [];
try {
  for (const theme of ['dark', 'light']) {
    // 先落地主题与侧栏状态（柯基收起，避免遮挡页面主体）
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.evaluate(
      (t) => {
        localStorage.setItem('dashboard-theme', JSON.stringify({ state: { theme: t }, version: 0 }));
        localStorage.setItem('dashboard-corgi-chat', JSON.stringify({ state: { sessions: [], activeSessionId: '', open: false, width: 380 }, version: 1 }));
      },
      theme,
    );
    for (const p of PAGES) {
      await page.goto(BASE + p.path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(700); // 等路由 page-fade 动画与图表渲染
      const file = `${p.name}-${theme}.png`;
      await page.screenshot({ path: join(OUT, file) });
      shots.push({ file, label: `${p.label}（${theme === 'dark' ? '暗色' : '浅色'}）` });
      console.log('shot', file);
    }
  }

  // 柯基侧栏展开态（暗色，任务页）
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('dashboard-theme', JSON.stringify({ state: { theme: 'dark' }, version: 0 }));
    localStorage.setItem('dashboard-corgi-chat', JSON.stringify({ state: { sessions: [], activeSessionId: '', open: true, width: 380 }, version: 1 }));
  });
  await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, 'corgi-dark.png') });
  shots.push({ file: 'corgi-dark.png', label: '柯基 AI 侧栏（暗色）' });
  console.log('shot corgi-dark.png');

  // 拼总览图（file:// 网格页 → 截图），供逐张审阅
  const sheet = `<!doctype html><html><body style="margin:0;background:#111;font-family:system-ui,sans-serif">
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:8px">
${shots
  .map(
    (s) =>
      `<figure style="margin:0"><img src="file:///${(OUT + '\\' + s.file).replace(/\\/g, '/')}" style="width:100%;display:block;border-radius:6px"><figcaption style="color:#ddd;font-size:12px;padding:4px 2px">${s.label}</figcaption></figure>`,
  )
  .join('')}
</div></body></html>`;
  const sheetPath = join(OUT, '_contact-sheet.html');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(sheetPath, sheet, 'utf8');
  await page.setViewportSize({ width: 1320, height: 1830 });
  await page.goto('file:///' + sheetPath.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, '_contact-sheet.png') });
  console.log('shot _contact-sheet.png');
} finally {
  await browser.close();
}
console.log('输出目录:', OUT);
