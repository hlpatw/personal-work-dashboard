import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { rows, row, run, todayStr, type Db } from '../db.js';
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_STATUSES, type Task } from '../types.js';

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
});

const statusSchema = z.object({
  status: z.enum(TASK_STATUSES),
});

// 排序权重：状态 todo → in_progress → done，再按优先级、截止日
const STATUS_ORDER = 'CASE status WHEN \'todo\' THEN 0 WHEN \'in_progress\' THEN 1 ELSE 2 END';
const PRIORITY_ORDER =
  "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END";

export default function taskRoutes(db: Db): Router {
  const router = Router();

  // 列表 + 筛选
  router.get('/', (req: Request, res: Response) => {
    const where: string[] = ['user_id = ?'];
    const params: (string | number)[] = [req.userId!];

    const { status, category, priority, dueFrom, dueTo, q, overdue } = req.query;
    if (status && typeof status === 'string') {
      where.push('status = ?');
      params.push(status);
    }
    if (category && typeof category === 'string') {
      where.push('category = ?');
      params.push(category);
    }
    if (priority && typeof priority === 'string') {
      where.push('priority = ?');
      params.push(priority);
    }
    if (dueFrom && typeof dueFrom === 'string') {
      where.push('due_date IS NOT NULL AND due_date >= ?');
      params.push(dueFrom);
    }
    if (dueTo && typeof dueTo === 'string') {
      where.push('due_date IS NOT NULL AND due_date <= ?');
      params.push(dueTo);
    }
    if (q && typeof q === 'string') {
      where.push('(title LIKE ? OR description LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (overdue === '1') {
      where.push("status != 'done' AND due_date IS NOT NULL AND due_date < ?");
      params.push(todayStr());
    }

    const sql = `
      SELECT * FROM tasks
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${STATUS_ORDER}, ${PRIORITY_ORDER},
               due_date IS NULL, due_date ASC, id DESC`;
    res.json(rows<Task>(db, sql, ...params));
  });

  // 新建
  router.post('/', (req: Request, res: Response) => {
    const input = taskSchema.parse(req.body);
    const result = run(
      db,
      `INSERT INTO tasks (title, description, category, priority, status, due_date, estimated_minutes, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      input.title,
      input.description,
      input.category,
      input.priority,
      input.status,
      input.due_date,
      input.estimated_minutes,
      req.userId!
    );
    const created = row<Task>(
      db,
      'SELECT * FROM tasks WHERE id = ? AND user_id = ?',
      Number(result.lastInsertRowid),
      req.userId!
    );
    res.status(201).json(created);
  });

  // 详情
  router.get('/:id', (req: Request, res: Response) => {
    const found = row<Task>(
      db,
      'SELECT * FROM tasks WHERE id = ? AND user_id = ?',
      Number(req.params.id),
      req.userId!
    );
    if (!found) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    res.json(found);
  });

  // 全量更新
  router.put('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const exists = row(db, 'SELECT id FROM tasks WHERE id = ? AND user_id = ?', id, req.userId!);
    if (!exists) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    const input = taskSchema.parse(req.body);
    run(
      db,
      `UPDATE tasks SET title = ?, description = ?, category = ?, priority = ?, status = ?,
        due_date = ?, estimated_minutes = ?,
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
      input.status,
      id,
      req.userId!
    );
    res.json(row<Task>(db, 'SELECT * FROM tasks WHERE id = ? AND user_id = ?', id, req.userId!));
  });

  // 只改状态：维护 completed_at
  router.patch('/:id/status', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const exists = row(db, 'SELECT id FROM tasks WHERE id = ? AND user_id = ?', id, req.userId!);
    if (!exists) {
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
    res.json(row<Task>(db, 'SELECT * FROM tasks WHERE id = ? AND user_id = ?', id, req.userId!));
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
