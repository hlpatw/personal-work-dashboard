import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { rows, row, run, type Db } from '../db.js';
import { type Goal, type GoalStatus } from '../types.js';

const goalSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(200),
  note: z.string().trim().optional().default(''),
  target_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '目标日期格式应为 YYYY-MM-DD')
    .nullable()
    .optional()
    .default(null),
  status: z.enum(['active', 'done', 'archived']).optional().default('active'),
  // Base64 Data URL（前端已压缩；2M 字符上限约对应 1.5MB 原图）
  image_url: z
    .string()
    .startsWith('data:image/', '图片格式应为 data:image/ 开头的 Base64')
    .max(2_000_000, '图片过大，请压缩后重试')
    .nullable()
    .optional()
    .default(null),
});

const GOAL_SELECT = `
  SELECT g.*,
    (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id) AS task_total,
    (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id AND t.status = 'done') AS task_done
  FROM goals g`;

export default function goalRoutes(db: Db): Router {
  const router = Router();

  const getGoal = (id: number, userId: number): Goal | undefined =>
    row<Goal>(db, `${GOAL_SELECT} WHERE g.id = ? AND g.user_id = ?`, id, userId);

  // 列表（默认 active 在前，按创建时间倒序）
  router.get('/', (req: Request, res: Response) => {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const params: (string | number)[] = [req.userId!];
    let where = 'g.user_id = ?';
    if (status && ['active', 'done', 'archived'].includes(status)) {
      where += ' AND g.status = ?';
      params.push(status);
    }
    res.json(
      rows<Goal>(
        db,
        `${GOAL_SELECT} WHERE ${where}
         ORDER BY CASE g.status WHEN 'active' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
                  g.created_at DESC`,
        ...params
      )
    );
  });

  // 新建
  router.post('/', (req: Request, res: Response) => {
    const input = goalSchema.parse(req.body);
    const result = run(
      db,
      `INSERT INTO goals (title, note, target_date, status, image_url, user_id) VALUES (?, ?, ?, ?, ?, ?)`,
      input.title,
      input.note,
      input.target_date,
      input.status,
      input.image_url,
      req.userId!
    );
    res.status(201).json(getGoal(Number(result.lastInsertRowid), req.userId!));
  });

  // 更新
  router.put('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!getGoal(id, req.userId!)) {
      res.status(404).json({ error: '目标不存在' });
      return;
    }
    const input = goalSchema.parse(req.body);
    run(
      db,
      `UPDATE goals SET title = ?, note = ?, target_date = ?, status = ?, image_url = ?, updated_at = datetime('now','localtime')
       WHERE id = ? AND user_id = ?`,
      input.title,
      input.note,
      input.target_date,
      input.status,
      input.image_url,
      id,
      req.userId!
    );
    res.json(getGoal(id, req.userId!));
  });

  // 只改状态
  router.patch('/:id/status', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!getGoal(id, req.userId!)) {
      res.status(404).json({ error: '目标不存在' });
      return;
    }
    const { status } = z.object({ status: z.enum(['active', 'done', 'archived']) }).parse(req.body);
    run(
      db,
      `UPDATE goals SET status = ?, updated_at = datetime('now','localtime') WHERE id = ? AND user_id = ?`,
      status,
      id,
      req.userId!
    );
    res.json(getGoal(id, req.userId!));
  });

  // 删除（关联任务自动解除引用）
  router.delete('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const result = run(db, 'DELETE FROM goals WHERE id = ? AND user_id = ?', id, req.userId!);
    if (result.changes === 0) {
      res.status(404).json({ error: '目标不存在' });
      return;
    }
    res.status(204).send();
  });

  return router;
}
