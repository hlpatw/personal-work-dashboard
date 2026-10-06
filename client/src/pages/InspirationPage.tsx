import { useState, type KeyboardEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchInspirations, createInspiration, updateInspiration, deleteInspiration } from '../api/inspirations';
import {
  INSPIRATION_CATEGORIES,
  INSPIRATION_CATEGORY_META,
  type Inspiration,
  type InspirationCategory,
  type InspirationInput,
} from '../api/types';
import { relativeTime } from '../lib/date';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';
import TaskFormDialog from '../components/TaskFormDialog';
import ImageInput from '../components/ImageInput';
import Lightbox from '../components/Lightbox';
import { IconPencil, IconTrash } from '../components/icons';

const selectCls =
  'rounded-lg bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 outline-none transition-colors hover:bg-zinc-200/70 dark:bg-[#1f1f24] dark:text-zinc-200 dark:hover:bg-[#26262b]';

export default function InspirationPage() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [draft, setDraft] = useState('');
  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [draftCategory, setDraftCategory] = useState<InspirationCategory>('灵感');
  const [converting, setConverting] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const { data: list, isLoading, isError, error } = useQuery({
    queryKey: ['inspirations', { q, category }],
    queryFn: () => fetchInspirations({ q, category }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['inspirations'] });

  const createMutation = useMutation({
    mutationFn: createInspiration,
    onSuccess: () => {
      invalidate();
      setDraft('');
      setDraftImage(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteInspiration(id),
    onSuccess: invalidate,
  });

  const submitDraft = () => {
    const content = draft.trim();
    if (!content && !draftImage) return;
    // 纯图无文字时给个占位，满足后端 content 非空约束
    createMutation.mutate({ content: content || '（图片）', category: draftCategory, image_url: draftImage });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitDraft();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="此刻灵感"
        subtitle={list ? `已捕捉 ${list.length} 条` : '…'}
        actions={
          <>
            <input
              className={`${selectCls} w-40`}
              placeholder="搜索灵感…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className={selectCls}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">全部类型</option>
              {INSPIRATION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </>
        }
      />

      {/* 常驻快速输入：随手记的核心（📎 贴图 / Ctrl+V 粘贴截图） */}
      <Card className="p-3">
        <div className="flex gap-2">
          <ImageInput value={draftImage} onChange={setDraftImage} />
          <input
            className="flex-1 rounded-lg bg-zinc-100 px-3.5 py-2.5 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:ring-2 focus:ring-rose-400/30 dark:bg-[#1f1f24] dark:text-zinc-100"
            placeholder="迸发了什么想法？记下来…（可 Ctrl+V 粘贴截图）"
            value={draft}
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
          />
          <select
            className={`${selectCls} shrink-0`}
            value={draftCategory}
            onChange={(e) => setDraftCategory(e.target.value as InspirationCategory)}
          >
            {INSPIRATION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            onClick={submitDraft}
            disabled={(!draft.trim() && !draftImage) || createMutation.isPending}
            className="shrink-0 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 disabled:opacity-50"
          >
            记下
          </button>
        </div>
      </Card>

      {/* 时间流 */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-zinc-400">加载中…</div>
      ) : isError ? (
        <div className="py-12 text-center text-sm text-red-500">{(error as Error).message}</div>
      ) : !list || list.length === 0 ? (
        <Card className="p-0">
          <EmptyState text={q || category ? '没有符合条件的灵感' : '还没有记录，抓住第一个迸发的瞬间'} />
        </Card>
      ) : (
        <div className="space-y-2">
          {list.map((item) => (
            <InspirationCard
              key={item.id}
              item={item}
              onDelete={() => {
                if (window.confirm('删除这条灵感？')) deleteMutation.mutate(item.id);
              }}
              onConvert={() => setConverting(item.content === '（图片）' ? '' : item.content)}
              onViewImage={(src) => setLightbox(src)}
            />
          ))}
        </div>
      )}

      {converting !== null && (
        <TaskFormDialog task={null} initialTitle={converting} onClose={() => setConverting(null)} />
      )}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function InspirationCard({
  item,
  onDelete,
  onConvert,
  onViewImage,
}: {
  item: Inspiration;
  onDelete: () => void;
  onConvert: () => void;
  onViewImage: (src: string) => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const [draftImage, setDraftImage] = useState<string | null>(item.image_url);
  const [draftCategory, setDraftCategory] = useState<InspirationCategory>(item.category);

  const updateMutation = useMutation({
    mutationFn: (input: InspirationInput) => updateInspiration(item.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspirations'] });
      setEditing(false);
    },
  });

  const startEdit = () => {
    setDraft(item.content);
    setDraftImage(item.image_url);
    setDraftCategory(item.category);
    setEditing(true);
  };

  const save = () => {
    const content = draft.trim();
    if (!content && !draftImage) return;
    updateMutation.mutate({
      content: content || '（图片）',
      category: draftCategory,
      image_url: draftImage,
    });
  };

  if (editing) {
    return (
      <Card className="p-4 ring-1 ring-rose-500/30">
        <div className="space-y-2.5">
          <ImageInput value={draftImage} onChange={setDraftImage} />
          <textarea
            className="w-full rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-800 outline-none transition-colors placeholder:text-zinc-400 focus:ring-2 focus:ring-rose-400/30 dark:bg-[#1f1f24] dark:text-zinc-100"
            value={draft}
            maxLength={500}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <div className="flex items-center justify-between gap-2">
            <select
              className="rounded-lg bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 outline-none dark:bg-[#1f1f24] dark:text-zinc-200"
              value={draftCategory}
              onChange={(e) => setDraftCategory(e.target.value as InspirationCategory)}
            >
              {INSPIRATION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-[#26262b] dark:hover:text-zinc-200"
              >
                取消
              </button>
              <button
                onClick={save}
                disabled={(!draft.trim() && !draftImage) || updateMutation.isPending}
                className="rounded-lg bg-rose-500 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-400 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="group p-4 transition-all group-hover:shadow-lg group-hover:shadow-black/[0.06] dark:group-hover:shadow-black/40">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.content}</p>
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={startEdit}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-[#26262b] dark:hover:text-zinc-200"
            title="编辑"
          >
            <IconPencil />
          </button>
          <button
            onClick={onConvert}
            className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-rose-500/10 hover:text-rose-500 dark:text-zinc-400 dark:hover:text-rose-400"
            title="转为任务"
          >
            → 转任务
          </button>
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-red-500/10 hover:text-red-400 dark:hover:bg-red-500/15"
            title="删除"
          >
            <IconTrash />
          </button>
        </div>
      </div>
      {item.image_url && (
        <img
          src={item.image_url}
          alt="灵感配图"
          className="mt-2.5 max-h-48 cursor-zoom-in rounded-lg object-cover ring-1 ring-black/[0.05] transition-opacity hover:opacity-90 dark:ring-white/[0.07]"
          onClick={() => onViewImage(item.image_url!)}
        />
      )}
      <div className="mt-2.5 flex items-center gap-2 text-xs">
        <span className={`rounded-md px-1.5 py-0.5 ${INSPIRATION_CATEGORY_META[item.category]}`}>
          {item.category}
        </span>
        <span className="text-zinc-400 dark:text-zinc-500">{relativeTime(item.created_at)}</span>
        {item.updated_at && (
          <span className="text-zinc-400/70 dark:text-zinc-600" title={`编辑于 ${item.updated_at}`}>
            · 已编辑
          </span>
        )}
      </div>
    </Card>
  );
}
