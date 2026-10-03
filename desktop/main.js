/**
 * 桌面小宠物 + 弹窗面板（Electron 主进程）
 * - 启动时拉起后端 API（tsx 运行 server/src/index.ts，端口 3001）
 * - 桌面右下角常驻一只置顶小宠物（pet.html）
 * - 点宠物 → 弹出/收起面板窗口（加载 http://localhost:3001）
 * - 右键宠物 → 菜单（打开面板 / 退出）
 */
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// 透明悬浮球需要 GPU 合成，保持硬件加速开启（若个别驱动崩溃可改回 disableHardwareAcceleration）

const PORT = Number(process.env.PORT || 3001);
const BASE_URL = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..');
const SHOT_DIR = process.env.ELECTRON_SHOT_DIR; // 设置时截图自检并退出

let serverProc = null;
let petWin = null;
let dashWin = null;
let quitting = false;

/** 探测 API 是否已就绪（agent:false 避免连接池复用启动中端口的诡异挂起） */
function probe(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const req = http.get(`${BASE_URL}/api/health`, { agent: false }, (res) => {
      clearTimeout(timer);
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function ensureServer() {
  // 已有实例在跑（如 npm run dev），直接复用
  if (await probe(800)) {
    console.log('[desktop] 检测到已在运行的后端，直接复用');
    return;
  }

  // 打包模式：后端编译产物在主进程内直接运行（无子进程、无系统 Node 依赖）
  if (app.isPackaged) {
    const bundle = path.join(process.resourcesPath, 'server-bundle', 'app.cjs');
    if (!existsSync(bundle)) throw new Error('缺少内置后端文件，请重新安装');
    const dbPath = path.join(app.getPath('userData'), 'data', 'dashboard.db');
    require('node:fs').mkdirSync(path.dirname(dbPath), { recursive: true });
    const { createApp } = require(bundle);
    const expressApp = createApp(dbPath, {
      staticDir: path.join(process.resourcesPath, 'client-dist'),
    });
    await new Promise((resolve, reject) => {
      const srv = expressApp.listen(PORT, resolve);
      srv.on('error', reject);
    });
    console.log('[desktop] 内置后端已启动（进程内）');
    return;
  }

  const tsxCli = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (!existsSync(tsxCli)) throw new Error('未找到 tsx，请先在项目根目录执行 npm install');
  // 注意：用「cwd + 纯 ASCII 相对路径」拉起（实测从 Electron 主进程 spawn
  // 带中文的绝对路径参数会静默失败；相对路径 + cwd 方案已验证可靠）
  console.log('[desktop] 拉起后端：node node_modules/tsx/dist/cli.mjs server/src/index.ts');
  serverProc = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'server/src/index.ts'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // 就绪信号：优先监听子进程的启动日志（事件驱动、零轮询），HTTP 探测仅作兜底
  let sawStartup = false;
  const started = new Promise((resolve) => {
    serverProc.stdout.on('data', (d) => {
      process.stdout.write(`[api] ${d}`);
      if (!sawStartup && String(d).includes('已启动')) {
        sawStartup = true;
        resolve();
      }
    });
  });
  serverProc.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));
  serverProc.on('error', (err) => console.error(`[desktop] 后端进程启动失败: ${err.message}`));
  serverProc.on('exit', (code) => {
    if (!quitting) console.error(`[desktop] 后端进程意外退出（code ${code}）`);
  });

  // 等待就绪：以子进程的启动日志信号为准（事件驱动）。
  // 重要：启动窗口期内不能对端口做任何探测——实测此环境下启动中被探测
  // 会导致子进程挂死；兜底探测延迟 12 秒后仅在未收到日志时执行一次。
  const winner = await Promise.race([
    started.then(() => 'log'),
    new Promise((resolve) => setTimeout(resolve, 12000)).then(() => probe(3000)).then((ok) => (ok ? 'probe' : null)),
  ]);
  if (winner) {
    console.log(`[desktop] 后端已就绪（${winner === 'log' ? '启动日志' : '健康探测'}）`);
    return;
  }
  throw new Error('后端启动超时');
}

function createPetWindow() {
  const { workArea } = require('electron').screen.getPrimaryDisplay();
  petWin = new BrowserWindow({
    width: 62,
    height: 64,
    x: workArea.x + workArea.width - 78,
    y: workArea.y + workArea.height - 78,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    // 拖动残影抑制：禁用透明窗口的合成器节流，移动时强制即时重绘
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  // Windows 下透明窗口快速 setPosition 会出现残影/拖尾，
  // 让窗口在 DWM 层直通合成可显著缓解
  if (process.platform === 'win32') {
    petWin.setOpacity(0.99999);
  }
  petWin.setAlwaysOnTop(true, 'screen-saver');
  // 诊断：窗口意外关闭/加载失败时给出原因
  petWin.webContents.on('did-fail-load', (_e, code, desc) =>
    console.error(`[desktop] 宠物页面加载失败: ${code} ${desc}`)
  );
  petWin.webContents.on('render-process-gone', (_e, details) =>
    console.error(`[desktop] 宠物渲染进程崩溃: ${details.reason}`)
  );
  petWin.on('closed', () => {
    if (!quitting) console.error('[desktop] 宠物窗口被意外关闭');
  });
  petWin.loadFile(path.join(__dirname, 'pet.html'));
}

function createDashboardWindow() {
  dashWin = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: '个人工作面板',
    show: false,
    backgroundColor: '#1c1917',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  dashWin.loadURL(BASE_URL);
  dashWin.once('ready-to-show', () => dashWin.show());
  // 关闭 = 收起（面板仍在，宠物常驻）
  dashWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      dashWin.hide();
    }
  });
}

function toggleDashboard() {
  if (!dashWin) {
    createDashboardWindow();
    return;
  }
  // 点狗切换：可见 → 隐藏；不可见 → 显示。不依赖焦点状态（否则焦点在
  // 别的窗口时再点狗会变成"抢焦点"而不是关闭，不符合直觉）
  if (dashWin.isVisible()) {
    dashWin.hide();
  } else {
    dashWin.show();
    dashWin.focus();
  }
}

function petMenu() {
  Menu.buildFromTemplate([
    { label: '打开面板', click: () => toggleDashboard() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]).popup({ window: petWin });
}

/** 截图自检：ELECTRON_SHOT_DIR=xxx npm run desktop */
async function selfCheck() {
  const fs = require('node:fs');
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const petImg = await petWin.webContents.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'desktop-pet.png'), petImg.toPNG());
    console.log('[desktop] 宠物截图完成');
    toggleDashboard();
    await new Promise((r) => setTimeout(r, 5000));
    if (dashWin && !dashWin.isDestroyed()) {
      const dashImg = await dashWin.webContents.capturePage();
      fs.writeFileSync(path.join(SHOT_DIR, 'desktop-dashboard.png'), dashImg.toPNG());
      console.log('[desktop] 面板截图完成');
    } else {
      console.error('[desktop] 面板窗口未存活，跳过面板截图');
    }
  } catch (err) {
    console.error(`[desktop] 自检失败: ${err.message}`);
  } finally {
    console.log('[desktop] 自检截图结束');
    quitting = true;
    if (serverProc) serverProc.kill();
    app.exit(0);
  }
}

/** 悬停激活：默认点击穿透（不挡下层窗口的按钮），鼠标悬停到小狗上才激活可交互。
 *  穿透模式下用 forward:true 让鼠标事件仍转发到本窗口，渲染进程靠它检测 mouseenter。
 */
let petActive = true; // 启动时先激活（等首次 mouseleave 再转穿透）
ipcMain.on('pet-hover', (_e, hover) => {
  if (!petWin || petWin.isDestroyed()) return;
  petActive = !!hover;
  if (petActive) {
    petWin.setIgnoreMouseEvents(false);
  } else {
    petWin.setIgnoreMouseEvents(true, { forward: true });
  }
});

/** 宠物拖动：渲染进程发指针增量（dx,dy），主进程按窗口初始位置移动（不依赖屏幕光标）。
 *  合帧节流：用 rAF 周期合并高频 IPC，避免每次 pointermove 都触发一次
 *  窗口移动+重绘（快速拖动时重绘跟不上会造成残影/拖尾）。
 */
let dragBase = null; // { win: {x,y} }
let pendingDelta = null; // 待应用的最新增量
let moveScheduled = false;
ipcMain.on('pet-drag-start', () => {
  if (!petWin || petWin.isDestroyed()) return;
  const [x, y] = petWin.getPosition();
  dragBase = { win: { x, y } };
  pendingDelta = null;
  // 拖动期间必须可交互
  petActive = true;
  petWin.setIgnoreMouseEvents(false);
});
ipcMain.on('pet-drag-move', (_e, dx, dy) => {
  if (!petWin || petWin.isDestroyed() || !dragBase) return;
  pendingDelta = { dx, dy };
  if (moveScheduled) return;
  moveScheduled = true;
  setImmediate(() => {
    moveScheduled = false;
    if (!pendingDelta || !petWin || petWin.isDestroyed() || !dragBase) return;
    const { dx: fdx, dy: fdy } = pendingDelta;
    pendingDelta = null;
    petWin.setPosition(dragBase.win.x + fdx, dragBase.win.y + fdy);
  });
});

app.whenReady().then(async () => {
  ipcMain.on('toggle-dashboard', toggleDashboard);
  ipcMain.on('pet-menu', petMenu);

  try {
    await ensureServer();
  } catch (err) {
    console.error(`[desktop] ${err.message}`);
    app.quit();
    return;
  }

  createPetWindow();
  if (SHOT_DIR) {
    await selfCheck();
  }
});

app.on('before-quit', () => {
  quitting = true;
  if (serverProc) serverProc.kill();
});

app.on('window-all-closed', () => {
  // 宠物窗口关闭时整体退出
  app.quit();
});
