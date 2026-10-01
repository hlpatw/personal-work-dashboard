import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT ?? 3001);
const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const app = createApp(`${dataDir}/dashboard.db`);

app.listen(PORT, () => {
  console.log(`[api] 已启动: http://localhost:${PORT}`);
});
