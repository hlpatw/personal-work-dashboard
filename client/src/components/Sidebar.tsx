import { useState } from 'react';
import { NavLink } from 'react-router';
import { useThemeStore } from '../stores/theme';
import { useProfileStore } from '../stores/profile';
import { formatCN } from '../lib/date';
import Modal from './Modal';

const NAV_ITEMS = [
  { to: '/', label: '概览', icon: '◈', end: true },
  { to: '/tasks', label: '任务', icon: '☑', end: false },
  { to: '/calendar', label: '日历', icon: '▤', end: false },
  { to: '/stats', label: '统计', icon: '◐', end: false },
];

const inputCls =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-rose-500 dark:border-stone-700 dark:bg-stone-800';

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
    <aside className="flex h-screen w-16 flex-col items-center gap-1 border-r border-stone-200/70 bg-white/70 py-4 backdrop-blur-xl dark:border-white/[0.06] dark:bg-stone-900/70 md:w-56 md:items-stretch md:px-3">
      {/* 个人区 */}
      <button
        onClick={openEdit}
        className="mb-4 flex items-center justify-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800 md:justify-start"
        title="编辑个人信息"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-pink-400 text-sm font-semibold text-white shadow-sm">
          {nickname.slice(0, 1)}
        </span>
        <span className="hidden min-w-0 flex-col items-start md:flex">
          <span className="w-full truncate text-sm font-semibold">{nickname}</span>
          <span className="text-[10px] text-stone-400 dark:text-stone-500">点击编辑</span>
        </span>
      </button>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center justify-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors md:justify-start ${
                isActive
                  ? 'bg-rose-50 font-medium text-rose-600 dark:bg-rose-500/15 dark:text-rose-300'
                  : 'text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800'
              }`
            }
            title={item.label}
          >
            <span className="text-base">{item.icon}</span>
            <span className="hidden md:inline">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* 座右铭 + 日期 */}
      <div className="mb-2 hidden w-full flex-col items-start gap-0.5 rounded-xl bg-stone-50 px-3 py-2.5 dark:bg-stone-800/60 md:flex">
        <p className="w-full truncate text-xs italic text-stone-600 dark:text-stone-300" title={motto}>
          「{motto}」
        </p>
        <p className="text-[10px] text-stone-500 dark:text-stone-400">{formatCN(new Date(), 'yyyy年M月d日 EEEE')}</p>
      </div>

      <button
        onClick={toggle}
        className="flex items-center justify-center gap-3 rounded-xl px-3 py-2 text-sm text-stone-600 transition-colors hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
        title="切换主题"
      >
        <span className="text-base">{theme === 'dark' ? '☀' : '☾'}</span>
        <span className="hidden md:inline">{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
      </button>

      {editing && (
        <Modal title="个人信息" onClose={() => setEditing(false)}>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-stone-500">昵称</label>
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
              <label className="mb-1 block text-xs font-medium text-stone-500">座右铭</label>
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
                className="rounded-lg px-4 py-2 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
              >
                取消
              </button>
              <button
                onClick={save}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500"
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
