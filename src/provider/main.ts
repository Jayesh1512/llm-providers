import 'dotenv/config';
import { loadConfig } from './config.js';
import { createProviderServer } from './server.js';

try {
  const config = loadConfig();
  const node = await createProviderServer(config);
  node.server.listen(config.port, process.env.BIND_HOST ?? '127.0.0.1', () => {
    console.info(`Supplier ${config.provider} listening on port ${config.port}; chain ${config.chainId}.`);
  });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await node.close(); process.exitCode = 0; } catch { process.exitCode = 1; }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch {
  console.error('Supplier startup failed. Check required configuration, allowed chain, deployed contracts, and state-directory lock.');
  process.exitCode = 1;
}
