import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { streamChat, type AiChatMessage, type AiToolDef } from '../api/ai';
import { useAiConfigStore } from './aiConfig';
import { buildTodaySnapshot } from '../lib/corgiContext';
import {
  CORGI_TOOLS,
  CORGI_TOOLS_HINT,
  describeCall,
  executeToolCall,
  isReadonlyTool,
  parseToolCalls,
  serializeOutcome,
  type ToolCallRecord,
  type ToolExecOutcome,
  type ToolName,
} from '../lib/corgiTools';

/** 工具轮次上限（防模型无限要工具）；达到后不带 tools 再请求一轮，只能文字收尾 */
const MAX_TOOL_ROUNDS = 4;
/** wire 裁剪上限（不含 system；永远切在 user 边界，不会拆开 toolCalls/tool 组） */
const WIRE_HISTORY_MAX = 28;

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  /** 模型发起工具调用（content 为前置文本，可空） */
  | { role: 'assistant'; content: string; toolCalls: ToolCallRecord[] }
  /** 工具执行结果（content = serializeOutcome 结果，给模型；outcome 给 UI） */
  | { role: 'tool'; content: string; toolCallId: string; name: ToolName; outcome: ToolExecOutcome };

export interface SendOpts {
  /** 该次发送强制附带今日快照（快捷指令用），不受开关约束 */
  forceTodayContext?: boolean;
}

/** 一个独立会话（标题自动取首条用户消息） */
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** 会话软上限：超出自动删最旧（不动当前会话） */
const MAX_SESSIONS = 30;

/** 侧栏宽度限制（可拖拽调宽） */
export const CORGI_MIN_WIDTH = 280;
export const CORGI_MAX_WIDTH = 640;
export const CORGI_DEFAULT_WIDTH = 320;

export type ChatPhase = 'idle' | 'streaming' | 'awaiting_confirm' | 'summarizing';

function makeTitle(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 20) || '新对话';
}

interface CorgiChatState {
  sessions: ChatSession[];
  /** 当前会话 id；'' = 尚未发言的新空会话（首次发言才真正入列，列表不被空会话刷屏） */
  activeSessionId: string;
  /** 侧栏展开状态（独立于聊天内容持久化） */
  open: boolean;
  /** 展开态宽度（拖拽调宽，持久化记住） */
  width: number;
  /** 流式过程中的临时全文（非持久化，避免逐 chunk 写 localStorage） */
  streamingText: string;
  /** 回合阶段（非持久化）：streaming/summarizing 忙；awaiting_confirm 等确认卡 */
  phase: ChatPhase;
  /** awaiting_confirm 时待确认的 call id 列表（确认卡判活依据；非持久化） */
  pendingCallIds: string[] | null;
  error: string;
  newSession: () => void;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  setOpen: (v: boolean) => void;
  /** 记住拖拽后的宽度（clamp 到限制区间） */
  setWidth: (v: number) => void;
  /** 发送并流式接收回复；写类工具调用会挂起为 awaiting_confirm 等确认 */
  send: (text: string, opts?: SendOpts) => Promise<void>;
  /** 确认卡执行完（或跳过）后回传结果，继续本轮对话（流式总结） */
  resumeWithToolResults: (outcomes: ToolExecOutcome[]) => Promise<void>;
}

/** 在途请求（streaming / summarizing 中；awaiting_confirm 时为 null） */
let activeController: AbortController | null = null;
/** awaiting_confirm 时的回合上下文（resume 继续用） */
let pendingTurn: { sid: string; system: string; round: number } | null = null;
/** 上游不支持 tools → 本回合起自动降级（不再带 tools），新 send 时复位 */
let toolsFallback = false;

/** 取指定会话的消息（模块内 helper） */
function sessionMessages(s: CorgiChatState, sid: string): ChatMessage[] {
  return s.sessions.find((x) => x.id === sid)?.messages ?? [];
}

/** 会话软上限裁剪：删最旧，永不动 keepId（当前会话） */
function trimSessions(list: ChatSession[], keepId: string): ChatSession[] {
  const excess = list.length - MAX_SESSIONS;
  if (excess <= 0) return list;
  const drop = new Set(
    list
      .filter((x) => x.id !== keepId)
      .slice(0, excess)
      .map((x) => x.id),
  );
  return list.filter((x) => !drop.has(x.id));
}

/**
 * 持久层消息 → 上游 wire 消息。含两道保护：
 * 1. 悬空修补：assistant.toolCalls 后未跟齐对应 tool 消息（刷新恢复）自动补 skipped，
 *    保证继续对话不会 400；
 * 2. 裁剪：超长时从尾部 user 边界切（不会把 toolCalls 与 tool 结果拆开）。
 */
function buildWireMessages(system: string, s: CorgiChatState, sid: string): AiChatMessage[] {
  const msgs = sessionMessages(s, sid);
  const answered = new Set<string>();
  for (const m of msgs) if (m.role === 'tool') answered.add(m.toolCallId);

  const wire: AiChatMessage[] = [];
  for (const m of msgs) {
    if (m.role === 'user') {
      wire.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      if ('toolCalls' in m && m.toolCalls.length) {
        wire.push({
          role: 'assistant',
          content: m.content,
          tool_calls: m.toolCalls.map((r) => ({
            id: r.id,
            type: 'function' as const,
            function: { name: r.name, arguments: JSON.stringify(r.args) },
          })),
        });
        for (const r of m.toolCalls) {
          if (!answered.has(r.id)) {
            wire.push({
              role: 'tool',
              content: '{"skipped":true,"reason":"页面刷新"}',
              tool_call_id: r.id,
              name: r.name,
            });
          }
        }
      } else {
        wire.push({ role: 'assistant', content: m.content });
      }
    } else {
      wire.push({ role: 'tool', content: m.content, tool_call_id: m.toolCallId, name: m.name });
    }
  }

  let trimmed = wire;
  if (trimmed.length > WIRE_HISTORY_MAX) {
    let start = trimmed.length - WIRE_HISTORY_MAX;
    while (start < trimmed.length && trimmed[start].role !== 'user') start += 1;
    trimmed = trimmed.slice(start);
  }
  return [{ role: 'system', content: system }, ...trimmed];
}

/** 从会话消息里找 call id 对应的记录（跳过注入时取 name 用） */
function findToolRecord(s: CorgiChatState, sid: string, callId: string): ToolCallRecord | undefined {
  for (const m of sessionMessages(s, sid)) {
    if (m.role === 'assistant' && 'toolCalls' in m) {
      const hit = m.toolCalls.find((r) => r.id === callId);
      if (hit) return hit;
    }
  }
  return undefined;
}

export const useCorgiChatStore = create<CorgiChatState>()(
  persist(
    (set, get) => {
      /** 把消息落到指定会话：会话不存在则惰性创建（title 取首条 user 消息） */
      const pushMessageTo = (sid: string, m: ChatMessage) =>
        set((s) => {
          const now = Date.now();
          if (!s.sessions.some((x) => x.id === sid)) {
            const session: ChatSession = {
              id: sid,
              title: m.role === 'user' ? makeTitle(m.content) : '新对话',
              messages: [m],
              createdAt: now,
              updatedAt: now,
            };
            return {
              sessions: trimSessions([...s.sessions, session], sid),
              // 仅当当前还停留在空会话时才认领（中途切走则不打扰）
              activeSessionId: s.activeSessionId || sid,
            };
          }
          return {
            sessions: s.sessions.map((x) =>
              x.id === sid ? { ...x, messages: [...x.messages, m], updatedAt: now } : x,
            ),
          };
        });

      /** 打断在途流式请求（切换 / 新会话 / 删除当前会话时） */
      const abortActive = () => {
        activeController?.abort();
        activeController = null;
      };

      /** 把挂起待确认的调用整体按"已跳过"落 tool 结果（新消息 / 切会话 / 删除前善后） */
      const finalizePendingAsSkipped = () => {
        const st = get();
        if (st.phase !== 'awaiting_confirm' || !pendingTurn || !st.pendingCallIds) return;
        const { sid } = pendingTurn;
        for (const cid of st.pendingCallIds) {
          const name = findToolRecord(get(), sid, cid)?.name ?? 'create_tasks';
          const oc: ToolExecOutcome = { tool: name, skipped: true, items: [] };
          pushMessageTo(sid, { role: 'tool', content: serializeOutcome(oc), toolCallId: cid, name, outcome: oc });
        }
        pendingTurn = null;
        set({ phase: 'idle', pendingCallIds: null });
      };

      /**
       * 回合主循环：流式请求 → 无工具调用即结束；有则只读立即执行、写类挂起等确认。
       * 每次调用（send / resume）建独立 controller，沿用 isCurrent 防顶写。
       */
      const runTurns = async (
        sid: string,
        system: string,
        startRound: number,
      ): Promise<void> => {
        const { baseUrl, apiKey, model, toolsEnabled } = useAiConfigStore.getState();
        let round = startRound;

        for (;;) {
          abortActive();
          const controller = new AbortController();
          activeController = controller;
          const isCurrent = () => activeController === controller;

          const tools: AiToolDef[] | undefined =
            toolsEnabled && !toolsFallback && round < MAX_TOOL_ROUNDS ? CORGI_TOOLS : undefined;

          // rAF 合帧：每帧最多一次 set，避免逐 chunk 重渲卡顿
          let raf = 0;
          let acc = '';
          const flush = () => {
            raf = 0;
            if (isCurrent()) set({ streamingText: acc });
          };

          let result: Awaited<ReturnType<typeof streamChat>> | null = null;
          let failure: Error | null = null;
          try {
            result = await streamChat(
              { baseUrl, apiKey, model, messages: buildWireMessages(system, get(), sid), tools },
              {
                signal: controller.signal,
                onDelta: (s) => {
                  acc += s;
                  if (!raf) raf = requestAnimationFrame(flush);
                },
              },
            );
          } catch (e) {
            failure = e as Error;
          }
          if (raf) cancelAnimationFrame(raf);
          if (!isCurrent()) return;

          if (!result) {
            const aborted = controller.signal.aborted;
            // 上游不支持 tools（报错提及 tool/function）→ 本回合降级重试一次
            if (tools && !toolsFallback && /tool|function/i.test(failure?.message ?? '')) {
              toolsFallback = true;
              continue; // 同一 round 重试（不带 tools）
            }
            // 中断：半截内容先落盘再报错
            if (acc) {
              pushMessageTo(sid, { role: 'assistant', content: acc });
              set({ streamingText: '', phase: 'idle', error: aborted ? '' : `回复中断：${failure?.message}` });
            } else {
              set({ streamingText: '', phase: 'idle', error: aborted ? '' : (failure?.message ?? '请求失败') });
            }
            return;
          }

          const records = parseToolCalls(result.toolCalls);
          if (!records.length) {
            // 普通回复：结束
            if (result.content) pushMessageTo(sid, { role: 'assistant', content: result.content });
            set({ streamingText: '', phase: 'idle' });
            return;
          }

          // 有工具调用：前置文本独立成气泡，再落工具调用记录（立即持久化）
          if (result.content) pushMessageTo(sid, { role: 'assistant', content: result.content });
          pushMessageTo(sid, { role: 'assistant', content: '', toolCalls: records });

          const writers: ToolCallRecord[] = [];
          for (const rec of records) {
            // 坏调用（解析失败 / 未知工具 / 空条目）与只读调用：立即落结果，不进确认卡
            const bad = rec.parseError != null || describeCall(rec) === null;
            if (bad || isReadonlyTool(rec.name)) {
              const oc: ToolExecOutcome = bad
                ? {
                    tool: rec.name,
                    items: [],
                    error: rec.parseError ?? '工具参数为空或格式不符',
                  }
                : await executeToolCall(rec);
              pushMessageTo(sid, {
                role: 'tool',
                content: serializeOutcome(oc),
                toolCallId: rec.id,
                name: rec.name,
                outcome: oc,
              });
            } else {
              writers.push(rec);
            }
          }

          if (!writers.length) {
            // 只读/坏调用已处理：继续下一轮（模型收结果后总结）
            round += 1;
            set({ streamingText: '', phase: 'summarizing' });
            continue;
          }

          // 写类调用：挂起等确认（回合上下文存模块级，resume 继续）
          pendingTurn = { sid, system, round };
          set({ streamingText: '', phase: 'awaiting_confirm', pendingCallIds: writers.map((w) => w.id) });
          return;
        }
      };

      return {
        sessions: [],
        activeSessionId: '',
        open: false,
        width: CORGI_DEFAULT_WIDTH,
        streamingText: '',
        phase: 'idle',
        pendingCallIds: null,
        error: '',

        newSession: () => {
          finalizePendingAsSkipped();
          abortActive();
          set({ activeSessionId: '', streamingText: '', phase: 'idle', pendingCallIds: null, error: '' });
        },
        switchSession: (id) => {
          if (id === get().activeSessionId) return;
          finalizePendingAsSkipped();
          abortActive();
          set({ activeSessionId: id, streamingText: '', phase: 'idle', pendingCallIds: null, error: '' });
        },
        deleteSession: (id) => {
          if (get().activeSessionId === id) {
            finalizePendingAsSkipped();
            abortActive();
          }
          set((s) => {
            const sessions = s.sessions.filter((x) => x.id !== id);
            const wasActive = s.activeSessionId === id;
            return {
              sessions,
              // 删的是当前会话 → 切到最近更新的，列表空了则回到新空会话
              activeSessionId: wasActive
                ? sessions.length
                  ? sessions[sessions.length - 1].id
                  : ''
                : s.activeSessionId,
              ...(wasActive ? { streamingText: '', phase: 'idle' as ChatPhase, pendingCallIds: null, error: '' } : {}),
            };
          });
        },
        setOpen: (v) => set({ open: v }),
        setWidth: (v) =>
          set({
            width: Math.min(CORGI_MAX_WIDTH, Math.max(CORGI_MIN_WIDTH, Math.round(v))),
          }),

        send: async (text, opts) => {
          const content = text.trim();
          if (!content) return;
          const st = get();
          if (st.phase === 'streaming' || st.phase === 'summarizing') return; // 忙
          // 待确认中发新消息：挂起调用按跳过善后，进入新回合
          finalizePendingAsSkipped();

          const { baseUrl, apiKey, model, systemPrompt, todayContext, toolsEnabled } =
            useAiConfigStore.getState();
          if (!baseUrl || !apiKey || !model) {
            set({ error: '请先在 ⚙ 设置中配置 AI 接口' });
            return;
          }

          // 本回合的落点会话：空会话则预生成 id（中途切换会话，回复仍落原会话不丢内容）
          const sid = get().activeSessionId || crypto.randomUUID();
          pushMessageTo(sid, { role: 'user', content });
          toolsFallback = false;
          set({ streamingText: '', phase: 'streaming', pendingCallIds: null, error: '' });

          // system：人格 +（可选）今日快照 +（可选）工具守则
          let system = systemPrompt || '你是柯基，温暖的陪伴助手。';
          if (todayContext || opts?.forceTodayContext) {
            const snapshot = await buildTodaySnapshot();
            if (snapshot) system += `\n\n---\n\n${snapshot}`;
          }
          if (toolsEnabled) system += `\n\n---\n\n${CORGI_TOOLS_HINT}`;

          await runTurns(sid, system, 0);
        },

        resumeWithToolResults: async (outcomes) => {
          const st = get();
          if (st.phase !== 'awaiting_confirm' || !pendingTurn || !st.pendingCallIds) return; // 幂等保护
          const { sid, system, round } = pendingTurn;
          if (st.pendingCallIds.length !== outcomes.length) return; // 对不上就拒绝，防错位
          st.pendingCallIds.forEach((cid, i) => {
            const oc = outcomes[i];
            pushMessageTo(sid, { role: 'tool', content: serializeOutcome(oc), toolCallId: cid, name: oc.tool, outcome: oc });
          });
          pendingTurn = null;
          set({ phase: 'summarizing', pendingCallIds: null, streamingText: '' });
          await runTurns(sid, system, round + 1);
        },
      };
    },
    {
      name: 'dashboard-corgi-chat',
      version: 1,
      // v0 → v1：扁平 messages → 多会话结构。旧数据必带 version:0（zustand 落盘默认写 0）
      migrate: (persisted) => {
        const s = persisted as {
          messages?: { role: 'user' | 'assistant'; content: string }[];
          open?: boolean;
          width?: number;
        };
        const now = Date.now();
        const msgs: ChatMessage[] = Array.isArray(s.messages) ? (s.messages as ChatMessage[]) : [];
        if (!msgs.length) {
          return { sessions: [], activeSessionId: '', open: s.open ?? false, width: s.width ?? CORGI_DEFAULT_WIDTH };
        }
        const id = crypto.randomUUID();
        const firstUser = msgs.find((m) => m.role === 'user');
        return {
          sessions: [
            {
              id,
              title: firstUser ? makeTitle(firstUser.content) : '历史对话',
              messages: msgs,
              createdAt: now,
              updatedAt: now,
            },
          ],
          activeSessionId: id,
          open: s.open ?? false,
          width: s.width ?? CORGI_DEFAULT_WIDTH,
        };
      },
      // 流式临时态 / 阶段 / 错误不持久化（正在确认的 toolCalls 已随 assistant 消息落盘，
      // 刷新后 pendingCallIds 丢失 → 确认卡呈失效态，继续对话由 buildWireMessages 补 skipped）
      partialize: (s) => ({
        sessions: s.sessions,
        activeSessionId: s.activeSessionId,
        open: s.open,
        width: s.width,
      }),
    },
  ),
);
