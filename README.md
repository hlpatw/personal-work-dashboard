# 🌸 旺达工作台 · Wangda Workbench

[![License: MIT](https://img.shields.io/badge/License-MIT-rose.svg)](./LICENSE)
[![React 19](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Electron](https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white)](https://www.electronjs.org)
[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![Release](https://img.shields.io/badge/下载-v1.3.2-rose?logo=github)](../../releases)

> 🐕 一只住在桌面角落的像素柴犬：点亮它开面板，按住它拖到任意位置，平时点击穿透绝不挡你操作。
>
> 任务待办 · 日程日历 · 长期目标 · 此刻灵感 · 数据统计 —— 数据全部留在自己电脑上。
>
> **Made by [Kexuan](https://github.com/hlpatw)** 🌸

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

屏幕右下角会出现一个柴犬小宠物（始终置顶）：

- **点亮宠物**：弹出完整面板窗口，再点收起
- **拖动**：移动到桌面任意位置
- **右键**：打开面板 / 退出
- 桌面模式自带后端（自动拉起 API 并托管界面），关掉面板窗口只是收起，退出请用宠物右键菜单

### 打包成 Windows 安装包（可选）

```powershell
npm run dist       # 一键：构建前端 → 编译后端 → 生成安装包
```

产物在 `release\wangda-setup-x.y.z.exe`（版本号随 `desktop/package.json`），双击安装后：

- 开始菜单/桌面启动「旺达工作台」，无需任何命令行和 Node 环境
- 后端编译产物内置于程序中（进程内运行，零外部依赖）
- 安装版使用独立内置 API（默认端口 `3210`），不会复用开发模式的 `3001` 端口
- 数据存放于 `%APPDATA%\desktop\data\dashboard.db`，全新空白开始
- **可直接分发**：把安装包发给任何 Windows 10/11 用户即可；各用户数据完全独立；未签名应用首次运行若杀软提示，选"仍要运行"即可

其他命令：

```powershell
npm test           # 后端 API 测试（37 个用例）
npm run seed       # 写入示例数据（任务/日程/目标/灵感全覆盖）
npm run reset      # 清空全部数据，从零开始录入自己的内容
npm run build      # 前端类型检查 + 生产构建
node scripts/verify-ui.mjs   # 浏览器端自动验收（需 dev 已启动，截图在 scripts/screenshots/）
```

## 功能

| 页面 | 功能 |
|---|---|
| 概览 `/` | 今日统计卡片（待办/进行中/完成/完成率/日程数）、进行中的目标进度、此刻灵感快捷记录区、今日+逾期任务勾选、今日日程时间线 |
| 任务 `/tasks` | 整块点击即编辑；新建任务截止日期默认当天；分类/优先级/预计时长/子任务/目标关联/贴图；标签五项快选（重要/今日待办/待定/已延期/需确认）与自定义输入 |
| 日历 `/calendar` | 月历视图（周一为首日）、日程色条、点击日程即编辑、双击日期快速新建、全天/定时日程、翻月与回今天 |
| 此刻灵感 `/inspirations` | 灵感迸发的随手记录：常驻输入框回车即记、时间流卡片（类型徽章+相对时间）、全文搜索、一键转任务、贴图、卡片原地编辑 |
| 目标 `/goals` | 长期目标：整卡点击即编辑、任务关联与进度聚合、剩余天数（临期/逾期变色）、状态流转、分类彩色徽章、贴图 |
| 统计 `/stats` | 总完成率/本周完成/逾期/总数/完成目标卡片、近 12 周完成数柱状图、分类分布环形图、分类明细表 |

- **交互优化**：任务/目标/日程整块点击即编辑；分类使用彩色徽章；AI 侧栏展开时日历保持自适应
- **贴图**：任务、目标和灵感均支持选图或 `Ctrl+V` 粘贴截图，自动压缩并可点击全屏查看
- **🐕 柯基 AI 助手**：右侧可折叠聊天侧栏，配置任意 OpenAI 兼容接口（地址/模型/Key 仅存本地浏览器）；柯基人格可自定义，回复支持 Markdown 渲染，聊天历史本地保留
- **主题**：侧栏底部按钮切换深/浅色（默认专业暗色），选择持久化，刷新不闪烁
- **桌面宠物**：像素柴犬常驻右下角；平时点击穿透不挡其他窗口，悬停激活（发光提示）后可点击开面板/拖动/右键菜单
- **数据**：存储于 `server/data/dashboard.db`（SQLite，WAL 模式），重启不丢失；安装包版存于 `%APPDATA%\desktop\data\dashboard.db`

## 项目结构

```
├── package.json          # workspaces + concurrently 启动脚本
├── client/               # 前端（React + Vite + TS）
│   └── src/{api,components,pages,stores,lib}
├── server/               # 后端（Express + node:sqlite）
│   ├── src/{routes,db.ts,app.ts,index.ts,seed.ts}
│   └── tests/api.test.ts
├── desktop/              # Electron 桌面宠物与打包配置
├── docs/
│   ├── 思维导图.md        # 项目全景
│   └── 项目进展.md        # 交接文档（给下次迭代的 AI 助手）
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
