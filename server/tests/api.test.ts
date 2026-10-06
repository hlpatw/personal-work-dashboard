import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

let app: ReturnType<typeof createApp>;

function todayStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

beforeEach(() => {
  app = createApp(':memory:');
});

describe('health', () => {
  it('返回 ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('tasks', () => {
  it('创建任务返回 201 及完整对象', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ title: '写周报', category: '工作', priority: 'high' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('写周报');
    expect(res.body.status).toBe('todo');
    expect(res.body.priority).toBe('high');
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('空标题返回 400', async () => {
    const res = await request(app).post('/api/tasks').send({ title: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('非法枚举值返回 400', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'x', priority: 'top' });
    expect(res.status).toBe(400);
  });

  it('非法日期格式返回 400', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'x', due_date: '2026/10/01' });
    expect(res.status).toBe(400);
  });

  it('按状态/分类/关键词筛选', async () => {
    await request(app).post('/api/tasks').send({ title: '修复登录 bug', category: '工作' });
    await request(app).post('/api/tasks').send({ title: '读英语文章', category: '学习', status: 'done' });

    const byStatus = await request(app).get('/api/tasks?status=done');
    expect(byStatus.body).toHaveLength(1);
    expect(byStatus.body[0].title).toBe('读英语文章');

    const byCat = await request(app).get('/api/tasks?category=学习');
    expect(byCat.body).toHaveLength(1);

    const byQ = await request(app).get('/api/tasks?q=登录');
    expect(byQ.body).toHaveLength(1);
  });

  it('overdue 筛选：未完成且截止日在今天之前', async () => {
    await request(app).post('/api/tasks').send({ title: '逾期任务', due_date: todayStr(-1) });
    await request(app).post('/api/tasks').send({ title: '已完成逾期', due_date: todayStr(-2), status: 'done' });
    await request(app).post('/api/tasks').send({ title: '未来任务', due_date: todayStr(3) });

    const res = await request(app).get('/api/tasks?overdue=1');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('逾期任务');
  });

  it('PATCH 置 done 写 completed_at，改回 todo 清空', async () => {
    const created = await request(app).post('/api/tasks').send({ title: '流转测试' });
    const id = created.body.id;

    const done = await request(app).patch(`/api/tasks/${id}/status`).send({ status: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.completed_at).toBeTruthy();

    const back = await request(app).patch(`/api/tasks/${id}/status`).send({ status: 'todo' });
    expect(back.body.completed_at).toBeNull();
  });

  it('PUT 全量更新', async () => {
    const created = await request(app).post('/api/tasks').send({ title: '旧标题' });
    const res = await request(app)
      .put(`/api/tasks/${created.body.id}`)
      .send({ title: '新标题', description: '备注', category: '生活', priority: 'low', due_date: todayStr(5) });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('新标题');
    expect(res.body.due_date).toBe(todayStr(5));
  });

  it('任务支持贴图（image_url）', async () => {
    const img = 'data:image/png;base64,iVBORw0KGgo=';
    const created = await request(app).post('/api/tasks').send({ title: '带图任务', image_url: img });
    expect(created.status).toBe(201);
    expect(created.body.image_url).toBe(img);

    // 更新清除
    const cleared = await request(app)
      .put(`/api/tasks/${created.body.id}`)
      .send({ title: '带图任务', image_url: null });
    expect(cleared.body.image_url).toBeNull();

    // 默认 null / 非法前缀 400
    const plain = await request(app).post('/api/tasks').send({ title: '无图任务' });
    expect(plain.body.image_url).toBeNull();
    const bad = await request(app).post('/api/tasks').send({ title: 'x', image_url: 'not-a-data-url' });
    expect(bad.status).toBe(400);
  });

  it('支持预计完成时长字段', async () => {
    const created = await request(app)
      .post('/api/tasks')
      .send({ title: '估时任务', estimated_minutes: 90 });
    expect(created.status).toBe(201);
    expect(created.body.estimated_minutes).toBe(90);

    const updated = await request(app)
      .put(`/api/tasks/${created.body.id}`)
      .send({ title: '估时任务', estimated_minutes: 45 });
    expect(updated.status).toBe(200);
    expect(updated.body.estimated_minutes).toBe(45);

    const cleared = await request(app)
      .put(`/api/tasks/${created.body.id}`)
      .send({ title: '估时任务', estimated_minutes: null });
    expect(cleared.body.estimated_minutes).toBeNull();

    const bad = await request(app).post('/api/tasks').send({ title: 'x', estimated_minutes: -5 });
    expect(bad.status).toBe(400);
  });

  it('不存在的 id 返回 404', async () => {
    expect((await request(app).get('/api/tasks/999')).status).toBe(404);
    expect((await request(app).put('/api/tasks/999').send({ title: 'x' })).status).toBe(404);
    expect((await request(app).patch('/api/tasks/999/status').send({ status: 'done' })).status).toBe(404);
    expect((await request(app).delete('/api/tasks/999')).status).toBe(404);
  });

  it('删除后 204 且列表减少', async () => {
    const created = await request(app).post('/api/tasks').send({ title: '待删' });
    const del = await request(app).delete(`/api/tasks/${created.body.id}`);
    expect(del.status).toBe(204);
    const list = await request(app).get('/api/tasks');
    expect(list.body).toHaveLength(0);
  });
});

describe('标签与子任务', () => {
  it('创建带标签和子任务的任务', async () => {
    const res = await request(app).post('/api/tasks').send({
      title: '带标签任务',
      tags: ['重要', '联调'],
      subtasks: [{ title: '步骤一' }, { title: '步骤二', done: true }],
    });
    expect(res.status).toBe(201);
    expect(res.body.tags).toEqual(['重要', '联调']);
    expect(res.body.subtask_total).toBe(2);
    expect(res.body.subtask_done).toBe(1);

    const subs = await request(app).get(`/api/tasks/${res.body.id}/subtasks`);
    expect(subs.body).toHaveLength(2);
    expect(subs.body[1].done).toBe(true);
  });

  it('按标签筛选', async () => {
    await request(app).post('/api/tasks').send({ title: 'a', tags: ['重要'] });
    await request(app).post('/api/tasks').send({ title: 'b', tags: ['日常'] });
    const res = await request(app).get('/api/tasks?tag=重要');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe('a');
  });

  it('PUT 整体替换子任务', async () => {
    const created = await request(app)
      .post('/api/tasks')
      .send({ title: 'c', subtasks: [{ title: '旧1' }, { title: '旧2' }] });
    const updated = await request(app)
      .put(`/api/tasks/${created.body.id}`)
      .send({ title: 'c', subtasks: [{ title: '新1', done: true }] });
    expect(updated.body.subtask_total).toBe(1);
    expect(updated.body.subtask_done).toBe(1);
  });
});

describe('长期目标', () => {
  it('目标 CRUD、进度聚合与删除解除关联', async () => {
    const g = await request(app)
      .post('/api/goals')
      .send({ title: '读完三本书', target_date: '2026-12-31' });
    expect(g.status).toBe(201);
    expect(g.body.task_total).toBe(0);

    const t1 = await request(app).post('/api/tasks').send({ title: '书1', goal_id: g.body.id });
    await request(app).post('/api/tasks').send({ title: '书2', goal_id: g.body.id, status: 'done' });

    const list = await request(app).get('/api/goals');
    const goal = list.body.find((x: { id: number }) => x.id === g.body.id);
    expect(goal.task_total).toBe(2);
    expect(goal.task_done).toBe(1);

    // 状态流转
    const done = await request(app).patch(`/api/goals/${g.body.id}/status`).send({ status: 'done' });
    expect(done.body.status).toBe('done');

    // 删除目标 → 任务解除关联
    await request(app).delete(`/api/goals/${g.body.id}`);
    const t = await request(app).get(`/api/tasks/${t1.body.id}`);
    expect(t.body.goal_id).toBeNull();
  });

  it('目标分类：默认其他、可指定、可修改、非法值 400', async () => {
    const plain = await request(app).post('/api/goals').send({ title: '默认分类目标' });
    expect(plain.body.category).toBe('其他');

    const withCat = await request(app).post('/api/goals').send({ title: '学习目标', category: '学习' });
    expect(withCat.body.category).toBe('学习');

    const changed = await request(app)
      .put(`/api/goals/${withCat.body.id}`)
      .send({ title: '学习目标', category: '工作' });
    expect(changed.body.category).toBe('工作');

    expect((await request(app).post('/api/goals').send({ title: 'x', category: '摸鱼' })).status).toBe(400);
  });

  it('目标可编辑（PUT 全量替换）', async () => {
    const created = await request(app).post('/api/goals').send({ title: '旧标题', note: '旧备注' });
    const edited = await request(app)
      .put(`/api/goals/${created.body.id}`)
      .send({ title: '新标题', note: '新备注', category: '学习' });
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe('新标题');
    expect(edited.body.note).toBe('新备注');
    expect(edited.body.category).toBe('学习');
  });

  it('目标标题为空返回 400', async () => {
    const res = await request(app).post('/api/goals').send({ title: ' ' });
    expect(res.status).toBe(400);
  });
});

describe('此刻灵感', () => {
  it('创建返回 201 且默认类型为灵感', async () => {
    const res = await request(app).post('/api/inspirations').send({ content: '楼下樱花开了' });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe('楼下樱花开了');
    expect(res.body.category).toBe('灵感');
    expect(res.body.created_at).toBeTruthy();
  });

  it('空内容与超长内容返回 400', async () => {
    expect((await request(app).post('/api/inspirations').send({ content: '   ' })).status).toBe(400);
    expect((await request(app).post('/api/inspirations').send({ content: 'a'.repeat(501) })).status).toBe(400);
  });

  it('非法类型返回 400', async () => {
    const res = await request(app).post('/api/inspirations').send({ content: 'x', category: '杂念' });
    expect(res.status).toBe(400);
  });

  it('搜索与类型筛选', async () => {
    await request(app).post('/api/inspirations').send({ content: '周报可以这样写', category: '工作' });
    await request(app).post('/api/inspirations').send({ content: '楼下樱花开了', category: '生活' });
    const byQ = await request(app).get('/api/inspirations?q=樱花');
    expect(byQ.body).toHaveLength(1);
    expect(byQ.body[0].content).toContain('樱花');
    const byCat = await request(app).get('/api/inspirations?category=工作');
    expect(byCat.body).toHaveLength(1);
    expect(byCat.body[0].content).toContain('周报');
  });

  it('列表按时间倒序（新的在前）', async () => {
    await request(app).post('/api/inspirations').send({ content: '第一条' });
    await new Promise((r) => setTimeout(r, 1100)); // 确保 created_at 秒级不同
    await request(app).post('/api/inspirations').send({ content: '第二条' });
    const list = await request(app).get('/api/inspirations');
    expect(list.body[0].content).toBe('第二条');
    expect(list.body[1].content).toBe('第一条');
  });

  it('灵感可编辑（PUT 全量替换）', async () => {
    const created = await request(app)
      .post('/api/inspirations')
      .send({ content: '原始内容', category: '生活' });
    const edited = await request(app)
      .put(`/api/inspirations/${created.body.id}`)
      .send({ content: '改后的内容', category: '工作', image_url: null });
    expect(edited.status).toBe(200);
    expect(edited.body.content).toBe('改后的内容');
    expect(edited.body.category).toBe('工作');
    expect(edited.body.updated_at).toBeTruthy();

    expect((await request(app).put('/api/inspirations/999').send({ content: 'x' })).status).toBe(404);
    expect((await request(app).put(`/api/inspirations/${created.body.id}`).send({ content: ' ' })).status).toBe(400);
  });

  it('删除 204 与不存在 404', async () => {
    const created = await request(app).post('/api/inspirations').send({ content: '待删' });
    expect((await request(app).delete(`/api/inspirations/${created.body.id}`)).status).toBe(204);
    expect((await request(app).delete(`/api/inspirations/${created.body.id}`)).status).toBe(404);
  });
});

describe('贴图（灵感与目标）', () => {
  const tinyImg = 'data:image/png;base64,iVBORw0KGgo='; // 极小合法 Data URL

  it('灵感可带图，字段原样返回；默认为 null', async () => {
    const withImg = await request(app)
      .post('/api/inspirations')
      .send({ content: '带图灵感', image_url: tinyImg });
    expect(withImg.status).toBe(201);
    expect(withImg.body.image_url).toBe(tinyImg);

    const noImg = await request(app).post('/api/inspirations').send({ content: '无图灵感' });
    expect(noImg.body.image_url).toBeNull();
  });

  it('灵感图片超限（>2M 字符）与非图片前缀返回 400', async () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(2_000_001);
    expect((await request(app).post('/api/inspirations').send({ content: 'x', image_url: big })).status).toBe(400);
    expect(
      (await request(app).post('/api/inspirations').send({ content: 'x', image_url: 'data:text/plain;base64,eA==' })).status
    ).toBe(400);
  });

  it('目标可带图创建与更新，更新可清除图片', async () => {
    const g = await request(app).post('/api/goals').send({ title: '带图目标', image_url: tinyImg });
    expect(g.status).toBe(201);
    expect(g.body.image_url).toBe(tinyImg);

    const updated = await request(app)
      .put(`/api/goals/${g.body.id}`)
      .send({ title: '带图目标', image_url: null });
    expect(updated.body.image_url).toBeNull();
  });
});

describe('schedules', () => {
  it('创建日程 201', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .send({ title: '项目评审会', date: todayStr(), start_time: '10:00', end_time: '11:00', location: '会议室 A' });
    expect(res.status).toBe(201);
    expect(res.body.start_time).toBe('10:00');
  });

  it('结束时间早于开始时间返回 400', async () => {
    const res = await request(app)
      .post('/api/schedules')
      .send({ title: 'x', date: todayStr(), start_time: '11:00', end_time: '10:00' });
    expect(res.status).toBe(400);
  });

  it('区间查询含两端', async () => {
    await request(app).post('/api/schedules').send({ title: 'a', date: todayStr(-3) });
    await request(app).post('/api/schedules').send({ title: 'b', date: todayStr(0) });
    await request(app).post('/api/schedules').send({ title: 'c', date: todayStr(3) });

    const res = await request(app).get(`/api/schedules?from=${todayStr(-3)}&to=${todayStr(0)}`);
    const titles = res.body.map((s: { title: string }) => s.title);
    expect(titles).toContain('a');
    expect(titles).toContain('b');
    expect(titles).not.toContain('c');
  });

  it('今日接口排序：全天在前，其余按开始时间', async () => {
    await request(app).post('/api/schedules').send({ title: '晚上的', date: todayStr(), start_time: '19:00' });
    await request(app).post('/api/schedules').send({ title: '全天事项', date: todayStr() });
    await request(app).post('/api/schedules').send({ title: '早上的', date: todayStr(), start_time: '08:30' });

    const res = await request(app).get('/api/schedules/today');
    expect(res.body.map((s: { title: string }) => s.title)).toEqual(['全天事项', '早上的', '晚上的']);
  });
});

describe('stats', () => {
  it('summary 统计今日任务与逾期数', async () => {
    // 今日应办 3 件（今日截止 2 + 今日创建无截止日 1），完成 1 件
    await request(app).post('/api/tasks').send({ title: 'a', due_date: todayStr(0) });
    await request(app).post('/api/tasks').send({ title: 'b', due_date: todayStr(0) });
    await request(app).post('/api/tasks').send({ title: 'c' }); // 今日创建无截止日
    await request(app).post('/api/tasks').send({ title: '逾期件', due_date: todayStr(-1) });

    const list = await request(app).get('/api/tasks');
    const b = list.body.find((t: { title: string }) => t.title === 'b');
    await request(app).patch(`/api/tasks/${b.id}/status`).send({ status: 'done' });
    // 昨日截止、今天完成的任务也计入今日工作量
    const y = await request(app).post('/api/tasks').send({ title: '昨日件今日完成', due_date: todayStr(-1) });
    await request(app).patch(`/api/tasks/${y.body.id}/status`).send({ status: 'done' });

    const res = await request(app).get('/api/stats/summary');
    expect(res.body.today.total).toBe(4);
    expect(res.body.today.todo).toBe(2);
    expect(res.body.today.done).toBe(2);
    expect(res.body.today.completion_rate).toBe(50);
    expect(res.body.overdue_count).toBe(1);
  });

  it('daily 聚合每日完成数', async () => {
    for (let i = 0; i < 3; i++) {
      const created = await request(app).post('/api/tasks').send({ title: `t${i}` });
      await request(app).patch(`/api/tasks/${created.body.id}/status`).send({ status: 'done' });
    }
    const res = await request(app).get('/api/stats/completions/daily?days=7');
    expect(res.body).toHaveLength(1);
    expect(res.body[0].date).toBe(todayStr());
    expect(res.body[0].completed).toBe(3);
  });

  it('categories 分组统计', async () => {
    await request(app).post('/api/tasks').send({ title: 'a', category: '工作' });
    await request(app).post('/api/tasks').send({ title: 'b', category: '工作', status: 'done' });
    await request(app).post('/api/tasks').send({ title: 'c', category: '学习' });

    const res = await request(app).get('/api/stats/categories');
    const work = res.body.find((r: { category: string }) => r.category === '工作');
    expect(work.total).toBe(2);
    expect(work.done).toBe(1);
    expect(work.completion_rate).toBe(50);
    expect(res.body).toHaveLength(2);
  });
});
