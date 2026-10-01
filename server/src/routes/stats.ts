import { Router, type Request, type Response } from 'express';
import { rows, row, todayStr, type Db } from '../db.js';
import type { StatsSummary, DailyCompletion, CategoryStat } from '../types.js';

export default function statsRoutes(db: Db): Router {
  const router = Router();

  // 今日概览 + 逾期数
  // 今日任务集合：截止日是今天、或（无截止日且今天创建）、或今天完成的任意任务
  router.get('/summary', (req: Request, res: Response) => {
    const today = todayStr();
    const uid = req.userId!;
    const byStatus = rows<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count FROM tasks
       WHERE user_id = ?
         AND (due_date = ? OR (due_date IS NULL AND date(created_at) = ?) OR date(completed_at) = ?)
       GROUP BY status`,
      uid,
      today,
      today,
      today
    );
    const counts = { todo: 0, in_progress: 0, done: 0 };
    for (const r of byStatus) counts[r.status as keyof typeof counts] = r.count;

    const schedules = row<{ count: number }>(
      db,
      'SELECT COUNT(*) AS count FROM schedules WHERE user_id = ? AND date = ?',
      uid,
      today
    );
    const overdue = row<{ count: number }>(
      db,
      `SELECT COUNT(*) AS count FROM tasks
       WHERE user_id = ? AND status != 'done' AND due_date IS NOT NULL AND due_date < ?`,
      uid,
      today
    );

    const total = counts.todo + counts.in_progress + counts.done;
    const summary: StatsSummary = {
      today: {
        total,
        todo: counts.todo,
        in_progress: counts.in_progress,
        done: counts.done,
        completion_rate: total === 0 ? 0 : Math.round((counts.done / total) * 100),
        schedules_count: schedules?.count ?? 0,
      },
      overdue_count: overdue?.count ?? 0,
    };
    res.json(summary);
  });

  // 每日完成数（近 N 天，只返回有记录的天；补零交前端做）
  router.get('/completions/daily', (req: Request, res: Response) => {
    const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 365);
    res.json(
      rows<DailyCompletion>(
        db,
        `SELECT date(completed_at) AS date, COUNT(*) AS completed
         FROM tasks
         WHERE user_id = ?
           AND completed_at IS NOT NULL
           AND date(completed_at) >= date(?, '-' || ? || ' days')
         GROUP BY date(completed_at)
         ORDER BY date ASC`,
        req.userId!,
        todayStr(),
        days
      )
    );
  });

  // 分类统计
  router.get('/categories', (req: Request, res: Response) => {
    res.json(
      rows<CategoryStat>(
        db,
        `SELECT category,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
                ROUND(
                  CAST(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * 100
                ) AS completion_rate
         FROM tasks WHERE user_id = ? GROUP BY category ORDER BY total DESC`,
        req.userId!
      )
    );
  });

  return router;
}
