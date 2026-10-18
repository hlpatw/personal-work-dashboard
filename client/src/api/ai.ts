/** 柯基 AI 接口：流式（fetch + ReadableStream 逐行读自家 SSE 事件）与非流式 */

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiChatBody {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: AiChatMessage[];
  stream?: boolean;
}

/** 非流式（设置弹窗"测试连接"等一次性场景用） */
export async function chat(body: AiChatBody): Promise<{ content: string }> {
  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as { content?: string; error?: string } | null;
  if (!res.ok) throw new Error(data?.error ?? `请求失败（${res.status}）`);
  if (typeof data?.content !== 'string') throw new Error('上游返回格式异常');
  return { content: data.content };
}

/**
 * 流式：服务端返回自家简化 SSE 事件（delta / done / error）。
 * 行缓冲 + TextDecoder({stream:true}) 防中文跨 chunk 截断。
 */
export async function streamChat(
  body: AiChatBody,
  handlers: { onDelta: (s: string) => void; signal: AbortSignal }
): Promise<{ content: string }> {
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

  const handleEvent = (payload: string) => {
    let ev: { type?: string; content?: string; error?: string };
    try {
      ev = JSON.parse(payload);
    } catch {
      return; // 忽略坏行
    }
    if (ev.type === 'delta' && ev.content) {
      acc += ev.content;
      handlers.onDelta(ev.content);
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
    return { content: final || acc };
  } finally {
    reader.releaseLock();
  }
}
