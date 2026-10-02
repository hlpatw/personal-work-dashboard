import express, { type Request, type Response, type NextFunction } from 'express';
import { ZodError } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './db.js';
import taskRoutes from './routes/tasks.js';
import scheduleRoutes from './routes/schedules.js';
import statsRoutes from './routes/stats.js';

/** 构造 Express 应用；dbPath 传 ':memory:' 用于测试 */
export function createApp(dbPath: string) {
  const db = initDb(dbPath);
  const app = express();
  app.use(express.json());

  // —— 多账号扩展接缝 ——
  // 单机版：所有请求归属内置本地用户（id=1）。
  // 未来上线多账号：在此解析登录态（如 Authorization 头中的 token 换 userId），
  // 业务路由与 SQL 均已按 req.userId 隔离，无需改动。
  const LOCAL_USER_ID = 1;
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.userId = LOCAL_USER_ID;
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api/tasks', taskRoutes(db));
  app.use('/api/schedules', scheduleRoutes(db));
  app.use('/api/stats', statsRoutes(db));

  // 桌面模式 / 生产模式：若前端已构建（client/dist），直接托管并做 SPA 回退
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        res.sendFile(join(distDir, 'index.html'));
        return;
      }
      next();
    });
  }

  // 404
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: '接口不存在' });
      return;
    }
    res.status(404).send('Not Found');
  });

  // 统一错误处理
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      res.status(400).json({ error: `${first.path.join('.')}: ${first.message}` });
      return;
    }
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  return app;
}
