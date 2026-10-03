import { useEffect, useRef, useState } from 'react';
import { compressImage, readImageFromPaste } from '../lib/image';

interface Props {
  /** 已选图的 Base64 Data URL；null = 未选 */
  value: string | null;
  onChange: (v: string | null) => void;
}

/** 贴图控件：📎 选文件 / 粘贴截图 / 预览与移除 */
export default function ImageInput({ value, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (file: File) => {
    setError('');
    setLoading(true);
    try {
      const dataUrl = await compressImage(file);
      onChange(dataUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 粘贴：挂 window（快速输入区的 input 无焦点时也能贴），有图才拦截默认行为
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const file = readImageFromPaste(e);
      if (file) {
        e.preventDefault();
        await load(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void load(file);
          e.target.value = ''; // 允许重复选同一文件
        }}
      />
      {value ? (
        <span className="group relative inline-block shrink-0">
          <img
            src={value}
            alt="已选图片"
            className="h-9 w-9 cursor-pointer rounded-lg object-cover ring-1 ring-black/[0.06] dark:ring-white/[0.08]"
            onClick={() => fileRef.current?.click()}
            title="点击更换图片"
          />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-zinc-800 text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100"
            aria-label="移除图片"
          >
            ✕
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading}
          title="贴一张图（也可直接 Ctrl+V 粘贴截图）"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-50 dark:hover:bg-[#26262b] dark:hover:text-zinc-200"
        >
          {loading ? <span className="animate-pulse text-sm">…</span> : '📎'}
        </button>
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}
