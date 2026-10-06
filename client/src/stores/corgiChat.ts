import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CorgiChatState {
  messages: ChatMessage[];
  /** 侧栏展开状态（独立于聊天内容持久化） */
  open: boolean;
  addMessage: (m: ChatMessage) => void;
  clearChat: () => void;
  setOpen: (v: boolean) => void;
}

export const useCorgiChatStore = create<CorgiChatState>()(
  persist(
    (set) => ({
      messages: [],
      open: false,
      addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
      clearChat: () => set({ messages: [] }),
      setOpen: (v) => set({ open: v }),
    }),
    { name: 'dashboard-corgi-chat' }
  )
);
