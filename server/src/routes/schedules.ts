import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { rows, row, run, todayStr, type Db } from '../db.js';
import type { Schedule } from '../types.js';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

const scheduleSchema = z
  .object({
    title: z.string().trim().min(1, '标题不能为空'),
    date: z.string().regex(dateRe, '日期格式应为 YYYY-MM-DD'),
    start_time: z.string().regex(timeRe, '时间格式应为 HH:mm').nullable().optional().default(null),
    end_time: z.string().regex(timeRe, '时间格式应为 HH:mm').nullable().optional().default(null),
    location: z.string().trim().optional().default(''),
    notes: z.string().trim().optional().default(''),
  })
  .refine(
    (s) =>
      !s.start_time || !s.end_time || s.start_time <= s.end_time,
    { message: '结束时间不能早于开始时间' }
  );

export default function scheduleRoutes(db: Db): Router {
  const router = Router();

  // 区间查询（含两端），日历页一次拉整月
  router.get('/', (req: Request, res: Response) => {
    const from = typeof req.query.from === 'string' ? req.query.from : todayStr();
    const to = typeof req.query.to === 'string' ? req.query.to : from;
    res.json(
      rows<Schedule>(
        db,
        `SELECT * FROM schedules WHERE user_id = ? AND date >= ? AND date <= ?
         ORDER BY date ASC, start_time IS NULL DESC, start_time ASC`,
        req.userId!,
        from,
        to
      )
    );
  });

  // 今日日程：全天在前，其余按开始时间
  router.get('/today', (req: Request, res: Response) => {
    res.json(
      rows<Schedule>(
        db,
        `SELECT * FROM schedules WHERE user_id = ? AND date = ?
         ORDER BY start_time IS NULL DESC, start_time ASC`,
        req.userId!,
        todayStr()
      )
    );
  });

  // 新建
  router.post('/', (req: Request, res: Response) => {
    const input = scheduleSchema.parse(req.body);
    const result = run(
      db,
      `INSERT INTO schedules (title, date, start_time, end_time, location, notes, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.title,
      input.date,
      input.start_time,
      input.end_time,
      input.location,
      input.notes,
      req.userId!
    );
    res.status(201).json(
      row<Schedule>(
        db,
        'SELECT * FROM schedules WHERE id = ? AND user_id = ?',
        Number(result.lastInsertRowid),
        req.userId!
      )
    );
  });

  // 更新
  router.put('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const exists = row(db, 'SELECT id FROM schedules WHERE id = ? AND user_id = ?', id, req.userId!);
    if (!exists) {
      res.status(404).json({ error: '日程不存在' });
      return;
    }
    const input = scheduleSchema.parse(req.body);
    run(
      db,
      `UPDATE schedules SET title = ?, date = ?, start_time = ?, end_time = ?, location = ?, notes = ?,
        updated_at = datetime('now','localtime')
       WHERE id = ? AND user_id = ?`,
      input.title,
      input.date,
      input.start_time,
      input.end_time,
      input.location,
      input.notes,
      id,
      req.userId!
    );
    res.json(row<Schedule>(db, 'SELECT * FROM schedules WHERE id = ? AND user_id = ?', id, req.userId!));
  });

  // 删除
  router.delete('/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const result = run(db, 'DELETE FROM schedules WHERE id = ? AND user_id = ?', id, req.userId!);
    if (result.changes === 0) {
      res.status(404).json({ error: '日程不存在' });
      return;
    }
    res.status(204).send();
  });

  return router;
}
