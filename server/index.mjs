// SPDX-License-Identifier: GPL-3.0-only
// Start the studio: `node server/index.mjs` (or `npm start`).
import { createApp } from './app.mjs';

const port = Number(process.env.PORT ?? 8420);
const host = process.env.HOST ?? '127.0.0.1';
const app = await createApp({ port });
app.server.listen(port, host, () => {
  console.log(`Open Instrument Lab is running: http://localhost:${port}/`);
  console.log(`Engines: ${[...app.engines.keys()].join(', ') || 'none'}`);
  for (const problem of app.problems) console.warn(`Skipped a plug-in: ${problem.message}`);
});
const stop = () => app.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
