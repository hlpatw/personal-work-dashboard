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
      motto: '专注当下，日拱一卒',
      setProfile: (nickname, motto) => set({ nickname, motto }),
    }),
    { name: 'dashboard-profile' }
  )
);
