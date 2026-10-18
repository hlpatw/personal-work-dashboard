import { type Request, type Response, Router } from 'express';
import { z } from 'zod';

/**
 * 柯基 AI 助手路由：OpenAI 兼容接口转发（绕开浏览器 CORS）。
 * Key 由前端随请求传入，不落库不记录，后端零感知用户凭据。
 *
 * 流式协议：body 传 stream:true 时，响应为自家简化 SSE 事件流
 * （服务端解析上游 OpenAI chunk 后重组，不原样字节透传）：
 *   data: {"type":"delta","content":"…"}   逐段
 *   data: {"type":"done","content":"全文"}  正常结束
 *   data: {"type":"error","error":"…"}      流中途失败（随后 res.end()）
 * 流开始前（连接失败 / 上游非 200 / 首字节超时 / zod 400）仍回 JSON 错误，
 * 与非流式语义一致。
 */

export interface AiTimeouts {
  /** 首字节（上游响应头到达）超时，超时前错误可回 JSON */
  firstByteMs: number;
  /** 流式空闲超时：每收到一个 chunk 重置 */
  idleMs: number;
  /** 流式总时长上限，防无限流 */
  totalMs: number;
}

const DEFAULT_TIMEOUTS: AiTimeouts = { firstByteMs: 30_000, idleMs: 30_000, totalMs: 300_000 };

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
  stream: z.boolean().optional(),
});

/** 上游非 200 的友好文案（与旧版一致） */
function upstreamBrief(status: number): string {
  return status === 401
    ? 'API Key 无效或未授权'
    : status === 429
      ? '调用频率超限或余额不足'
      : `上游接口返回 ${status}`;
}

/**
 * 逐行消费上游 SSE，解析 OpenAI chunk 的 delta.content。
 * 行缓冲 + TextDecoder({stream:true}) 防中文跨 chunk 截断；
 * 跳过 keepalive 注释行 / [DONE] / role-only 块 / usage 块 / 坏行。
 */
async function pumpSse(upstream: Response, onDelta: (s: string) => void): Promise<string> {
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let full = '';
  /** 返回 {done: 是否收到 [DONE], rest: 未消费的半行缓冲} */
  const consumeLines = (text: string, isFinal: boolean): { done: boolean; rest: string } => {
    const lines = text.split('\n');
    const rest = isFinal ? '' : (lines.pop() ?? ''); // 非最终批次：最后一段可能不完整，留缓冲
    for (const line of lines) {
      const s = line.trim();
      if (!s || s.startsWith(':') || !s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') return { done: true, rest: '' };
      try {
        const j = JSON.parse(payload) as { choices?: { delta?: { content?: unknown } }[] };
        const c = j.choices?.[0]?.delta?.content;
        if (typeof c === 'string' && c) {
          full += c;
          onDelta(c);
        }
      } catch {
        // 忽略无法解析的行
      }
    }
    return { done: false, rest };
  };

  for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
    const r = consumeLines(buf + decoder.decode(chunk, { stream: true }), false);
    if (r.done) return full;
    buf = r.rest;
  }
  // 上游关流未发 [DONE]：按正常结束处理，冲洗解码器后吃完剩余行
  consumeLines(buf + decoder.decode(), true);
  return full;
}

export default function aiRoutes(timeoutOverrides?: Partial<AiTimeouts>): Router {
  const timeouts: AiTimeouts = { ...DEFAULT_TIMEOUTS, ...timeoutOverrides };
  const router = Router();

  router.post('/chat', async (req: Request, res: Response) => {
    const input = aiChatSchema.parse(req.body);
    const url = input.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const upstreamBody: Record<string, unknown> = { model: input.model, messages: input.messages };
    if (input.stream) upstreamBody.stream = true;

    const controller = new AbortController();
    // 客户端断开 → 掐断上游（两个阶段都生效；必须先于 writeHead 注册）
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    if (!input.stream) {
      // —— 非流式：原逻辑平移（总超时），设置弹窗的“测试连接”继续走这里 ——
      const timer = setTimeout(() => controller.abort(), timeouts.firstByteMs);
      try {
        const upstream = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
          body: JSON.stringify(upstreamBody),
          signal: controller.signal,
        });
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => '');
          res
            .status(502)
            .json({ error: `${upstreamBrief(upstream.status)}${detail ? `：${detail.slice(0, 200)}` : ''}` });
          return;
        }
        const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          res.status(502).json({ error: '上游返回格式异常（缺少回复内容）' });
          return;
        }
        res.json({ content });
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          res.status(504).json({ error: `请求超时（${Math.round(timeouts.firstByteMs / 1000)} 秒），请检查接口地址或稍后重试` });
        } else {
          res.status(502).json({ error: `无法连接接口：${(err as Error).message}` });
        }
      } finally {
        clearTimeout(timer);
      }
      return;
    }

    // —— 流式：首字节 / 空闲 / 总时长三层超时 ——
    let sseStarted = false;
    let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const totalTimer = setTimeout(() => controller.abort(), timeouts.totalMs);
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), timeouts.idleMs);
    };
    const sse = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
      firstByteTimer = setTimeout(() => controller.abort(), timeouts.firstByteMs);
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
        body: JSON.stringify(upstreamBody),
        signal: controller.signal,
      });
      clearTimeout(firstByteTimer);
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        res
          .status(502)
          .json({ error: `${upstreamBrief(upstream.status)}${detail ? `：${detail.slice(0, 200)}` : ''}` });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      sseStarted = true; // 此后的任何异常只能写 error 事件，不能再 res.status
      armIdle();

      const isSse = (upstream.headers.get('content-type') ?? '').includes('text/event-stream');
      if (!upstream.body || !isSse) {
        // 降级：上游忽略 stream:true 直接回了 JSON —— 归一成同一事件流
        const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          sse({ type: 'error', error: '上游返回格式异常（缺少回复内容）' });
          res.end();
          return;
        }
        sse({ type: 'delta', content });
        sse({ type: 'done', content });
        res.end();
        return;
      }

      const full = await pumpSse(upstream, (s) => {
        armIdle();
        sse({ type: 'delta', content: s });
      });
      sse({ type: 'done', content: full });
      res.end();
    } catch (err) {
      const msg =
        (err as Error).name === 'AbortError'
          ? sseStarted
            ? '回复超时中断'
            : `请求超时（${Math.round(timeouts.firstByteMs / 1000)} 秒），请检查接口地址或稍后重试`
          : `无法连接接口：${(err as Error).message}`;
      if (sseStarted) {
        sse({ type: 'error', error: msg });
        res.end();
      } else if ((err as Error).name === 'AbortError') {
        res.status(504).json({ error: msg });
      } else {
        res.status(502).json({ error: msg });
      }
    } finally {
      clearTimeout(totalTimer);
      clearTimeout(firstByteTimer);
      clearTimeout(idleTimer);
    }
  });

  return router;
}
