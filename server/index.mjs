import { configuration } from './config.mjs';
import { createApplication } from './app.mjs';
try {
  const app = createApplication(configuration());
  await app.listen();
  console.log(`Live Draw: ${app.origin}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
} catch (error) { console.error(error.message); process.exitCode = 1; }
