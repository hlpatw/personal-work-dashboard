import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });

// 模拟真实旧数据：zustand v5 旧代码落盘必带 version:0
await page.evaluate(() => {
  localStorage.setItem('dashboard-profile', JSON.stringify({ state: { nickname: '我', motto: '专注当下，日拱一卒' }, version: 0 }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const sidebarMotto = (await page.textContent('button[title="编辑昵称与座右铭"] >> nth=0').catch(() => null))?.trim();
const stored = await page.evaluate(() => localStorage.getItem('dashboard-profile'));
console.log('侧栏显示:', sidebarMotto);
console.log('迁移后存储:', stored);

// 反向用例：用户自定义座右铭必须保留
await page.evaluate(() => {
  localStorage.setItem('dashboard-profile', JSON.stringify({ state: { nickname: '我', motto: '我的自定义格言' }, version: 0 }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
console.log('自定义值保留:', await page.evaluate(() => JSON.parse(localStorage.getItem('dashboard-profile')).state.motto));
await browser.close();
