import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { rows, row, run, type Db } from '../db.js';
import { INSPIRATION_CATEGORIES, type Inspiration } from '../types.js';

const inspirationSchema = z.object({
  content: z.string().trim().min(1, '内容不能为空').max(500, '最多 500 字'),
  category: z.enum(INSPIRATION_CATEGORIES).optional().default('灵感'),
  // Base64 Data URL（前端已压缩到 ~300KB 内；2M 字符上限约对应 1.5MB 原图）
  image_url: z
    .string()
    .startsWith('data:image/', '图片格式应为 data:image/ 开头的 Base64')
    .max(2_000_000, '图片过大，请压缩后重试')
    .nullable()
    .optional()
    .default(null),
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
      'INSERT INTO inspirations (content, category, image_url, user_id) VALUES (?, ?, ?, ?)',
      input.content,
      input.category,
      input.image_url,
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

  // 编辑（全量替换：content/category/image_url）
  router.put('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const exists = row<Inspiration>(
      db,
      'SELECT * FROM inspirations WHERE id = ? AND user_id = ?',
      id,
      req.userId!
    );
    if (!exists) {
      res.status(404).json({ error: '灵感不存在' });
      return;
    }
    const input = inspirationSchema.parse(req.body);
    run(
      db,
      `UPDATE inspirations SET content = ?, category = ?, image_url = ?,
        updated_at = datetime('now','localtime')
       WHERE id = ? AND user_id = ?`,
      input.content,
      input.category,
      input.image_url,
      id,
      req.userId!
    );
    res.json(
      row<Inspiration>(
        db,
        'SELECT * FROM inspirations WHERE id = ? AND user_id = ?',
        id,
        req.userId!
      )
    );
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
