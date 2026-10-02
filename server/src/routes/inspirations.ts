import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { rows, row, run, type Db } from '../db.js';
import { INSPIRATION_CATEGORIES, type Inspiration } from '../types.js';

const inspirationSchema = z.object({
  content: z.string().trim().min(1, '内容不能为空').max(500, '最多 500 字'),
  category: z.enum(INSPIRATION_CATEGORIES).optional().default('灵感'),
});

export default function inspirationRoutes(db: Db): Router {
  const router = Router();

  // 列表：按时间倒序，可按关键词/类型筛选
  router.get('/', (req: Request, res: Response) => {
    const where: string[] = ['user_id = ?'];
    const params: (string | number)[] = [req.userId!];
    const { q, category } = req.query;
    if (q && typeof q === 'string') {
      where.push('content LIKE ?');
      params.push(`%${q}%`);
    }
    if (category && typeof category === 'string' && (INSPIRATION_CATEGORIES as readonly string[]).includes(category)) {
      where.push('category = ?');
      params.push(category);
    }
    res.json(
      rows<Inspiration>(
        db,
        `SELECT * FROM inspirations WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC`,
        ...params
      )
    );
  });

  // 新建
  router.post('/', (req: Request, res: Response) => {
    const input = inspirationSchema.parse(req.body);
    const result = run(
      db,
      'INSERT INTO inspirations (content, category, user_id) VALUES (?, ?, ?)',
      input.content,
      input.category,
      req.userId!
    );
    const created = row<Inspiration>(
      db,
      'SELECT * FROM inspirations WHERE id = ? AND user_id = ?',
      Number(result.lastInsertRowid),
      req.userId!
    );
    res.status(201).json(created);
  });

  // 删除
  router.delete('/:id', (req: Request, res: Response) => {
    const result = run(
      db,
      'DELETE FROM inspirations WHERE id = ? AND user_id = ?',
      Number(req.params.id),
      req.userId!
    );
    if (result.changes === 0) {
      res.status(404).json({ error: '灵感不存在' });
      return;
    }
    res.status(204).send();
  });

  return router;
}
