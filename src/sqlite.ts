/** Optional Node.js SQLite storage. The core entry point does not load node:sqlite. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { deserialize, serialize } from 'node:v8';
import { tuple, type Envelope } from './definitions.js';
import { fail, unexpected, type Result, type Tagged, type Unexpected } from './result.js';
import type { AggregateRow, RuntimeStore, StoreMap, ViewRow } from './runtime.js';

class SqlMap<V> implements StoreMap<V> {
  private readonly select;
  private readonly contains;
  private readonly list;
  private readonly put;
  constructor(
    database: DatabaseSync, private readonly namespace: string, private readonly writable: () => void,
    private readonly encode: (key: string, value: V) => unknown = (_key, value) => value,
    private readonly decode: (key: string, value: any) => V = (_key, value) => value,
  ) {
    this.select = database.prepare('SELECT value FROM accord_records WHERE namespace = ? AND key = ?');
    this.contains = database.prepare('SELECT 1 FROM accord_records WHERE namespace = ? AND key = ?');
    this.list = database.prepare('SELECT key, value FROM accord_records WHERE namespace = ? ORDER BY rowid');
    this.put = database.prepare('INSERT INTO accord_records(namespace, key, value) VALUES (?, ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value');
  }
  get(key: string): V | undefined {
    const row = this.select.get(this.namespace, key);
    return row ? this.decode(key, deserialize(row.value as Uint8Array)) : undefined;
  }
  has(key: string): boolean { return this.contains.get(this.namespace, key) !== undefined; }
  set(key: string, value: V): this {
    this.writable();
    this.put.run(this.namespace, key, serialize(this.encode(key, value)));
    return this;
  }
  *entries(): IterableIterator<[string, V]> {
    for (const row of this.list.all(this.namespace)) {
      const key = row.key as string;
      yield [key, this.decode(key, deserialize(row.value as Uint8Array))];
    }
  }
  [Symbol.iterator](): IterableIterator<[string, V]> { return this.entries(); }
}

class Positions implements StoreMap<number> {
  private readonly select;
  private readonly list;
  private readonly put;
  constructor(database: DatabaseSync, private readonly kind: string, private readonly consumer: string, private readonly writable: () => void) {
    this.select = database.prepare('SELECT seq FROM accord_checkpoints WHERE kind = ? AND consumer = ? AND stream = ?');
    this.list = database.prepare('SELECT stream, seq FROM accord_checkpoints WHERE kind = ? AND consumer = ? ORDER BY rowid');
    this.put = database.prepare('INSERT INTO accord_checkpoints(kind, consumer, stream, seq) VALUES (?, ?, ?, ?) ON CONFLICT(kind, consumer, stream) DO UPDATE SET seq = excluded.seq');
  }
  get(stream: string): number | undefined { return this.select.get(this.kind, this.consumer, stream)?.seq as number | undefined; }
  has(stream: string): boolean { return this.get(stream) !== undefined; }
  set(stream: string, seq: number): this { this.writable(); this.put.run(this.kind, this.consumer, stream, seq); return this; }
  *entries(): IterableIterator<[string, number]> {
    for (const row of this.list.all(this.kind, this.consumer)) yield [row.stream as string, row.seq as number];
  }
  [Symbol.iterator](): IterableIterator<[string, number]> { return this.entries(); }
}

interface Queue { tail: Promise<void>; pending: number; references: number }
const queues = new Map<string, Queue>();
const active = new AsyncLocalStorage<Queue>();

export interface SQLiteStore extends RuntimeStore, Disposable {
  readonly kind: 'sqlite';
  /** Use this connection inside a projection to commit SQL effects with its checkpoint. */
  readonly database: DatabaseSync;
  close(): void;
}

/** Open a persistent store. Await runtime operations before closing it. */
export function sqlite(filename: string): SQLiteStore {
  if (!filename) throw new TypeError('SQLite storage requires a filename');
  const database = new DatabaseSync(filename);
  const identity = filename === ':memory:' ? undefined : realpathSync(filename);
  const queue: Queue = identity && queues.get(identity) || { tail: Promise.resolve(), pending: 0, references: 0 };
  let closed = false;
  let pending = 0;
  let notifications: Array<() => void> | undefined;
  const writable = () => {
    if (closed || !database.isTransaction || active.getStore() !== queue && notifications === undefined) {
      throw new Error('SQLite store writes require a runtime transaction');
    }
  };
  const rollback = () => { if (database.isTransaction) database.exec('ROLLBACK'); };
  const initialize = (task: () => void) => {
    if (closed) throw new Error('SQLite store is closed');
    if (queue.pending || notifications) throw new Error('Cannot initialize SQLite storage while runtime operations are pending');
    database.exec('BEGIN IMMEDIATE');
    notifications = [];
    try { task(); database.exec('COMMIT'); }
    catch (cause) { rollback(); throw cause; }
    finally { notifications = undefined; }
  };
  try {
    if (queue.pending) throw new Error('Cannot open SQLite storage while runtime operations are pending');
    database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 0');
    initialize(() => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS accord_schema (version INTEGER NOT NULL) STRICT;
        INSERT INTO accord_schema(version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM accord_schema);
      `);
      const version = database.prepare('SELECT version FROM accord_schema').all();
      if (version.length !== 1 || version[0]?.version !== 1) throw new Error('Unsupported Accord SQLite schema version');
      database.exec(`
        CREATE TABLE IF NOT EXISTS accord_records (
          namespace TEXT NOT NULL, key TEXT NOT NULL, value BLOB NOT NULL,
          PRIMARY KEY(namespace, key)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS accord_events (
          kind TEXT NOT NULL, stream TEXT NOT NULL, seq INTEGER NOT NULL CHECK(seq > 0),
          id TEXT NOT NULL, envelope BLOB NOT NULL,
          PRIMARY KEY(kind, stream, seq), UNIQUE(kind, id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS accord_checkpoints (
          kind TEXT NOT NULL, consumer TEXT NOT NULL, stream TEXT NOT NULL,
          seq INTEGER NOT NULL CHECK(seq >= 0), PRIMARY KEY(kind, consumer, stream)
        ) STRICT;
      `);
    });
  } catch (cause) { database.close(); throw cause; }
  queue.references++;
  if (identity) queues.set(identity, queue);

  const listEvents = database.prepare('SELECT envelope FROM accord_events WHERE kind = ? AND stream = ? ORDER BY seq');
  const lastEvent = database.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM accord_events WHERE kind = ? AND stream = ?');
  const insertEvent = database.prepare('INSERT INTO accord_events(kind, stream, seq, id, envelope) VALUES (?, ?, ?, ?, ?)');
  const events = (kind: string, stream: string): Envelope[] => listEvents.all(kind, stream).map(row => deserialize(row.envelope as Uint8Array));
  const append = (kind: string, stream: string, envelopes: readonly Envelope[]) => {
    const last = lastEvent.get(kind, stream)!.seq as number;
    if (envelopes.length < last) throw new Error('Stored events cannot be removed');
    for (let index = last; index < envelopes.length; index++) {
      const envelope = envelopes[index]!;
      if (envelope.stream !== stream || envelope.seq !== index + 1) throw new Error('Invalid event stream position');
      insertEvent.run(kind, stream, envelope.seq, envelope.id, serialize(envelope));
    }
  };
  const groups = (kind: string): StoreMap<StoreMap<number>> => {
    const positions = new Map<string, Positions>();
    const group = (consumer: string) => {
      let result = positions.get(consumer);
      if (!result) { result = new Positions(database, kind, consumer, writable); positions.set(consumer, result); }
      return result;
    };
    return new SqlMap<StoreMap<number>>(database, kind, writable,
      (consumer, values) => { for (const [stream, seq] of values) group(consumer).set(stream, seq); return true; },
      consumer => group(consumer),
    );
  };
  const rows = new SqlMap<AggregateRow>(database, 'aggregates', writable,
    (stream, { events, ...row }) => { append('aggregate', stream, events); return row; },
    (stream, row) => ({ ...row, events: events('aggregate', stream) }),
  );
  const views = new SqlMap<ViewRow>(database, 'views', writable,
    (stream, { events, ...row }) => { append('view', stream, events); return row; },
    (stream, row) => ({ ...row, events: events('view', stream) }),
  );
  const store: SQLiteStore = {
    kind: 'sqlite', database, rows, views, cursors: groups('cursors'), watermarks: groups('watermarks'),
    streams: new SqlMap(database, 'streams', writable), versions: new SqlMap(database, 'versions', writable),
    runs: new Map(), locks: new Map(), listeners: new Map(), initialize,
    afterCommit(task) {
      writable();
      notifications!.push(task);
    },
    async atomic<T, E extends Tagged>(task: () => Promise<Result<T, E>>): Promise<Result<T, E | Unexpected>> {
      if (closed) return fail(unexpected(new Error('SQLite store is closed')));
      if (active.getStore() === queue) return fail(unexpected(new Error('Do not call a runtime operation from inside a SQLite transaction handler')));
      const previous = queue.tail;
      let release!: () => void;
      queue.tail = new Promise<void>(resolve => { release = resolve; });
      queue.pending++; pending++;
      await previous;
      try {
        return await active.run(queue, async () => {
          database.exec('BEGIN IMMEDIATE');
          notifications = [];
          try {
            const result = await task();
            tuple(result);
            if (result[1] !== null) { rollback(); return result; }
            if (!database.isTransaction) throw new Error('A handler must not commit the runtime SQLite transaction');
            database.exec('COMMIT');
            for (const notify of notifications) notify();
            return result;
          } catch (cause) {
            try { rollback(); }
            catch (rollbackError) { return fail(unexpected({ cause, rollbackError })); }
            return fail(unexpected(cause));
          } finally { notifications = undefined; }
        });
      } catch (cause) { return fail(unexpected(cause)); }
      finally { pending--; queue.pending--; release(); }
    },
    close() {
      if (closed) return;
      if (pending) throw new Error('Await pending runtime operations before closing SQLite storage');
      database.close(); closed = true;
      queue.references--;
      if (identity && !queue.references) queues.delete(identity);
    },
    [Symbol.dispose]() { this.close(); },
  };
  return store;
}
