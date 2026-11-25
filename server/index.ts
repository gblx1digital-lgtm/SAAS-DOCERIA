import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { openDb } from './db.ts';
import { createApi } from './api.ts';

export function createApp(dbFile?: string) {
  const db = openDb(dbFile);
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', createApi(db));

  const dist = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  return { app, db };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const port = Number(process.env.PORT ?? 3001);
  const { app } = createApp();
  app.listen(port, () => console.log(`Doceria rodando em http://localhost:${port}`));
}
