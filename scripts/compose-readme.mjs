/**
 * README 组合图（方案 B）：从 scripts/screenshots/readme/ 的单页截图拼两张图。
 * - themes.png：概览 暗|浅 双主题对比（1×2，README 顶部横幅）
 * - features.png：任务/日历/此刻灵感/目标/统计/柯基侧栏（2×3 画廊）
 * 每格左下角带中文标签角标。用法：node scripts/compose-readme.mjs（无需 dev）
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'screenshots', 'readme');
const OUT = join(ROOT, '..', 'docs', 'images');
mkdirSync(OUT, { recursive: true });

const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/');

const cell = (name, label, w) => `
  <figure style="position:relative;margin:0;width:${w}px;flex:none">
    <img src="${fileUrl(join(SRC, name))}" style="width:${w}px;display:block;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35)">
    <figcaption style="position:absolute;left:10px;bottom:10px;background:rgba(15,15,20,.72);color:#fff;font:600 13px/1 system-ui,sans-serif;padding:6px 11px;border-radius:999px;backdrop-filter:blur(4px)">${label}</figcaption>
  </figure>`;

const pageHtml = (body, bg) => `<!doctype html><html><body style="margin:0;background:${bg};display:inline-block;padding:14px">${body}</body></html>`;

const THEMES = pageHtml(
  `<div style="display:flex;gap:14px">${cell('overview-dark.png', '🌙 暗色主题', 1280)}${cell('overview-light.png', '☀️ 浅色主题', 1280)}</div>`,
  '#0b0b0f',
);

const FEATURE_W = 960;
const row = (items) => `<div style="display:flex;gap:14px;margin-top:14px">${items.map((i) => cell(i[0], i[1], FEATURE_W)).join('')}</div>`;
const FEATURES = pageHtml(
  row([
    ['tasks-dark.png', '任务'],
    ['calendar-dark.png', '日历'],
    ['inspirations-dark.png', '此刻灵感'],
  ]) +
    row([
      ['goals-dark.png', '目标'],
      ['stats-dark.png', '统计'],
      ['corgi-dark.png', '柯基 AI 侧栏'],
    ]),
  '#0b0b0f',
);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const tab = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
try {
  for (const [name, html, w, h] of [
    ['themes.png', THEMES, 2602, 828],
    ['features.png', FEATURES, 2936, 1256],
  ]) {
    const tmp = join(SRC, '_compose-' + name + '.html');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(tmp, html, 'utf8');
    await tab.setViewportSize({ width: w, height: h });
    await tab.goto(fileUrl(tmp), { waitUntil: 'networkidle' });
    await tab.waitForTimeout(400);
    await tab.screenshot({ path: join(OUT, name) });
    console.log('composed', name);
  }
} finally {
  await browser.close();
}
console.log('输出目录:', OUT);
