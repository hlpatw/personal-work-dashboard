import type { ReactNode } from 'react';

/** 玻璃卡片：半透明底 + 12px 背景模糊 + 发丝边框 + 上缘高光 + 双层投影 */
export default function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[14px] border border-black/[0.07] bg-white/[0.72] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(24,24,34,0.04),0_12px_30px_-18px_rgba(24,24,34,0.22)] backdrop-blur-[12px] backdrop-saturate-150 transition-[box-shadow,transform] duration-150 dark:border-white/[0.07] dark:bg-white/[0.035] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_1px_0_rgba(0,0,0,0.35),0_16px_40px_-22px_rgba(0,0,0,0.95)] ${className}`}
    >
      {children}
    </div>
  );
}
