import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { rows, row, run, todayStr, type Db } from '../db.js';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES, type Task, type Subtask } from '../types.js';

const taskSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空'),
  description: z.string().trim().optional().default(''),
  category: z.enum(TASK_CATEGORIES).optional().default('工作'),
  priority: z.enum(TASK_PRIORITIES).optional().default('medium'),
  status: z.enum(TASK_STATUSES).optional().default('todo'),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '截止日期格式应为 YYYY-MM-DD')
    .nullable()
    .optional()
    .default(null),
  estimated_minutes: z
    .number()
    .int('预计时长需为整数分钟')
    .min(0, '预计时长不能为负')
    .max(100000, '预计时长过大')
    .nullable()
    .optional()
    .default(null),
  tags: z
    .array(z.string().trim().min(1).max(20))
    .max(8, '标签最多 8 个')
    .optional()
    .default([]),
  goal_id: z.number().int().nullable().optional().default(null),
  // Base64 Data URL（前端已压缩；2M 字符上限约对应 1.5MB 原图）
  image_url: z
    .string()
    .startsWith('data:image/', '图片格式应为 data:image/ 开头的 Base64')
    .max(2_000_000, '图片过大，请压缩后重试')
    .nullable()
    .optional()
    .default(null),
  subtasks: z
    .array(
      z.object({
        title: z.string().trim().min(1, '子任务标题不能为空').max(200),
        done: z.boolean().optional().default(false),
      })
    )
    .max(50)
    .optional()
    .default([]),
});

const statusSchema = z.object({
  status: z.enum(TASK_STATUSES),
});

// 排序权重：状态 todo → in_progress → done，再按优先级、截止日
const STATUS_ORDER = "CASE status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END";
const PRIORITY_ORDER =
  "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END";

/** 行 → Task（解析 tags JSON） */
function toTask(r: Record<string, unknown>): Task {
  return {
    ...(r as unknown as Task),
    tags: JSON.parse((r.tags as string) ?? '[]') as string[],
    subtask_total: Number(r.subtask_total ?? 0),
    subtask_done: Number(r.subtask_done ?? 0),
  };
}

const TASK_SELECT = `
  SELECT t.*,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id) AS subtask_total,
    (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.id AND s.done = 1) AS subtask_done
  FROM tasks t`;

export default function taskRoutes(db: Db): Router {
  const router = Router();

  /** 写入任务的子任务（replace-all 语义） */
  const writeSubtasks = (taskId: number, list: { title: string; done: boolean }[]) => {
    run(db, 'DELETE FROM subtasks WHERE task_id = ?', taskId);
    list.forEach((s, i) => {
      run(db, 'INSERT INTO subtasks (task_id, title, done, sort_order) VALUES (?, ?, ?, ?)', taskId, s.title, s.done ? 1 : 0, i);
    });
  };

  const getTask = (id: number, userId: number): Task | undefined => {
    const r = row<Record<string, unknown>>(
      db,
      `${TASK_SELECT} WHERE t.id = ? AND t.user_id = ?`,
      id,
      userId
    );
    return r ? toTask(r) : undefined;
  };

  // 列表 + 筛选
  router.get('/', (req: Request, res: Response) => {
    const where: string[] = ['t.user_id = ?'];
    const params: (string | number)[] = [req.userId!];

    const { status, category, priority, dueFrom, dueTo, q, tag, goalId, overdue } = req.query;
    if (status && typeof status === 'string') {
      where.push('t.status = ?');
      params.push(status);
    }
    if (category && typeof category === 'string') {
      where.push('t.category = ?');
      params.push(category);
    }
    if (priority && typeof priority === 'string') {
      where.push('t.priority = ?');
      params.push(priority);
    }
    if (dueFrom && typeof dueFrom === 'string') {
      where.push('t.due_date IS NOT NULL AND t.due_date >= ?');
      params.push(dueFrom);
    }
    if (dueTo && typeof dueTo === 'string') {
      where.push('t.due_date IS NOT NULL AND t.due_date <= ?');
      params.push(dueTo);
    }
    if (q && typeof q === 'string') {
      where.push('(t.title LIKE ? OR t.description LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (tag && typeof tag === 'string') {
      where.push('t.tags LIKE ?');
      params.push(`%"${tag}"%`);
    }
    if (goalId && typeof goalId === 'string') {
      where.push('t.goal_id = ?');
      params.push(Number(goalId));
    }
    if (overdue === '1') {
      where.push("t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < ?");
      params.push(todayStr());
    }

    const sql = `
      ${TASK_SELECT}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${STATUS_ORDER.replace(/status/g, 't.status').replace(/priority/g, 't.priority')}, ${PRIORITY_ORDER.replace(/priority/g, 't.priority')},
               t.due_date IS NULL, t.due_date ASC, t.id DESC`;
    res.json(rows<Record<string, unknown>>(db, sql, ...params).map(toTask));
  });

  // 新建
  router.post('/', (req: Request, res: Response) => {
    const input = taskSchema.parse(req.body);
    const result = run(
      db,
      `INSERT INTO tasks (title, description, category, priority, status, due_date, estimated_minutes, tags, goal_id, image_url, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.title,
      input.description,
      input.category,
      input.priority,
      input.status,
      input.due_date,
      input.estimated_minutes,
      JSON.stringify(input.tags),
      input.goal_id,
      input.image_url,
      req.userId!
    );
    const id = Number(result.lastInsertRowid);
    writeSubtasks(id, input.subtasks);
    res.status(201).json(getTask(id, req.userId!));
  });

  // 详情
  router.get('/:id', (req: Request, res: Response) => {
    const found = getTask(Number(req.params.id), req.userId!);
    if (!found) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    res.json(found);
  });

  // 全量更新（子任务为整体替换）
  router.put('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!getTask(id, req.userId!)) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    const input = taskSchema.parse(req.body);
    run(
      db,
      `UPDATE tasks SET title = ?, description = ?, category = ?, priority = ?, status = ?,
        due_date = ?, estimated_minutes = ?, tags = ?, goal_id = ?, image_url = ?,
        completed_at = CASE WHEN ? = 'done' THEN datetime('now','localtime') ELSE NULL END,
        updated_at = datetime('now','localtime')
       WHERE id = ? AND user_id = ?`,
      input.title,
      input.description,
      input.category,
      input.priority,
      input.status,
      input.due_date,
      input.estimated_minutes,
      JSON.stringify(input.tags),
      input.goal_id,
      input.image_url,
      input.status,
      id,
      req.userId!
    );
    writeSubtasks(id, input.subtasks);
    res.json(getTask(id, req.userId!));
  });

  // 只改状态：维护 completed_at
  router.patch('/:id/status', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!getTask(id, req.userId!)) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    const { status } = statusSchema.parse(req.body);
    run(
      db,
      `UPDATE tasks SET status = ?,
        completed_at = CASE WHEN ? = 'done' THEN datetime('now','localtime') ELSE NULL END,
        updated_at = datetime('now','localtime')
       WHERE id = ? AND user_id = ?`,
      status,
      status,
      id,
      req.userId!
    );
    res.json(getTask(id, req.userId!));
  });

  // 子任务列表（任务详情用）
  router.get('/:id/subtasks', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!getTask(id, req.userId!)) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    res.json(
      rows<Subtask>(db, 'SELECT * FROM subtasks WHERE task_id = ? ORDER BY sort_order ASC, id ASC', id).map(
        (s) => ({ ...s, done: !!s.done })
      )
    );
  });

  // 删除
  router.delete('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const result = run(db, 'DELETE FROM tasks WHERE id = ? AND user_id = ?', id, req.userId!);
    if (result.changes === 0) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    res.status(204).send();
  });

  return router;
}
