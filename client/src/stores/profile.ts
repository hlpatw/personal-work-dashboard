import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProfileState {
  nickname: string;
  motto: string;
  setProfile: (nickname: string, motto: string) => void;
}

export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      nickname: '我',
      motto: '认真生活，慢慢生长',
      setProfile: (nickname, motto) => set({ nickname, motto }),
    }),
    {
      name: 'dashboard-profile',
      version: 1,
      migrate: (persisted) => {
        // v0 → v1：座右铭默认值换代。按值判断（旧数据无 version 字段，
        // 传参可能是 undefined），只迁移"从未改过的旧默认"，自定义的保留
        const state = persisted as Partial<ProfileState>;
        if (state.motto === '专注当下，日拱一卒') {
          state.motto = '认真生活，慢慢生长';
        }
        return state as ProfileState;
      },
    }
  )
);
