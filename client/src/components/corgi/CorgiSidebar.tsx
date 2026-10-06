import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { marked } from 'marked';
import { useAiConfigStore } from '../../stores/aiConfig';
import { useCorgiChatStore } from '../../stores/corgiChat';
import Modal from '../Modal';
import { IconChat } from '../icons';

marked.setOptions({ breaks: true, async: false });

/** 渲染 markdown（柯基回复用）。输入均来自用户自己的对话，XSS 面极小；
 *  marked 关闭 html 输出之外再过滤 script/事件属性，双保险。 */
function renderMarkdown(text: string): string {
  const html = marked.parse(text) as string;
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

const inputCls =
  'w-full rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:ring-2 focus:ring-rose-400/30 dark:bg-[#1f1f24] dark:text-zinc-100';

export default function CorgiSidebar() {
  const { messages, open, addMessage, clearChat, setOpen } = useCorgiChatStore();
  const { baseUrl, apiKey, model, systemPrompt } = useAiConfigStore();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const configured = Boolean(baseUrl && apiKey && model);

  // 新消息自动滚到底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, sending]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setError('');
    setDraft('');
    addMessage({ role: 'user', content });
    setSending(true);
    try {
      const history = [
        { role: 'system' as const, content: systemPrompt || '你是柯基，温暖的陪伴助手。' },
        ...useCorgiChatStore.getState().messages,
      ];
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey, model, messages: history }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `请求失败（${res.status}）`);
      addMessage({ role: 'assistant', content: data.content });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  // 收起态：贴右缘的窄竖条把手
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex h-full w-9 shrink-0 flex-col items-center justify-center gap-2 border-l border-black/[0.06] bg-[#f2f2f4] text-zinc-500 transition-colors hover:bg-zinc-200/60 hover:text-zinc-700 dark:border-white/[0.05] dark:bg-[#0a0a0c] dark:text-zinc-400 dark:hover:bg-[#1f1f24] dark:hover:text-zinc-200"
        title="展开柯基助手"
        aria-label="展开柯基助手"
      >
        <span className="text-lg">🐕</span>
        <span className="text-[10px] [writing-mode:vertical-rl] tracking-widest">柯基</span>
      </button>
    );
  }

  // 展开态
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-black/[0.06] bg-[#f2f2f4] dark:border-white/[0.05] dark:bg-[#0a0a0c]">
      {/* 头部 */}
      <div className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.05]">
        <div className="flex items-center gap-2">
          <span className="text-lg">🐕</span>
          <span className="text-sm font-semibold">柯基</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (messages.length === 0 || window.confirm('开始新对话？当前聊天记录将被清空。')) clearChat();
            }}
            className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            title="新对话"
          >
            新对话
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            title="AI 设置"
          >
            ⚙ 设置
          </button>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            title="收起"
          >
            <span className="block rotate-180 text-base leading-none">»</span>
          </button>
        </div>
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!configured && messages.length === 0 ? (
          <div className="rounded-xl bg-white p-4 text-center ring-1 ring-black/[0.05] dark:bg-[#17171b] dark:ring-white/[0.045]">
            <p className="text-2xl">🐕</p>
            <p className="mt-2 text-sm font-medium">我是柯基，很高兴认识你！</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              先配置一个 OpenAI 兼容的 AI 接口，我就能陪你聊天啦
            </p>
            <button
              onClick={() => setShowSettings(true)}
              className="mt-3 rounded-lg bg-rose-500 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-400"
            >
              去配置
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-xl bg-white p-4 text-center ring-1 ring-black/[0.05] dark:bg-[#17171b] dark:ring-white/[0.045]">
            <p className="text-2xl">🐕</p>
            <p className="mt-2 text-sm font-medium">嗨，我是柯基！</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              想聊点什么？工作烦恼、新点子，或者随便唠唠都行
            </p>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-rose-500 px-3.5 py-2 text-sm text-white">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-0.5 shrink-0 text-base">🐕</span>
                <div
                  className="corgi-md max-w-[85%] rounded-2xl rounded-tl-md bg-white px-3.5 py-2 text-sm ring-1 ring-black/[0.05] dark:bg-[#17171b] dark:ring-white/[0.045]"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                />
              </div>
            )
          )
        )}
        {sending && (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-base">🐕</span>
            <div className="rounded-2xl rounded-tl-md bg-white px-3.5 py-2 text-sm text-zinc-400 ring-1 ring-black/[0.05] dark:bg-[#17171b] dark:ring-white/[0.045]">
              <span className="animate-pulse">柯基思考中…</span>
            </div>
          </div>
        )}
        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500 dark:text-red-400">{error}</p>
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-black/[0.06] p-3 dark:border-white/[0.05]">
        <div className="flex items-end gap-2">
          <textarea
            className="max-h-28 min-h-[40px] flex-1 resize-none rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:ring-2 focus:ring-rose-400/30 dark:bg-[#1f1f24] dark:text-zinc-100"
            placeholder={configured ? '和柯基聊聊…（Enter 发送）' : '请先在设置中配置 AI 接口'}
            rows={1}
            value={draft}
            disabled={!configured || sending}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 112)}px`;
            }}
            onKeyDown={onKeyDown}
          />
          <button
            onClick={() => void send()}
            disabled={!draft.trim() || sending || !configured}
            className="shrink-0 rounded-lg bg-rose-500 px-3 py-2 text-white transition-colors hover:bg-rose-400 disabled:opacity-50"
            aria-label="发送"
          >
            <IconChat className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showSettings && <CorgiSettingsModal onClose={() => setShowSettings(false)} />}
    </aside>
  );
}

/** AI 设置弹窗：纯自定义 OpenAI 兼容配置 + 连接测试 */
function CorgiSettingsModal({ onClose }: { onClose: () => void }) {
  const { baseUrl, apiKey, model, systemPrompt, setConfig } = useAiConfigStore();
  const [draft, setDraft] = useState({ baseUrl, apiKey, model, systemPrompt });
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const save = () => {
    setConfig(draft);
    onClose();
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey,
          model: draft.model,
          messages: [
            { role: 'system', content: '你是柯基。' },
            { role: 'user', content: '你好' },
          ],
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `请求失败（${res.status}）`);
      setTestResult({ ok: true, msg: `连接成功！柯基回复：${String(data.content)}` });
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal title="柯基 · AI 设置" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">接口地址（OpenAI 兼容）</label>
          <input
            className={inputCls}
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            placeholder="如 https://api.deepseek.com/v1"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">模型名</label>
          <input
            className={inputCls}
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            placeholder="如 deepseek-chat"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">API Key（仅存本地浏览器）</label>
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              className={inputCls}
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder="sk-…"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="shrink-0 rounded-lg bg-zinc-100 px-3 text-sm text-zinc-500 transition-colors hover:bg-zinc-200/70 dark:bg-[#1f1f24] dark:text-zinc-300 dark:hover:bg-[#26262b]"
            >
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">柯基的性格（系统提示词）</label>
          <textarea
            className={`${inputCls} h-24 resize-none`}
            value={draft.systemPrompt}
            onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
          />
        </div>
        {testResult && (
          <p className={`text-xs ${testResult.ok ? 'text-emerald-500' : 'text-red-500'}`}>{testResult.msg}</p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={test}
            disabled={testing || !draft.baseUrl || !draft.apiKey || !draft.model}
            className="rounded-lg bg-zinc-100 px-3.5 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-200/70 disabled:opacity-50 dark:bg-[#1f1f24] dark:text-zinc-300 dark:hover:bg-[#26262b]"
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-[#26262b] dark:hover:text-zinc-200"
            >
              取消
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-400"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
