import { type Request, type Response, Router } from 'express';
import { z } from 'zod';

/**
 * 柯基 AI 助手路由：OpenAI 兼容接口转发（绕开浏览器 CORS）。
 * Key 由前端随请求传入，不落库不记录，后端零感知用户凭据。
 *
 * 流式协议：body 传 stream:true 时，响应为自家简化 SSE 事件流
 * （服务端解析上游 OpenAI chunk 后重组，不原样字节透传）：
 *   data: {"type":"delta","content":"…"}   逐段
 *   data: {"type":"tool_calls","tool_calls":[…]}  上游要求工具调用（done 前发一次，
 *                                                  arguments 为聚合后的完整 JSON 字符串）
 *   data: {"type":"done","content":"全文"}  正常结束
 *   data: {"type":"error","error":"…"}      流中途失败（随后 res.end()）
 * 流开始前（连接失败 / 上游非 200 / 首字节超时 / zod 400）仍回 JSON 错误，
 * 与非流式语义一致。
 *
 * 工具调用（function calling）：后端只透传 tools 定义与 tool_calls 消息、
 * 聚合上游流式碎片；**执行在前端**（先确认再写入），本路由不碰数据库。
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

/** 聚合后的工具调用（贴近 OpenAI wire 格式） */
export interface UpstreamToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** 消息里的 tool_calls（assistant 发起工具调用时携带） */
const toolCallSchema = z.object({
  id: z.string().max(200),
  type: z.literal('function'),
  function: z.object({
    name: z.string().max(200),
    arguments: z.string().max(64_000),
  }),
});

const aiMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  // 工具结果回传需要更长余量；assistant 带 tool_calls 时 content 可为空串
  content: z.string().max(16_000, '单条消息过长'),
  tool_calls: z.array(toolCallSchema).max(20).optional(),
  tool_call_id: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
});

const aiToolSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().max(200),
    description: z.string().max(4000),
    parameters: z.unknown().optional(),
  }),
});

const aiChatSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .regex(/^https?:\/\//, '接口地址应以 http:// 或 https:// 开头'),
  apiKey: z.string().trim().min(1, 'API Key 不能为空').max(500),
  model: z.string().trim().min(1, '模型名不能为空').max(200),
  messages: z
    .array(aiMessageSchema)
    .min(1, '消息不能为空')
    .max(80, '对话历史过长，请开启新对话'),
  stream: z.boolean().optional(),
  tools: z.array(aiToolSchema).max(20).optional(),
  tool_choice: z.enum(['auto', 'none']).optional(),
});

/** 上游非 200 的友好文案（与旧版一致） */
function upstreamBrief(status: number): string {
  return status === 401
    ? 'API Key 无效或未授权'
    : status === 429
      ? '调用频率超限或余额不足'
      : `上游接口返回 ${status}`;
}

/** 非流式响应里的 message.tool_calls（完整对象）归一；坏条目跳过 */
function normalizeToolCalls(raw: unknown): UpstreamToolCall[] {
  if (!Array.isArray(raw)) return [];
  const out: UpstreamToolCall[] = [];
  for (const item of raw) {
    const t = item as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    if (typeof t?.function?.name !== 'string' || !t.function.name) continue;
    out.push({
      id: typeof t.id === 'string' ? t.id : '',
      type: 'function',
      function: {
        name: t.function.name,
        arguments: typeof t.function.arguments === 'string' ? t.function.arguments : '',
      },
    });
  }
  return out;
}

/**
 * 逐行消费上游 SSE，解析 OpenAI chunk 的 delta.content 与 delta.tool_calls。
 * 行缓冲 + TextDecoder({stream:true}) 防中文跨 chunk 截断；
 * 跳过 keepalive 注释行 / [DONE] / role-only 块 / usage 块 / 坏行。
 * tool_calls 为分片增量：按 index 聚合（id/name 覆盖式、arguments 字符串追加），
 * 缺 index 容错为 0；流结束统一 flush 成完整调用列表。
 */
async function pumpSse(
  upstream: Response,
  onDelta: (s: string) => void,
): Promise<{ content: string; toolCalls: UpstreamToolCall[] }> {
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let full = '';
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();
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
        const j = JSON.parse(payload) as {
          choices?: { delta?: { content?: unknown; tool_calls?: unknown[] } }[];
        };
        const delta = j.choices?.[0]?.delta;
        const c = delta?.content;
        if (typeof c === 'string' && c) {
          full += c;
          onDelta(c);
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const item of delta.tool_calls) {
            const frag = item as {
              index?: unknown;
              id?: unknown;
              function?: { name?: unknown; arguments?: unknown };
            };
            const idx = typeof frag.index === 'number' ? frag.index : 0;
            const slot = toolAcc.get(idx) ?? { id: '', name: '', args: '' };
            if (typeof frag.id === 'string' && frag.id) slot.id = frag.id;
            if (typeof frag.function?.name === 'string' && frag.function.name) slot.name = frag.function.name;
            if (typeof frag.function?.arguments === 'string') slot.args += frag.function.arguments;
            toolAcc.set(idx, slot);
          }
        }
      } catch {
        // 忽略无法解析的行
      }
    }
    return { done: false, rest };
  };

  for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
    const r = consumeLines(buf + decoder.decode(chunk, { stream: true }), false);
    buf = r.rest; // 必须先更新再判 done（done 时 rest=''），否则尾部行会被终末 flush 重复消费
    if (r.done) break;
  }
  // 上游关流未发 [DONE]：按正常结束处理，冲洗解码器后吃完剩余行
  consumeLines(buf + decoder.decode(), true);
  const toolCalls: UpstreamToolCall[] = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, s]) => ({ id: s.id, type: 'function', function: { name: s.name, arguments: s.args } }));
  return { content: full, toolCalls };
}

export default function aiRoutes(timeoutOverrides?: Partial<AiTimeouts>): Router {
  const timeouts: AiTimeouts = { ...DEFAULT_TIMEOUTS, ...timeoutOverrides };
  const router = Router();

  router.post('/chat', async (req: Request, res: Response) => {
    const input = aiChatSchema.parse(req.body);
    const url = input.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const upstreamBody: Record<string, unknown> = { model: input.model, messages: input.messages };
    if (input.stream) upstreamBody.stream = true;
    if (input.tools) upstreamBody.tools = input.tools;
    if (input.tool_choice) upstreamBody.tool_choice = input.tool_choice;

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
        const data = (await upstream.json()) as {
          choices?: { message?: { content?: string; tool_calls?: unknown } }[];
        };
        const message = data.choices?.[0]?.message;
        const toolCalls = normalizeToolCalls(message?.tool_calls);
        const content = message?.content;
        // 纯工具调用时上游 content 可能为 null：有 tool_calls 即视为有效响应
        if (typeof content !== 'string' && toolCalls.length === 0) {
          res.status(502).json({ error: '上游返回格式异常（缺少回复内容）' });
          return;
        }
        res.json({ content: content ?? '', toolCalls });
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
        const data = (await upstream.json()) as {
          choices?: { message?: { content?: string; tool_calls?: unknown } }[];
        };
        const message = data.choices?.[0]?.message;
        const toolCalls = normalizeToolCalls(message?.tool_calls);
        const content = message?.content;
        if (typeof content !== 'string' && toolCalls.length === 0) {
          sse({ type: 'error', error: '上游返回格式异常（缺少回复内容）' });
          res.end();
          return;
        }
        if (content) sse({ type: 'delta', content });
        if (toolCalls.length) sse({ type: 'tool_calls', tool_calls: toolCalls });
        sse({ type: 'done', content: content ?? '' });
        res.end();
        return;
      }

      const { content: full, toolCalls } = await pumpSse(upstream, (s) => {
        armIdle();
        sse({ type: 'delta', content: s });
      });
      if (toolCalls.length) sse({ type: 'tool_calls', tool_calls: toolCalls });
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
