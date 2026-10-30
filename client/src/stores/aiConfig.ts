import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 柯基默认人格：温暖陪伴型，可被用户在设置里覆盖 */
export const CORGI_DEFAULT_PROMPT =
  '你是柯基，一只温暖可爱的 AI 陪伴助手，住在你主人（用户）的旺达工作台里。' +
  '你性格活泼、真诚、善于倾听，说话亲切自然，偶尔可以用一两个表情符号表达情绪。' +
  '你的角色是陪伴与支持：听用户聊工作中的烦恼、帮着梳理想法、庆祝小成就，也可以回答各类问题。' +
  '回答保持简洁温暖，中文交流。';

export interface AiConfigState {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  /** 发送时向柯基附带今日任务与日程快照（默认开；persist 浅合并，旧数据自动取默认值） */
  todayContext: boolean;
  /** 柯基工具调用（建任务/查任务/完成/日程/灵感，默认开）；上游不支持时自动降级一次 */
  toolsEnabled: boolean;
  setConfig: (c: Partial<Omit<AiConfigState, 'setConfig'>>) => void;
}

export const useAiConfigStore = create<AiConfigState>()(
  persist(
    (set) => ({
      baseUrl: '',
      apiKey: '',
      model: '',
      systemPrompt: CORGI_DEFAULT_PROMPT,
      todayContext: true,
      toolsEnabled: true,
      setConfig: (c) => set(c),
    }),
    { name: 'dashboard-ai-config' }
  )
);
