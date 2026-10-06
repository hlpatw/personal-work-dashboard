/** 直接渲染透明底柴犬 PNG（1024 → 256），从 pet.html 的 SVG 提取狗本体 */
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

// 狗本体 SVG（无任何背景），viewBox 0 0 30 23（含尾巴）
const dog = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 23" width="1024" height="785" shape-rendering="crispEdges">
  <rect x="3" y="1" width="3" height="5" fill="#b57a45"/>
  <rect x="2" y="2" width="1" height="5" fill="#a86a38"/>
  <rect x="24" y="1" width="3" height="5" fill="#b57a45"/>
  <rect x="26" y="2" width="1" height="5" fill="#a86a38"/>
  <rect x="6" y="2" width="3" height="2" fill="#f0c987"/>
  <rect x="4" y="3" width="2" height="2" fill="#f0c987"/>
  <rect x="4" y="4" width="1" height="2" fill="#f2a9c2"/>
  <rect x="21" y="2" width="3" height="2" fill="#f0c987"/>
  <rect x="24" y="3" width="2" height="2" fill="#f0c987"/>
  <rect x="25" y="4" width="1" height="2" fill="#f2a9c2"/>
  <rect x="6" y="3" width="18" height="9" fill="#f0c987"/>
  <rect x="5" y="4" width="1" height="7" fill="#f0c987"/>
  <rect x="24" y="4" width="1" height="7" fill="#f0c987"/>
  <rect x="9" y="4" width="1" height="1" fill="#c99a55"/>
  <rect x="20" y="4" width="1" height="1" fill="#c99a55"/>
  <rect x="9" y="6" width="3" height="3" fill="#3a2c22"/>
  <rect x="18" y="6" width="3" height="3" fill="#3a2c22"/>
  <rect x="9" y="6" width="1" height="1" fill="#fff"/>
  <rect x="18" y="6" width="1" height="1" fill="#fff"/>
  <rect x="13" y="8" width="4" height="4" fill="#fbe9c4"/>
  <rect x="14" y="8" width="2" height="1" fill="#3a2c22"/>
  <rect x="13" y="10" width="1" height="1" fill="#3a2c22"/>
  <rect x="16" y="10" width="1" height="1" fill="#3a2c22"/>
  <rect x="14" y="11" width="2" height="1" fill="#ef9aa5"/>
  <rect x="7" y="9" width="1" height="1" fill="#f2b8a0"/>
  <rect x="22" y="9" width="1" height="1" fill="#f2b8a0"/>
  <rect x="7" y="12" width="16" height="9" fill="#f0c987"/>
  <rect x="11" y="13" width="4" height="6" fill="#fbe9c4"/>
  <rect x="9" y="20" width="3" height="1" fill="#e8bd72"/>
  <rect x="14" y="20" width="3" height="1" fill="#e8bd72"/>
  <rect x="19" y="20" width="3" height="1" fill="#e8bd72"/>
  <rect x="9" y="19" width="2" height="1" fill="#fbe9c4"/>
  <rect x="19" y="19" width="2" height="1" fill="#fbe9c4"/>
  <rect x="23" y="13" width="2" height="2" fill="#f0c987"/>
  <rect x="25" y="12" width="2" height="2" fill="#c99a55"/>
</svg>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 785 } });
await page.setContent(`<body style="margin:0;background:transparent">${dog}</body>`);
// omitBackground: true → 截图不含白底，保持 SVG 透明
await page.screenshot({
  path: join(DIR, '..', 'build', 'icon-1024.png'),
  clip: { x: 0, y: 0, width: 1024, height: 785 },
  omitBackground: true,
});
await browser.close();
console.log('1024 透明底已生成（1024x785，狗的比例）');
