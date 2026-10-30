import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';

/** 本地 mock 上游工厂：起真实 http 服务模拟 OpenAI 兼容接口 */
interface Upstream {
  baseUrl: string;
  server: http.Server;
}

const upstreams: Upstream[] = [];

async function startUpstream(handler: http.RequestListener): Promise<Upstream> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const up = { baseUrl: `http://127.0.0.1:${port}/v1`, server };
  upstreams.push(up);
  return up;
}

afterEach(async () => {
  for (const up of upstreams) {
    up.server.closeAllConnections?.();
    await new Promise<void>((r) => up.server.close(() => r()));
  }
  upstreams.length = 0;
});

/** 基础合法请求体（baseUrl 由用例填） */
function body(baseUrl: string, extra: Record<string, unknown> = {}) {
  return {
    baseUrl,
    apiKey: 'sk-test',
    model: 'mock-model',
    messages: [{ role: 'user', content: '你好' }],
    ...extra,
  };
}

/** 上游 SSE chunk 帧 */
const sseChunk = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

/** 把自家 SSE 响应全文解析成事件数组（便于断言顺序与结构） */
function sseEvents(text: string): { type?: string; [k: string]: unknown }[] {
  return text
    .split('\n\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)));
}

describe('ai/chat', () => {
  it('非流式：上游 JSON → {content}', async () => {
    const up = await startUpstream((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '你好呀' } }] }));
    });
    const res = await request(createApp(':memory:')).post('/api/ai/chat').send(body(up.baseUrl));
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('你好呀');
  });

  it('流式：上游 SSE 分块 → delta×N + done（按序）', async () => {
    const up = await startUpstream((_req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      void (async () => {
        for (const piece of ['今天', '记得', '喝水']) {
          res.write(sseChunk(piece));
          await new Promise((r) => setImmediate(r));
        }
        res.write('data: [DONE]\n\n');
        res.end();
      })();
    });
    const res = await request(createApp(':memory:'))
      .post('/api/ai/chat')
      .send(body(up.baseUrl, { stream: true }));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const t = res.text;
    const i1 = t.indexOf('"type":"delta","content":"今天"');
    const i2 = t.indexOf('"type":"delta","content":"记得"');
    const i3 = t.indexOf('"type":"delta","content":"喝水"');
    const i4 = t.indexOf('"type":"done","content":"今天记得喝水"');
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(i4).toBeGreaterThan(i3);
  });

  it('上游 401 → 502 + 友好文案（JSON，非 SSE）', async () => {
    const up = await startUpstream((_req, res) => {
      res.statusCode = 401;
      res.end('unauthorized');
    });
    const res = await request(createApp(':memory:'))
      .post('/api/ai/chat')
      .send(body(up.baseUrl, { stream: true }));
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('API Key 无效');
  });

  it('降级：上游忽略 stream 返回 JSON → 仍为 SSE，单 delta + done', async () => {
    const up = await startUpstream((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '整段回复' } }] }));
    });
    const res = await request(createApp(':memory:'))
      .post('/api/ai/chat')
      .send(body(up.baseUrl, { stream: true }));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('"type":"delta","content":"整段回复"');
    expect(res.text).toContain('"type":"done","content":"整段回复"');
  });

  it('流式空闲超时 → SSE error 事件', async () => {
    const up = await startUpstream((_req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.write(sseChunk('开头')); // 之后挂住不再发
    });
    const res = await request(createApp(':memory:', { aiTimeouts: { idleMs: 150 } }))
      .post('/api/ai/chat')
      .send(body(up.baseUrl, { stream: true }));
    expect(res.status).toBe(200);
    expect(res.text).toContain('"type":"delta","content":"开头"');
    expect(res.text).toContain('"type":"error"');
    expect(res.text).toContain('回复超时中断');
  });

  it('首字节超时 → 504 JSON（流尚未开始）', async () => {
    const up = await startUpstream(() => {
      /* 收到请求但永不响应 */
    });
    const res = await request(createApp(':memory:', { aiTimeouts: { firstByteMs: 150 } }))
      .post('/api/ai/chat')
      .send(body(up.baseUrl, { stream: true }));
    expect(res.status).toBe(504);
    expect(res.body.error).toContain('请求超时');
  });

  it('客户端断开 → 上游连接被掐断', async () => {
    let upstreamClosed = false;
    const up = await startUpstream((_req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.write(sseChunk('慢'));
      res.on('close', () => {
        upstreamClosed = true;
      });
      // 挂住模拟长回复
    });
    const srv = createApp(':memory:', { aiTimeouts: { idleMs: 10_000, firstByteMs: 2_000 } }).listen(0);
    const { port } = srv.address() as AddressInfo;
    try {
      const ac = new AbortController();
      const inflight = fetch(`http://127.0.0.1:${port}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body(up.baseUrl, { stream: true })),
        signal: ac.signal,
      }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 300));
      ac.abort();
      await inflight;
      const deadline = Date.now() + 2_000;
      while (!upstreamClosed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(upstreamClosed).toBe(true);
    } finally {
      srv.closeAllConnections?.();
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it('zod 校验：stream 非布尔 / 消息超 80 条 → 400', async () => {
    const up = await startUpstream(() => {});
    const app = createApp(':memory:');
    const r1 = await request(app).post('/api/ai/chat').send(body(up.baseUrl, { stream: 'yes' }));
    expect(r1.status).toBe(400);
    const r2 = await request(app)
      .post('/api/ai/chat')
      .send(
        body(up.baseUrl, {
          messages: Array.from({ length: 81 }, () => ({ role: 'user' as const, content: 'x' })),
        })
      );
    expect(r2.status).toBe(400);
    expect(r2.body.error).toContain('对话历史过长');
  });

  /* ---------------- 工具调用（function calling） ---------------- */

  const TOOLS = [
    {
      type: 'function' as const,
      function: { name: 'create_tasks', description: '批量创建任务', parameters: { type: 'object' } },
    },
  ];

  it('流式 tool_calls 碎片聚合 → tool_calls 事件（done 之前，arguments 完整）', async () => {
    const up = await startUpstream((_req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      void (async () => {
        // 首块带 id/name + 半截 arguments，后续块续 arguments（跨块分片）
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'create_tasks', arguments: '{"ta' } }] } }],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'sks":[{"title":"写周报"}]}' } }] } }],
          })}\n\n`,
        );
        res.write(sseChunk('帮你记好了'));
        res.write('data: [DONE]\n\n');
        res.end();
      })();
    });
    const res = await request(createApp(':memory:'))
      .post('/api/ai/chat')
      .send(body(up.baseUrl, { stream: true, tools: TOOLS }));
    expect(res.status).toBe(200);
    const events = sseEvents(res.text);
    const tcIdx = events.findIndex((e) => e.type === 'tool_calls');
    const doneIdx = events.findIndex((e) => e.type === 'done');
    expect(tcIdx).toBeGreaterThan(-1);
    expect(doneIdx).toBeGreaterThan(tcIdx);
    expect(events[tcIdx].tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'create_tasks', arguments: '{"tasks":[{"title":"写周报"}]}' },
      },
    ]);
    // 前置文本照常 delta + done 全文
    expect(res.text).toContain('"type":"delta","content":"帮你记好了"');
    expect(res.text).toContain('"type":"done","content":"帮你记好了"');
  });

  it('tools / tool_choice 原样透传到上游', async () => {
    let received: { tools?: unknown; tool_choice?: unknown } = {};
    const up = await startUpstream((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c));
      req.on('end', () => {
        received = JSON.parse(raw);
        res.setHeader('content-type', 'text/event-stream');
        res.write(sseChunk('好'));
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    const res = await request(createApp(':memory:'))
      .post('/api/ai/chat')
      .send(body(up.baseUrl, { stream: true, tools: TOOLS, tool_choice: 'auto' }));
    expect(res.status).toBe(200);
    expect(received.tools).toEqual(TOOLS);
    expect(received.tool_choice).toBe('auto');
  });

  it('消息放宽：assistant 带 tool_calls + role:tool 回传可通过并到达上游', async () => {
    let received: { messages?: unknown[] } = {};
    const up = await startUpstream((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c));
      req.on('end', () => {
        received = JSON.parse(raw);
        res.setHeader('content-type', 'text/event-stream');
        res.write(sseChunk('收到'));
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    const messages = [
      { role: 'user' as const, content: '帮我记个任务' },
      {
        role: 'assistant' as const,
        content: '',
        tool_calls: [
          { id: 'call_1', type: 'function' as const, function: { name: 'create_tasks', arguments: '{"tasks":[]}' } },
        ],
      },
      { role: 'tool' as const, content: '{"ok":true}', tool_call_id: 'call_1', name: 'create_tasks' },
    ];
    const res = await request(createApp(':memory:'))
      .post('/api/ai/chat')
      .send(body(up.baseUrl, { stream: true, messages }));
    expect(res.status).toBe(200);
    expect(received.messages).toEqual(messages);
  });

  it('zod 校验：tool_choice 非法 → 400', async () => {
    const up = await startUpstream(() => {});
    const res = await request(createApp(':memory:'))
      .post('/api/ai/chat')
      .send(body(up.baseUrl, { stream: true, tools: TOOLS, tool_choice: 'required' }));
    expect(res.status).toBe(400);
  });

  it('非流式：message.tool_calls → { content:"", toolCalls }（content 可为 null）', async () => {
    const up = await startUpstream((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [{ id: 'call_9', function: { name: 'list_tasks', arguments: '{"today":true}' } }],
              },
            },
          ],
        }),
      );
    });
    const res = await request(createApp(':memory:'))
      .post('/api/ai/chat')
      .send(body(up.baseUrl, { tools: TOOLS }));
    expect(res.status).toBe(200);
    expect(res.body.content).toBe('');
    expect(res.body.toolCalls).toEqual([
      { id: 'call_9', type: 'function', function: { name: 'list_tasks', arguments: '{"today":true}' } },
    ]);
  });

  it('降级：上游 JSON 含 tool_calls → 归一为 tool_calls + done 事件', async () => {
    const up = await startUpstream((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [{ message: { content: null, tool_calls: [{ id: 'c1', function: { name: 'list_tasks', arguments: '{}' } }] } }],
        }),
      );
    });
    const res = await request(createApp(':memory:'))
      .post('/api/ai/chat')
      .send(body(up.baseUrl, { stream: true, tools: TOOLS }));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = sseEvents(res.text);
    expect(events.some((e) => e.type === 'tool_calls')).toBe(true);
    const done = events.find((e) => e.type === 'done');
    expect(done?.content).toBe('');
  });
});
