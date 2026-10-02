# 个人工作面板

个人使用的日常工作面板：**任务待办管理 + 日程日历 + 数据统计**，深浅色主题可切换（默认深色），全中文界面。

## 技术栈

- **前端**：React 19 + Vite + TypeScript + Tailwind CSS v4 + TanStack Query + zustand + recharts + date-fns
- **后端**：Node.js（Express 5）+ SQLite（Node 内置 `node:sqlite`，零原生依赖）
- **测试**：后端 vitest + supertest；浏览器端 Playwright 验收脚本

> 环境要求：**Node >= 24.10**（`node:sqlite` 在该版本起免 flag 稳定可用）

## 快速开始

克隆或下载本仓库后，在项目目录执行：

```powershell
git clone https://github.com/<你的用户名>/personal-work-dashboard.git
cd personal-work-dashboard
npm install        # 安装全部依赖（前后端 workspaces）
npm run dev        # 一条命令同时启动：API(3001) + Web(5173)
```

浏览器打开 <http://localhost:5173> 即可使用。

> 每个人运行的是自己电脑上的独立实例，数据存在自己的 `server/data/dashboard.db` 里，天然互不干扰。

### 桌面小宠物模式（可选）

```powershell
npm run build      # 先构建前端（桌面模式加载的是构建产物）
npm run desktop    # 启动桌面小宠物（首次需已 npm install，会下载 Electron）
```

屏幕右下角会出现一只粉色小团子（始终置顶）：

- **点它的脸**：弹出完整面板窗口，再点收起
- **拖动身体边缘**：移动位置
- **右键**：打开面板 / 退出
- 桌面模式自带后端（自动拉起 API 并托管界面），关掉面板窗口只是收起，退出请用宠物右键菜单

其他命令：

```powershell
npm test           # 后端 API 测试（18 个用例）
npm run seed       # 写入示例数据（约 29 条任务 + 7 条日程，覆盖近两周）
npm run reset      # 清空全部任务与日程，从零开始录入自己的内容
npm run build      # 前端类型检查 + 生产构建
node scripts/verify-ui.mjs   # 浏览器端自动验收（需 dev 已启动，截图在 scripts/screenshots/）
```

## 功能

| 页面 | 功能 |
|---|---|
| 概览 `/` | 今日统计卡片（待办/进行中/完成/完成率/日程数）、逾期提示、今日+逾期任务勾选、今日日程时间线、今日已完成列表 |
| 任务 `/tasks` | 新建/编辑/删除任务，状态流转（待办/进行中/已完成），分类（工作/学习/生活/其他）、优先级（紧急/高/中/低）、截止日期、关键词/状态/分类筛选，逾期红色标识 |
| 日历 `/calendar` | 月历视图（周一为首日）、日程色条、选中日详情面板、全天/定时日程、翻月与回今天 |
| 统计 `/stats` | 总完成率/本周完成/逾期/总数卡片、近 12 周完成数柱状图、分类分布环形图、分类明细表 |

- **主题**：侧栏底部按钮切换深/浅色，选择持久化，刷新不闪烁
- **数据**：存储于 `server/data/dashboard.db`（SQLite，WAL 模式），重启不丢失

## 项目结构

```
├── package.json          # workspaces + concurrently 启动脚本
├── client/               # 前端（React + Vite + TS）
│   └── src/{api,components,pages,stores,lib}
├── server/               # 后端（Express + node:sqlite）
│   ├── src/{routes,db.ts,app.ts,index.ts,seed.ts}
│   └── tests/api.test.ts
└── scripts/verify-ui.mjs # 浏览器端验收脚本
```

## API 概览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | `/api/tasks` | 任务列表（筛选 status/category/priority/q/overdue）/ 新建 |
| GET/PUT/DELETE | `/api/tasks/:id` | 详情 / 更新 / 删除 |
| PATCH | `/api/tasks/:id/status` | 状态流转（自动维护 completed_at） |
| GET | `/api/schedules?from=&to=` | 日程区间查询（含两端） |
| GET | `/api/schedules/today` | 今日日程 |
| POST/PUT/DELETE | `/api/schedules[/:id]` | 日程 CRUD |
| GET | `/api/stats/summary` | 今日概览 + 逾期数 |
| GET | `/api/stats/completions/daily?days=90` | 每日完成数 |
| GET | `/api/stats/categories` | 分类统计 |

## 多人使用与未来扩展

**当前定位：单机个人工具。** 每位使用者自行部署一份，数据完全隔离，无需账号。

代码已为将来"多账号 / 部署上线"预留了架构空间：

- 数据库已有 `users` 表，`tasks` / `schedules` 均带 `user_id` 外键（单机版默认归属内置本地用户 `id=1`）
- 后端所有查询都经过 `app.ts` 中的**用户中间件**注入 `req.userId`，业务 SQL 全部按用户隔离
- 未来上线多账号只需三步，不涉及业务表结构变更：
  1. 新增注册/登录接口，写入 `users` 表并签发 token
  2. 把用户中间件里的 `LOCAL_USER_ID` 替换为"从 `Authorization` 头解析 token → userId"
  3. 前端加登录页，请求统一携带 token

## 开源协议

[MIT](./LICENSE) —— 可自由使用、修改和分发。

## 注意事项

- 请勿在服务运行时用其他工具（如 DB Browser）打开 `dashboard.db`，可能锁库；调试前先停服务
- 若 3001/5173 端口被残留进程占用：`Get-NetTCPConnection -LocalPort 3001 | Select OwningProcess` 找到 PID 后 `Stop-Process -Id <pid>`
- 终端中文乱码时执行 `chcp 65001`
