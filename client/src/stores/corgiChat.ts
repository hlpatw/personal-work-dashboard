import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { streamChat, type AiChatMessage } from '../api/ai';
import { useAiConfigStore } from './aiConfig';
import { buildTodaySnapshot } from '../lib/corgiContext';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SendOpts {
  /** 该次发送强制附带今日快照（快捷指令用），不受开关约束 */
  forceTodayContext?: boolean;
}

interface CorgiChatState {
  messages: ChatMessage[];
  /** 侧栏展开状态（独立于聊天内容持久化） */
  open: boolean;
  /** 流式过程中的临时全文（非持久化，避免逐 chunk 写 localStorage） */
  streamingText: string;
  sending: boolean;
  error: string;
  addMessage: (m: ChatMessage) => void;
  clearChat: () => void;
  setOpen: (v: boolean) => void;
  /** 发送并流式接收回复；结束才把 assistant 消息写入持久化的 messages */
  send: (text: string, opts?: SendOpts) => Promise<void>;
}

/** 进行中的请求（新对话 / 重发时 abort 掉旧的，防止旧流写脏新状态） */
let activeController: AbortController | null = null;

export const useCorgiChatStore = create<CorgiChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      open: false,
      streamingText: '',
      sending: false,
      error: '',
      addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
      clearChat: () => {
        activeController?.abort();
        activeController = null;
        set({ messages: [], streamingText: '', sending: false, error: '' });
      },
      setOpen: (v) => set({ open: v }),

      send: async (text, opts) => {
        const content = text.trim();
        if (!content || get().sending) return;
        const { baseUrl, apiKey, model, systemPrompt, todayContext } = useAiConfigStore.getState();
        if (!baseUrl || !apiKey || !model) {
          set({ error: '请先在 ⚙ 设置中配置 AI 接口' });
          return;
        }

        activeController?.abort();
        const controller = new AbortController();
        activeController = controller;
        // 该请求是否仍是"当前"请求（被新请求顶掉后不得再碰状态）
        const isCurrent = () => activeController === controller;

        set((s) => ({
          messages: [...s.messages, { role: 'user', content }],
          streamingText: '',
          sending: true,
          error: '',
        }));

        // 今日快照：开关开启，或该次发送显式要求
        let system = systemPrompt || '你是柯基，温暖的陪伴助手。';
        if (todayContext || opts?.forceTodayContext) {
          const snapshot = await buildTodaySnapshot();
          if (snapshot) system += `\n\n---\n\n${snapshot}`;
        }

        const history: AiChatMessage[] = [
          { role: 'system', content: system },
          ...get().messages,
        ];

        // rAF 合帧：每帧最多一次 set，避免逐 chunk 重渲卡顿
        let raf = 0;
        let acc = '';
        const flush = () => {
          raf = 0;
          if (isCurrent()) set({ streamingText: acc });
        };

        try {
          const { content: reply } = await streamChat({ baseUrl, apiKey, model, messages: history }, {
            signal: controller.signal,
            onDelta: (s) => {
              acc += s;
              if (!raf) raf = requestAnimationFrame(flush);
            },
          });
          if (!isCurrent()) return;
          set((s) => ({
            messages: [...s.messages, { role: 'assistant', content: reply }],
            streamingText: '',
            sending: false,
          }));
        } catch (e) {
          if (!isCurrent()) return;
          if (raf) cancelAnimationFrame(raf);
          // acc 恒 ≥ 已落 store 的 streamingText；中断时若有半截内容先落盘再报错
          const aborted = controller.signal.aborted;
          if (acc) {
            set((s) => ({
              messages: [...s.messages, { role: 'assistant', content: acc }],
              streamingText: '',
              sending: false,
              error: aborted ? '' : `回复中断：${(e as Error).message}`,
            }));
          } else {
            set({
              streamingText: '',
              sending: false,
              error: aborted ? '' : (e as Error).message,
            });
          }
        } finally {
          if (raf) cancelAnimationFrame(raf);
          if (isCurrent()) activeController = null;
        }
      },
    }),
    {
      name: 'dashboard-corgi-chat',
      // 流式临时态与错误不持久化
      partialize: (s) => ({ messages: s.messages, open: s.open }),
    }
  )
);
