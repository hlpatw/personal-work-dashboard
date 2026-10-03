import { useState } from 'react';
import { NavLink } from 'react-router';
import { useThemeStore } from '../stores/theme';
import { useProfileStore } from '../stores/profile';
import { formatCN } from '../lib/date';
import Modal from './Modal';
import {
  IconCalendar,
  IconDashboard,
  IconSpark,
  IconStats,
  IconTarget,
  IconTasks,
} from './icons';

const NAV_ITEMS = [
  { to: '/', label: '概览', icon: IconDashboard, end: true },
  { to: '/tasks', label: '任务', icon: IconTasks, end: false },
  { to: '/calendar', label: '日历', icon: IconCalendar, end: false },
  { to: '/inspirations', label: '此刻灵感', icon: IconSpark, end: false },
  { to: '/goals', label: '目标', icon: IconTarget, end: false },
  { to: '/stats', label: '统计', icon: IconStats, end: false },
];

const inputCls =
  'w-full rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:ring-2 focus:ring-rose-400/30 dark:bg-[#1f1f24] dark:text-zinc-100';

export default function Sidebar() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const nickname = useProfileStore((s) => s.nickname);
  const motto = useProfileStore((s) => s.motto);
  const setProfile = useProfileStore((s) => s.setProfile);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(nickname);
  const [mottoDraft, setMottoDraft] = useState(motto);

  const openEdit = () => {
    setNameDraft(nickname);
    setMottoDraft(motto);
    setEditing(true);
  };

  const save = () => {
    setProfile(nameDraft.trim() || '我', mottoDraft.trim());
    setEditing(false);
  };

  return (
    <aside className="flex h-screen w-16 flex-col items-center gap-1 border-r border-black/[0.06] bg-[#f2f2f4] py-4 dark:border-white/[0.05] dark:bg-[#0a0a0c] md:w-56 md:items-stretch md:px-3">
      {/* 个人区 */}
      <button
        onClick={openEdit}
        className="mb-4 flex items-center justify-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] md:justify-start"
        title="编辑个人信息"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-sm font-semibold text-rose-500 dark:text-rose-400">
          {nickname.slice(0, 1)}
        </span>
        <span className="hidden min-w-0 flex-col items-start md:flex">
          <span className="w-full truncate text-sm font-medium">{nickname}</span>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500">点击编辑</span>
        </span>
      </button>

      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors md:justify-start ${
                isActive
                  ? 'bg-black/[0.06] font-medium text-zinc-900 dark:bg-white/[0.07] dark:text-white'
                  : 'text-zinc-500 hover:bg-black/[0.035] hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-100'
              }`
            }
            title={item.label}
          >
            <item.icon className="h-[17px] w-[17px] shrink-0" />
            <span className="hidden md:inline">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* 座右铭 + 日期：点击可编辑 */}
      <button
        onClick={openEdit}
        className="group mb-2 hidden w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.04] md:flex"
        title="编辑昵称与座右铭"
      >
        <span className="w-full truncate text-xs text-zinc-500 dark:text-zinc-400">「{motto}」</span>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {formatCN(new Date(), 'yyyy年M月d日 EEEE')}
        </span>
      </button>

      <button
        onClick={toggle}
        className="flex items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500 transition-colors hover:bg-black/[0.035] dark:text-zinc-400 dark:hover:bg-white/[0.04]"
        title="切换主题"
      >
        <span className="text-base">{theme === 'dark' ? '☀' : '☾'}</span>
        <span className="hidden md:inline">{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
      </button>

      {/* 作者署名 */}
      <p className="mt-1 hidden select-none text-center text-[10px] tracking-wide text-zinc-400/70 dark:text-zinc-600 md:block">
        Made by Kexuan
      </p>

      {editing && (
        <Modal title="个人信息" onClose={() => setEditing(false)}>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500">昵称</label>
              <input
                autoFocus
                className={inputCls}
                value={nameDraft}
                maxLength={12}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="展示在侧栏的名字"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-500">座右铭</label>
              <input
                className={inputCls}
                value={mottoDraft}
                maxLength={30}
                onChange={(e) => setMottoDraft(e.target.value)}
                placeholder="展示在侧栏底部的一句话"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg px-3.5 py-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-[#26262b] dark:hover:text-zinc-200"
              >
                取消
              </button>
              <button
                onClick={save}
                className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-400"
              >
                保存
              </button>
            </div>
          </div>
        </Modal>
      )}
    </aside>
  );
}
