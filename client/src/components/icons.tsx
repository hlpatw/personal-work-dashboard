/** 统一的线性描边图标（stroke 风格，随 currentColor 着色） */
import type { ReactNode } from 'react';

interface IconProps {
  className?: string;
}

function base(className: string, children: ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 概览：四宫格 */
export function IconDashboard({ className = 'h-[18px] w-[18px]' }: IconProps) {
  return base(
    className,
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  );
}

/** 任务：勾选框 */
export function IconTasks({ className = 'h-[18px] w-[18px]' }: IconProps) {
  return base(
    className,
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M8 12.2l2.8 2.8L16 9.5" />
    </>
  );
}

/** 日历 */
export function IconCalendar({ className = 'h-[18px] w-[18px]' }: IconProps) {
  return base(
    className,
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  );
}

/** 统计：柱状图 */
export function IconStats({ className = 'h-[18px] w-[18px]' }: IconProps) {
  return base(
    className,
    <>
      <path d="M5 20V13M12 20V5M19 20v-9" />
      <path d="M3 20.5h18" />
    </>
  );
}

/** 目标：靶心 */
export function IconTarget({ className = 'h-[18px] w-[18px]' }: IconProps) {
  return base(
    className,
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </>
  );
}

/** 此刻灵感：闪电火花 */
export function IconSpark({ className = 'h-[18px] w-[18px]' }: IconProps) {
  return base(
    className,
    <>
      <path d="M13 2.5L5 13.5h5.5L10 21.5l8-11h-5.5L13 2.5z" />
    </>
  );
}

/** 聊天气泡（柯基发送按钮） */
export function IconChat({ className = 'h-4 w-4' }: IconProps) {
  return base(
    className,
    <>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.4 0-2.8-.3-4-.9L3 21l1.9-5.5c-.6-1.2-.9-2.6-.9-4A8.5 8.5 0 0 1 12.5 3 8.5 8.5 0 0 1 21 11.5z" />
    </>
  );
}

/** 编辑：铅笔 */
export function IconPencil({ className = 'h-4 w-4' }: IconProps) {
  return base(
    className,
    <>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M13.5 6.5l3 3" />
    </>
  );
}

/** 删除：垃圾桶 */
export function IconTrash({ className = 'h-4 w-4' }: IconProps) {
  return base(
    className,
    <>
      <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  );
}

/** 时钟：预计时长 */
export function IconClock({ className = 'h-3.5 w-3.5' }: IconProps) {
  return base(
    className,
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  );
}

/** 地点：定位标 */
export function IconMapPin({ className = 'h-3.5 w-3.5' }: IconProps) {
  return base(
    className,
    <>
      <path d="M12 21s-6.5-5.3-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.7 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </>
  );
}
