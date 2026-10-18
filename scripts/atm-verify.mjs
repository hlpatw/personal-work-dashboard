/**
 * 氛围层落地验收（2026-10-18 定稿版）：双主题六页 + 弹窗 + 柯基 + 单一色相审计。
 * 用法：node scripts/atm-verify.mjs（需先 npm run dev；用现有数据，不 seed 不 reset）
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:5173';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots', 'atm');
mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

const shot = async (path, name, waitText) => {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  if (waitText) await page.waitForSelector(`text=${waitText}`, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('[ok]', name);
};

/** 单一色相审计：收集所有元素的实际渲染色，统计粉色相种类（定稿应只有 351） */
const auditPink = async (label) => {
  const report = await page.evaluate(() => {
    const toHue = (c) => {
      const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
      if (!m) return null;
      const [r, g, b] = [m[1], m[2], m[3]].map(Number).map((v) => v / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max === min || max < 0.14) return null; // 灰/近黑不算
      const d = max - min;
      let h;
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      return Math.round(h * 60);
    };
    const isPinkish = (h) => h !== null && (h >= 320 || h <= 20);
    const hues = new Map(); // hue -> count
    const samples = new Map(); // hue -> 示例
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      for (const c of [cs.color, cs.backgroundColor, cs.borderTopColor]) {
        if (!c || c === 'rgba(0, 0, 0, 0)') continue;
        const h = toHue(c);
        if (isPinkish(h)) {
          hues.set(h, (hues.get(h) ?? 0) + 1);
          if (!samples.has(h)) samples.set(h, `${el.tagName}.${String(el.className).slice(0, 40)} → ${c}`);
        }
      }
    }
    return {
      bodyBg: getComputedStyle(document.body).backgroundColor,
      atmos: Boolean(document.querySelector('.atmos .atm-grain')),
      hues: [...hues.entries()].sort((a, b) => b[1] - a[1]),
      samples: [...samples.entries()],
    };
  });
  console.log(`\n[色相审计 · ${label}] body=${report.bodyBg} atmos=${report.atmos}`);
  for (const [h, n] of report.hues) console.log(`  hue ${h}° × ${n}`);
  for (const [h, s] of report.samples) if (Math.abs(h - 351) > 6 && !(h <= 20)) console.log(`  ⚠ hue ${h}° 样例: ${s}`);
  return report;
};

try {
  // 暗色（默认）六页
  await shot('/', 'a-概览-暗', '今日任务');
  await shot('/tasks', 'b-任务-暗', '新建任务');
  await shot('/calendar', 'c-日历-暗', '今天');
  await shot('/inspirations', 'd-灵感-暗');
  await shot('/goals', 'e-目标-暗');
  await shot('/stats', 'f-统计-暗', '每周完成任务数');
  await auditPink('暗色·概览');

  // 弹窗（createPortal 到 body）——验证 backdrop-filter 后定位仍正确
  await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=新建任务');
  await page.click('text=新建任务');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'g-弹窗-暗.png') });
  console.log('[ok] g-弹窗-暗');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 柯基侧栏
  await page.click('button[title="展开柯基助手"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'h-柯基-暗.png') });
  console.log('[ok] h-柯基-暗');

  // 浅色六页（用户定稿主题）
  await page.click('button[title="收起"]');
  await page.click('button[title="切换主题"]');
  await page.waitForTimeout(400);
  await shot('/', 'i-概览-浅', '今日任务');
  await shot('/tasks', 'j-任务-浅', '新建任务');
  await shot('/calendar', 'k-日历-浅', '今天');
  await shot('/inspirations', 'l-灵感-浅');
  await shot('/goals', 'm-目标-浅');
  await shot('/stats', 'n-统计-浅', '每周完成任务数');
  await auditPink('浅色·概览');

  // 浅色弹窗 + 柯基
  await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
  await page.waitForSelector('text=新建任务');
  await page.click('text=新建任务');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'o-弹窗-浅.png') });
  console.log('[ok] o-弹窗-浅');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.click('button[title="展开柯基助手"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, 'p-柯基-浅.png') });
  console.log('[ok] p-柯基-浅');
} finally {
  await browser.close();
}

console.log(errors.length ? `\n[控制台错误 ${errors.length} 条]\n` + errors.slice(0, 10).join('\n') : '\n[无控制台错误]');
console.log('截图目录:', OUT);
