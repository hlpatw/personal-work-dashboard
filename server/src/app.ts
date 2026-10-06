import express, { type Request, type Response, type NextFunction } from 'express';
import { ZodError, z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './db.js';
import taskRoutes from './routes/tasks.js';
import scheduleRoutes from './routes/schedules.js';
import statsRoutes from './routes/stats.js';
import goalRoutes from './routes/goals.js';
import inspirationRoutes from './routes/inspirations.js';

/** 构造 Express 应用；dbPath 传 ':memory:' 用于测试 */
export function createApp(dbPath: string, opts?: { staticDir?: string }) {
  const db = initDb(dbPath);
  const app = express();
  // 默认 100KB 不够装 Base64 贴图（压缩后约 300~400KB），放宽到 3MB
  app.use(express.json({ limit: '3mb' }));

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

  // —— 柯基 AI 助手：OpenAI 兼容接口转发（绕开浏览器 CORS；Key 由前端随请求传入，
  //    不落库不记录，后端零感知用户凭据）
  const aiChatSchema = z.object({
    baseUrl: z
      .string()
      .trim()
      .regex(/^https?:\/\//, '接口地址应以 http:// 或 https:// 开头'),
    apiKey: z.string().trim().min(1, 'API Key 不能为空').max(500),
    model: z.string().trim().min(1, '模型名不能为空').max(200),
    messages: z
      .array(
        z.object({
          role: z.enum(['system', 'user', 'assistant']),
          content: z.string().max(8000, '单条消息过长'),
        })
      )
      .min(1, '消息不能为空')
      .max(40, '对话历史过长，请开启新对话'),
  });

  app.post('/api/ai/chat', async (req: Request, res: Response) => {
    const input = aiChatSchema.parse(req.body);
    const url = input.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({ model: input.model, messages: input.messages }),
        signal: controller.signal,
      });
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        const brief =
          upstream.status === 401
            ? 'API Key 无效或未授权'
            : upstream.status === 429
              ? '调用频率超限或余额不足'
              : `上游接口返回 ${upstream.status}`;
        res.status(502).json({ error: `${brief}${detail ? `：${detail.slice(0, 200)}` : ''}` });
        return;
      }
      const data = (await upstream.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        res.status(502).json({ error: '上游返回格式异常（缺少回复内容）' });
        return;
      }
      res.json({ content });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        res.status(504).json({ error: '请求超时（30 秒），请检查接口地址或稍后重试' });
      } else {
        res.status(502).json({ error: `无法连接接口：${(err as Error).message}` });
      }
    } finally {
      clearTimeout(timer);
    }
  });

  app.use('/api/tasks', taskRoutes(db));
  app.use('/api/schedules', scheduleRoutes(db));
  app.use('/api/stats', statsRoutes(db));
  app.use('/api/goals', goalRoutes(db));
  app.use('/api/inspirations', inspirationRoutes(db));

  // 桌面模式 / 生产模式：托管前端构建产物并做 SPA 回退
  // 默认开发仓库的 client/dist；打包模式由调用方传入 staticDir
  const distDir =
    opts?.staticDir ??
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
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
