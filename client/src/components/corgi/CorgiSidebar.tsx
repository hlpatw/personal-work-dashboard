import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { marked } from 'marked';
import { useAiConfigStore } from '../../stores/aiConfig';
import { useCorgiChatStore, CORGI_MIN_WIDTH, CORGI_MAX_WIDTH, CORGI_DEFAULT_WIDTH } from '../../stores/corgiChat';
import { chat } from '../../api/ai';
import { QUICK_PROMPT_TODAY } from '../../lib/corgiContext';
import Modal from '../Modal';
import { IconChat } from '../icons';
import SessionMenu from './SessionMenu';
import ToolCard from './ToolCard';
import type { ChatMessage } from '../../stores/corgiChat';
import type { ToolExecOutcome } from '../../lib/corgiTools';

/** 无活跃会话时的稳定空数组（避免每帧新引用触发重渲） */
const NO_MESSAGES: ChatMessage[] = [];

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
  'w-full rounded-lg bg-black/[0.035] px-3 py-2 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:ring-2 focus:ring-rose-400/30 dark:bg-white/[0.05] dark:text-zinc-100';

export default function CorgiSidebar() {
  const {
    sessions,
    activeSessionId,
    open,
    streamingText,
    phase,
    pendingCallIds,
    error,
    setOpen,
    send,
    width,
    setWidth,
  } = useCorgiChatStore();
  const messages = sessions.find((x) => x.id === activeSessionId)?.messages ?? NO_MESSAGES;
  const { baseUrl, apiKey, model, todayContext, toolsEnabled, setConfig } = useAiConfigStore();
  const [draft, setDraft] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const configured = Boolean(baseUrl && apiKey && model);
  /** 流式请求在途（awaiting_confirm 不算忙：可以发新消息，会按跳过善后） */
  const busy = phase === 'streaming' || phase === 'summarizing';

  // ---- 拖拽调宽：拖动中走本地 dragWidth（不逐帧写 localStorage），松手才落 store ----
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragging = useRef(false);
  const clampWidth = (v: number) =>
    Math.min(CORGI_MAX_WIDTH, Math.max(CORGI_MIN_WIDTH, Math.min(v, window.innerWidth - 560)));

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setDragWidth(clampWidth(window.innerWidth - e.clientX));
  };
  const onHandleEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setWidth(clampWidth(window.innerWidth - e.clientX));
    setDragWidth(null);
  };

  // 新消息 / 流式增量 → 自动滚到底
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, phase, streamingText]);

  const doSend = (text?: string) => {
    const content = (text ?? draft).trim();
    if (!content || busy) return;
    setDraft('');
    void send(content);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      doSend();
    }
  };

  const fillQuickPrompt = () => {
    setDraft(QUICK_PROMPT_TODAY);
    textareaRef.current?.focus();
  };

  // 收起态：贴右缘的窄竖条把手
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex h-full w-9 shrink-0 flex-col items-center justify-center gap-2 border-l border-black/[0.06] bg-[#faf6f9]/[0.74] text-zinc-500 backdrop-blur-[22px] backdrop-saturate-140 transition-colors hover:bg-black/[0.04] hover:text-zinc-700 dark:border-white/[0.05] dark:bg-[#09090c]/[0.72] dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
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
    <aside
      data-testid="corgi-sidebar"
      style={{ width: dragWidth ?? width }}
      className={`relative flex h-full shrink-0 flex-col border-l border-black/[0.06] bg-[#faf6f9]/[0.74] backdrop-blur-[22px] backdrop-saturate-140 dark:border-white/[0.05] dark:bg-[#09090c]/[0.72] ${
        dragWidth ? 'transition-none' : 'transition-[width] duration-100 ease-out'
      }`}
    >
      {/* 左缘拖拽把手：平时隐形，hover / 拖动中显玫红；双击回默认宽 */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整柯基侧栏宽度"
        title="拖动调宽 · 双击恢复默认"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleEnd}
        onPointerCancel={onHandleEnd}
        onDoubleClick={() => setWidth(CORGI_DEFAULT_WIDTH)}
        className={`absolute -left-1 top-0 z-10 h-full w-1.5 cursor-col-resize rounded transition-colors ${
          dragWidth ? 'bg-rose-400/45' : 'hover:bg-rose-400/45'
        }`}
      />
      {/* 头部：左侧会话菜单（切换/删除/新建），右侧设置与收起 */}
      <div className="flex shrink-0 items-center justify-between border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.05]">
        <SessionMenu />
        <div className="flex items-center gap-1">
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
          <div className="rounded-xl border border-black/[0.06] bg-white/[0.85] p-4 text-center dark:border-white/[0.06] dark:bg-white/[0.06]">
            <p className="text-2xl">🐕</p>
            <p className="mt-2 text-sm font-medium">我是柯基，很高兴认识你！</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              先配置一个 OpenAI 兼容的 AI 接口，我就能陪你聊天啦
            </p>
            <button
              onClick={() => setShowSettings(true)}
              className="mt-3 rounded-lg bg-rose-500 px-4 py-1.5 text-xs font-medium text-rose-fg transition-colors hover:bg-rose-400"
            >
              去配置
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-xl border border-black/[0.06] bg-white/[0.85] p-4 text-center dark:border-white/[0.06] dark:bg-white/[0.06]">
            <p className="text-2xl">🐕</p>
            <p className="mt-2 text-sm font-medium">嗨，我是柯基！</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              想聊点什么？工作烦恼、新点子，或者随便唠唠都行
            </p>
            <button
              onClick={fillQuickPrompt}
              className="mt-3 rounded-lg bg-black/[0.04] px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-black/[0.07] dark:bg-white/[0.06] dark:text-zinc-300 dark:hover:bg-white/[0.09]"
              title="把快捷指令填入输入框（可修改后再发送）"
            >
              🗓 帮我安排今天
            </button>
          </div>
        ) : (
          messages.map((m, i) => {
            if (m.role === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-rose-500 px-3.5 py-2 text-sm text-rose-fg">
                    {m.content}
                  </div>
                </div>
              );
            }
            if (m.role === 'assistant') {
              if ('toolCalls' in m) {
                // 工具确认卡：pendingCallIds 命中=待确认；后续 tool 消息齐=结果态；否则失效（刷新）
                const answered = new Map<string, ToolExecOutcome>();
                for (const later of messages.slice(i + 1)) {
                  if (later.role === 'tool' && m.toolCalls.some((c) => c.id === later.toolCallId)) {
                    answered.set(later.toolCallId, later.outcome);
                  }
                }
                const isPending = m.toolCalls.some((c) => pendingCallIds?.includes(c.id));
                const allAnswered = m.toolCalls.every((c) => answered.has(c.id));
                const outcomes = m.toolCalls
                  .map((c) => answered.get(c.id))
                  .filter((o): o is ToolExecOutcome => Boolean(o));
                return (
                  <ToolCard
                    key={i}
                    calls={m.toolCalls}
                    outcomes={outcomes}
                    state={isPending ? 'pending' : allAnswered ? 'done' : 'stale'}
                  />
                );
              }
              return (
                <div key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-base">🐕</span>
                  <div
                    className="corgi-md max-w-[85%] rounded-2xl rounded-tl-md border border-black/[0.06] bg-white/[0.85] px-3.5 py-2 text-sm dark:border-white/[0.06] dark:bg-white/[0.06]"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                  />
                </div>
              );
            }
            return null; // tool 结果消息已并入对应确认卡
          })
        )}
        {/* 流式中的临时气泡（全文增量重渲） */}
        {busy && streamingText && (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-base">🐕</span>
            <div
              className="corgi-md max-w-[85%] rounded-2xl rounded-tl-md border border-black/[0.06] bg-white/[0.85] px-3.5 py-2 text-sm dark:border-white/[0.06] dark:bg-white/[0.06]"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingText) }}
            />
          </div>
        )}
        {busy && !streamingText && (
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 text-base">🐕</span>
            <div className="rounded-2xl rounded-tl-md border border-black/[0.06] bg-white/[0.85] px-3.5 py-2 text-sm text-zinc-400 dark:border-white/[0.06] dark:bg-white/[0.06]">
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
        {/* 今日安排：发送时附带今日任务/日程快照；系统操作：柯基工具调用总开关 */}
        <div className="mb-2 flex items-center gap-1.5">
          <button
            onClick={() => setConfig({ todayContext: !todayContext })}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              todayContext
                ? 'bg-rose-500/[0.16] text-rose-600 dark:text-rose-400'
                : 'bg-zinc-500/15 text-zinc-400 dark:text-zinc-500'
            }`}
            title={todayContext ? '已开启：发送时向柯基附带今日任务与日程摘要' : '已关闭：不附带今日数据'}
          >
            🗓 今日安排 {todayContext ? '· 开' : '· 关'}
          </button>
          <button
            onClick={() => setConfig({ toolsEnabled: !toolsEnabled })}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              toolsEnabled
                ? 'bg-rose-500/[0.16] text-rose-600 dark:text-rose-400'
                : 'bg-zinc-500/15 text-zinc-400 dark:text-zinc-500'
            }`}
            title={toolsEnabled ? '已开启：柯基可帮你建任务/查任务/完成/建日程/记灵感（写操作先经确认卡）' : '已关闭：柯基纯聊天，不能操作系统'}
          >
            🔧 系统操作 {toolsEnabled ? '· 开' : '· 关'}
          </button>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            className="max-h-28 min-h-[40px] flex-1 resize-none rounded-lg bg-black/[0.035] px-3 py-2 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:ring-2 focus:ring-rose-400/30 dark:bg-white/[0.05] dark:text-zinc-100"
            placeholder={configured ? '和柯基聊聊…（Enter 发送）' : '请先在设置中配置 AI 接口'}
            rows={1}
            value={draft}
            disabled={!configured || busy}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 112)}px`;
            }}
            onKeyDown={onKeyDown}
          />
          <button
            onClick={() => doSend()}
            disabled={!draft.trim() || busy || !configured}
            className="shrink-0 rounded-lg bg-rose-500 px-3 py-2 text-rose-fg transition-colors hover:bg-rose-400 disabled:opacity-50"
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
      const { content } = await chat({
        baseUrl: draft.baseUrl,
        apiKey: draft.apiKey,
        model: draft.model,
        messages: [
          { role: 'system', content: '你是柯基。' },
          { role: 'user', content: '你好' },
        ],
      });
      setTestResult({ ok: true, msg: `连接成功！柯基回复：${content}` });
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
              className="shrink-0 rounded-lg bg-black/[0.035] px-3 text-sm text-zinc-500 transition-colors hover:bg-black/[0.06] dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08]"
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
            className="rounded-lg bg-black/[0.035] px-3.5 py-2 text-sm text-zinc-600 transition-colors hover:bg-black/[0.06] disabled:opacity-50 dark:bg-white/[0.05] dark:text-zinc-300 dark:hover:bg-white/[0.08]"
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-sm text-zinc-500 transition-colors hover:bg-black/[0.05] hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
            >
              取消
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-rose-fg transition-colors hover:bg-rose-400"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
