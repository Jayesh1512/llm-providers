import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ProviderError } from './errors.js';
import type { InferenceState, StateStore } from './types.js';

/** Bounded journal: entries are never silently evicted, so paid requests cannot replay. */
export class FileStateStore implements StateStore {
  private states: Record<string, InferenceState> = {};
  private queue: Promise<void> = Promise.resolve();
  private constructor(private readonly dir: string, private readonly maximum: number) {}

  static async open(dir: string, maximum = 10_000): Promise<FileStateStore> {
    const store = new FileStateStore(dir, maximum);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // Refuse simultaneous processes. After an unclean exit, remove only .lock after
    // confirming the old process is dead; preserve requests.json and pending entries.
    try {
      const lock = await open(join(dir, '.lock'), 'wx', 0o600);
      try { await lock.writeFile(String(process.pid)); await lock.sync(); } finally { await lock.close(); }
    } catch {
      throw new Error('Provider state directory is locked. Stop the other node; after an unclean exit remove only .lock, preserving requests.json.');
    }
    try {
      let contents: string;
      try { contents = await readFile(join(dir, 'requests.json'), 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return store; throw error; }
      const parsed: unknown = JSON.parse(contents);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid provider journal');
      const entries = Object.entries(parsed);
      if (entries.length > maximum) throw new Error('Provider journal exceeds MAX_STATE_ENTRIES');
      for (const [id, state] of entries) {
        if (!/^[1-9]\d*$/.test(id) || !state || typeof state !== 'object' || !['pending', 'done', 'failed'].includes(state.status) ||
          !/^0x[\da-fA-F]{64}$/.test(state.promptHash) || !Number.isSafeInteger(state.maxOutputTokens) || state.maxOutputTokens < 1 ||
          (state.status === 'done' && (!state.invoice || state.invoice.requestId !== id))) throw new Error('Invalid provider journal; refusing unsafe replay');
      }
      store.states = parsed as Record<string, InferenceState>;
      return store;
    } catch (error) { await store.close(); throw error; }
  }
  get(requestId: string): InferenceState | undefined { return this.states[requestId]; }
  summary() { const done = Object.values(this.states).filter(s => s.status === 'done' && s.invoice); return { requests: done.length, earnedWei: done.reduce((a, s) => a + BigInt(s.invoice!.amountWei), 0n) }; }
  set(requestId: string, state: InferenceState): Promise<void> {
    const operation = this.queue.then(async () => {
      if (!this.states[requestId] && Object.keys(this.states).length >= this.maximum) throw new ProviderError(503, 'state_capacity_reached', 'Supplier replay journal is full; no new paid requests can be accepted.');
      const updated = { ...this.states, [requestId]: state };
      const temporary = join(this.dir, 'requests.tmp');
      const file = await open(temporary, 'w', 0o600);
      try { await file.writeFile(JSON.stringify(updated)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, join(this.dir, 'requests.json'));
      const directory = await open(this.dir, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      this.states = updated;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async close(): Promise<void> {
    await this.queue;
    try { await unlink(join(this.dir, '.lock')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

export class MemoryStateStore implements StateStore {
  private states = new Map<string, InferenceState>();
  get(requestId: string): InferenceState | undefined { return this.states.get(requestId); }
  async set(requestId: string, state: InferenceState): Promise<void> { this.states.set(requestId, state); }
}
