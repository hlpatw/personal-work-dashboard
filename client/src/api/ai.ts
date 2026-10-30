/** 柯基 AI 接口：流式（fetch + ReadableStream 逐行读自家 SSE 事件）与非流式 */

/** 上游 wire 格式的工具调用（arguments 为 JSON 字符串） */
export interface AiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type AiChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: AiToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string; name?: string };

/** 发给上游的工具定义（function calling） */
export interface AiToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

export interface AiChatBody {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: AiChatMessage[];
  stream?: boolean;
  tools?: AiToolDef[];
  tool_choice?: 'auto' | 'none';
}

export interface StreamResult {
  content: string;
  toolCalls: AiToolCall[];
}

/** 非流式（设置弹窗"测试连接"等一次性场景用） */
export async function chat(body: AiChatBody): Promise<{ content: string; toolCalls: AiToolCall[] }> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as {
    content?: string;
    toolCalls?: AiToolCall[];
    error?: string;
  } | null;
  if (!res.ok) throw new Error(data?.error ?? `请求失败（${res.status}）`);
  if (typeof data?.content !== 'string') throw new Error('上游返回格式异常');
  return { content: data.content, toolCalls: data.toolCalls ?? [] };
}

/**
 * 流式：服务端返回自家简化 SSE 事件（delta / tool_calls / done / error）。
 * 行缓冲 + TextDecoder({stream:true}) 防中文跨 chunk 截断。
 */
export async function streamChat(
  body: AiChatBody,
  handlers: { onDelta: (s: string) => void; signal: AbortSignal }
): Promise<StreamResult> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
    signal: handlers.signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `请求失败（${res.status}）`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let acc = '';
  let final = ''; // done 事件携带的权威全文
  let finalToolCalls: AiToolCall[] = []; // tool_calls 事件（done 前最多一次）

  const handleEvent = (payload: string) => {
    let ev: {
      type?: string;
      content?: string;
      error?: string;
      tool_calls?: AiToolCall[];
    };
    try {
      ev = JSON.parse(payload);
    } catch {
      return; // 忽略坏行
    }
    if (ev.type === 'delta' && ev.content) {
      acc += ev.content;
      handlers.onDelta(ev.content);
    } else if (ev.type === 'tool_calls' && Array.isArray(ev.tool_calls)) {
      finalToolCalls = ev.tool_calls;
    } else if (ev.type === 'done') {
      final = ev.content ?? acc;
    } else if (ev.type === 'error') {
      throw new Error(ev.error ?? '回复中断');
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? ''; // 最后一段可能不完整，留缓冲
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        handleEvent(s.slice(5).trim());
      }
    }
    buf += decoder.decode();
    const s = buf.trim();
    if (s.startsWith('data:')) handleEvent(s.slice(5).trim());
    return { content: final || acc, toolCalls: finalToolCalls };
  } finally {
    reader.releaseLock();
  }
}
