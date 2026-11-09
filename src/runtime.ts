import { isDeepStrictEqual } from 'node:util';
import { classMethods, type AnyAggregateClass } from './class-aggregate.js';
import { isReservedFactoryMethod, type FactoryAggregate } from './factory-aggregate.js';
import { parse, type Infer, type SchemaInput } from './schema.js';
import { fail, ok, unexpected, type InvalidInput, type Result, type ResultError, type ResultValue, type Tagged, type Unexpected } from './result.js';
import {
  tuple, type Aggregate, type AggregateDefinition, type AnyAggregate, type AnyCommand, type AnyTaggedFactory, type AnyConsumer, type AnyView, type ContextOf,
  type Dependency, type Envelope, type ExecutionContext, type InputOf, type RejectionsOf, type ReplyOf,
  type ServiceOf, type Source, type SourceEvent, type Stream, type Uses,
} from './definitions.js';
import { executeWorkflow, makeRun, type AnyWorkflow, type RunRecord, type Workflow } from './workflow.js';

export interface Model<N extends string, A extends Record<string, AggregateDefinition>, V extends Record<string, AnyView>, W extends Record<string, AnyWorkflow>, S extends Record<string, Stream<any, any>>, P extends readonly AnyConsumer[]> {
  readonly kind: 'model'; readonly name: N; readonly aggregates: A; readonly views: V;
  readonly workflows: W; readonly streams: S; readonly consumers: P;
}
export type AnyModel = Model<string, any, any, any, any, any>;
function nameOf(definition: { readonly name: string; readonly kind: string } | AnyAggregateClass): string {
  return 'aggregateName' in definition ? definition.aggregateName : definition.name;
}
export function model<
  const N extends string, const A extends Record<string, AggregateDefinition>, const V extends Record<string, AnyView> = {},
  const W extends Record<string, AnyWorkflow> = {}, const S extends Record<string, Stream<any, any>> = {},
  const P extends readonly AnyConsumer[] = readonly [], const Q extends readonly AnyConsumer[] = readonly [],
>(name: N, contract: { readonly aggregates: A; readonly views?: V; readonly workflows?: W; readonly streams?: S; readonly policies?: P; readonly projections?: Q }): Model<N, A, V, W, S, readonly [...P, ...Q]> {
  const views = contract.views ?? {};
  const consumers = [...(contract.policies ?? []), ...(contract.projections ?? [])];
  const definitions = [...Object.values(contract.aggregates), ...Object.values(views), ...consumers, ...Object.values(contract.workflows ?? {}), ...Object.values(contract.streams ?? {})] as Array<Source | AnyConsumer | AnyWorkflow | Stream<any, any>>;
  const names = new Set<string>();
  for (const definition of definitions) {
    const name = nameOf(definition);
    if (!name || names.has(name)) throw new TypeError(`Duplicate or empty definition: ${name}`);
    names.add(name);
  }
  const aliases = [...Object.keys(contract.aggregates), ...Object.keys(views)];
  if (new Set(aliases).size !== aliases.length || aliases.some(alias => ['workflows', 'streams', 'flush', 'constructor', '__proto__', 'prototype', 'then'].includes(alias))) throw new TypeError('Duplicate or reserved model alias');
  const sources = new Set([...Object.values(contract.aggregates), ...Object.values(views)]);
  for (const definition of [...Object.values(views), ...consumers] as Array<AnyView | AnyConsumer>) {
    if (!sources.has(definition.from)) throw new TypeError(`Unregistered source for ${definition.name}`);
    if (definition.from.kind === 'aggregate' || definition.from.kind === 'view') {
      const events = definition.from.kind === 'aggregate' ? definition.from.events : definition.from.on;
      for (const event of definition.on) if (!events.includes(event)) throw new TypeError(`Unknown source event: ${definition.name}.${event.name}`);
    }
    if (!Number.isSafeInteger(definition.version) || definition.version < 1) throw new TypeError(`Invalid version: ${definition.name}`);
  }
  for (const consumer of consumers) if (!Number.isSafeInteger(consumer.batch) || consumer.batch < 1) throw new TypeError(`Invalid batch size: ${consumer.name}`);
  return { kind: 'model', name, aggregates: contract.aggregates, views, workflows: contract.workflows ?? {}, streams: contract.streams ?? {}, consumers } as unknown as Model<N, A, V, W, S, readonly [...P, ...Q]>;
}
export interface Receipt<R = unknown> {
  readonly commandId: string; readonly stream: string; readonly version: number;
  readonly events: readonly Envelope[]; readonly reply: R;
  /** Event position for aggregates whose state version counts successful calls. */
  readonly eventCursor?: number;
}
export type Conflict = { readonly _tag: 'Conflict'; readonly expected: number; readonly actual: number };
export type CommandConflict = { readonly _tag: 'CommandConflict'; readonly commandId: string };
export type ConsistencyTimeout = { readonly _tag: 'ConsistencyTimeout'; readonly stream: string; readonly version: number };
export type RuntimeError = Unexpected | InvalidInput | Conflict | CommandConflict;
export interface CallOptions extends ExecutionContext { readonly expectedVersion?: number }
export interface ReadOptions { readonly atLeast?: Pick<Receipt, 'stream' | 'version' | 'eventCursor'>; readonly signal?: AbortSignal }
export interface Snapshot<S> { readonly state: S; readonly cursor: number }
export interface AggregateRow { readonly state: unknown; readonly version?: number; readonly events: readonly Envelope[]; readonly receipts: Map<string, { input: unknown; receipt: Receipt }> }
export interface ViewRow { state: unknown; events: Envelope[] }
export interface StoreMap<V> extends Iterable<[string, V]> {
  get(key: string): V | undefined;
  has(key: string): boolean;
  set(key: string, value: V): unknown;
  entries(): IterableIterator<[string, V]>;
}
export interface RuntimeStore {
  readonly kind: 'memory' | 'sqlite';
  readonly rows: StoreMap<AggregateRow>; readonly views: StoreMap<ViewRow>;
  readonly cursors: StoreMap<StoreMap<number>>; readonly watermarks: StoreMap<StoreMap<number>>;
  readonly streams: StoreMap<Array<{ id: string; event: unknown; seq: number }>>;
  readonly runs: Map<string, RunRecord>; readonly locks: Map<string, Promise<unknown>>;
  readonly listeners: Map<string, Set<() => void>>;
  readonly versions: StoreMap<number>;
  readonly initialize?: (task: () => void) => void;
  readonly atomic?: <T, E extends Tagged>(task: () => Promise<Result<T, E>>) => Promise<Result<T, E | Unexpected>>;
  readonly afterCommit?: (task: () => void) => void;
}
export interface MemoryStore extends RuntimeStore {
  readonly kind: 'memory';
  readonly rows: Map<string, AggregateRow>; readonly views: Map<string, ViewRow>;
  readonly cursors: Map<string, Map<string, number>>; readonly watermarks: Map<string, Map<string, number>>;
  readonly streams: Map<string, Array<{ id: string; event: unknown; seq: number }>>;
  readonly runs: Map<string, RunRecord>; readonly locks: Map<string, Promise<unknown>>;
  readonly listeners: Map<string, Set<() => void>>;
  readonly versions: Map<string, number>;
}
/** In-process storage. Reuse this object between runtimes to retain in-process history. */
export function memory(): MemoryStore {
  return { kind: 'memory', rows: new Map(), views: new Map(), cursors: new Map(), watermarks: new Map(), streams: new Map(), runs: new Map(), locks: new Map(), listeners: new Map(), versions: new Map() };
}
function ordered<T>(store: RuntimeStore, key: string, task: () => Promise<T>): Promise<T> {
  const previous = store.locks.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  const settled = next.then(() => undefined, () => undefined);
  store.locks.set(key, settled);
  void settled.then(() => { if (store.locks.get(key) === settled) store.locks.delete(key); });
  return next;
}
function atomic<T, E extends Tagged>(store: RuntimeStore, task: () => Promise<Result<T, E>>): Promise<Result<T, E | Unexpected>> {
  return store.atomic ? store.atomic(task) : task();
}
function read<T>(store: RuntimeStore, task: () => T): Promise<Result<T, Unexpected>> {
  return atomic<T, Unexpected>(store, async () => {
    try { return ok(task()); }
    catch (cause) { return fail(unexpected(cause)); }
  });
}
function positionFor(positions: StoreMap<StoreMap<number>>, id: string): StoreMap<number> {
  if (!positions.has(id)) positions.set(id, new Map());
  return positions.get(id)!;
}
function notify(store: RuntimeStore, key: string): void {
  const publish = () => { for (const callback of store.listeners.get(key) ?? []) callback(); };
  if (store.afterCommit) store.afterCommit(publish); else publish();
}
async function* watch<S>(store: RuntimeStore, key: string, snapshot: () => Snapshot<S>, signal?: AbortSignal): AsyncGenerator<Result<Snapshot<S>, Unexpected>> {
  let wake: (() => void) | undefined;
  let dirty = true;
  const listener = () => { dirty = true; wake?.(); };
  const listeners = store.listeners.get(key) ?? new Set();
  store.listeners.set(key, listeners);
  listeners.add(listener);
  signal?.addEventListener('abort', listener);
  try {
    while (!signal?.aborted) {
      if (dirty) { dirty = false; yield await read(store, () => structuredClone(snapshot())); }
      else await new Promise<void>(resolve => { wake = resolve; if (dirty || signal?.aborted) resolve(); });
    }
  } catch (cause) { yield fail(unexpected(cause)); }
  finally {
    listeners.delete(listener);
    if (!listeners.size) store.listeners.delete(key);
    signal?.removeEventListener('abort', listener);
  }
}
type UnionToIntersection<U> = [U] extends [never] ? {} : (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;
type AggregateUses<A> = A extends FactoryAggregate<any, any, any, infer U> ? U
  : A extends Aggregate<any, any, infer C> ? C[keyof C]['uses'] : never;
export type ModelUses<M extends AnyModel> = AggregateUses<M['aggregates'][keyof M['aggregates']]> | M['consumers'][number]['uses'] | M['workflows'][keyof M['workflows']]['uses'];
export type ModelServices<M extends AnyModel> = UnionToIntersection<ModelUses<M> extends infer U ? U extends Uses ? { [K in keyof U]: ServiceOf<U[K]> } : never : never>;
type ManagedMethod<F> = F extends (...args: infer Args) => infer R
  ? [Awaited<R>] extends [Result<unknown, Tagged>]
    ? (id: string, ...args: Args) => Promise<Result<Receipt<ResultValue<Awaited<R>>>, ResultError<Awaited<R>> | InvalidInput | Unexpected>>
    : never
  : never;
type ManagedMethods<M> = {
  [K in keyof M & string as ManagedMethod<M[K]> extends never ? never : K]: ManagedMethod<M[K]>;
};
type AggregateReads<S> = {
  get(id: string): Promise<Result<S, Unexpected>>;
  events(id: string, options?: { after?: number }): Promise<Result<readonly Envelope[], Unexpected>>;
};
type AggregateClient<A> = A extends AnyAggregateClass
  ? ManagedMethods<Omit<InstanceType<A>, 'getState' | 'pullEvents'>> & AggregateReads<ReturnType<A['initial']>>
  : A extends FactoryAggregate<any, infer S, infer M, any> ? ManagedMethods<M> & AggregateReads<S>
  : A extends Aggregate<any, infer S, infer C> ? {
    [K in keyof C]: (id: string, input: InputOf<C[K]>, options?: CallOptions) => Promise<Result<Receipt<ReplyOf<C[K]>>, RejectionsOf<C[K]> | RuntimeError>>;
  } & AggregateReads<S> : never;
type ViewState<V> = V extends AnyView ? ReturnType<V['initial']> : never;
export interface ViewClient<S> {
  get(key: string, options?: ReadOptions): Promise<Result<S | null, Unexpected | ConsistencyTimeout>>;
  snapshot(key: string): Promise<Result<Snapshot<S | null>, Unexpected>>;
  events(key: string, options?: { after?: number }): Promise<Result<readonly Envelope[], Unexpected>>;
  watch(key: string, options?: { signal?: AbortSignal }): AsyncGenerator<Result<Snapshot<S | null>, Unexpected>, void, unknown>;
}
type WorkflowClient<W> = W extends Workflow<any, infer I, infer R, infer E, any> ? {
  (input: I, options?: ExecutionContext): Promise<Result<R, E | Unexpected | InvalidInput | CommandConflict>>;
  signal(key: string, name: string, value: unknown): Promise<Result<void, Unexpected>>;
} : never;
export interface StreamClient<S> {
  append(key: string, event: S, options?: { id?: string }): Promise<Result<{ cursor: number }, Unexpected | CommandConflict>>;
  list(key: string, options?: { after?: number }): Promise<Result<readonly { id: string; event: S; seq: number }[], Unexpected>>;
  watch(key: string, options?: { signal?: AbortSignal }): AsyncGenerator<Result<Snapshot<readonly { id: string; event: S; seq: number }[]>, Unexpected>, void, unknown>;
}
export type Runtime<M extends AnyModel> = {
  readonly [K in keyof M['aggregates']]: AggregateClient<M['aggregates'][K]>;
} & {
  readonly [K in keyof M['views']]: ViewClient<ViewState<M['views'][K]>>;
} & {
  readonly workflows: { readonly [K in keyof M['workflows']]: WorkflowClient<M['workflows'][K]> };
  readonly streams: { readonly [K in keyof M['streams']]: StreamClient<Infer<M['streams'][K]['event']>> };
  readonly flush: () => Promise<Result<void, Tagged>>;
};
export type RuntimeOptions<M extends AnyModel> = { readonly storage?: RuntimeStore } &
  (keyof ModelServices<M> extends never ? { readonly services?: ModelServices<M> } : { readonly services: ModelServices<M> });
export function modelDependencies(definition: AnyModel): ReadonlyMap<string, Dependency<string, unknown>> {
  const definitions = [...Object.values(definition.aggregates), ...Object.values(definition.views), ...definition.consumers, ...Object.values(definition.workflows)] as Array<Source | AnyConsumer | AnyWorkflow>;
  const dependencyNames = new Map<string, Dependency<string, unknown>>();
  const serviceNames = new Map<string, Dependency<string, unknown>>();
  for (const item of definitions) {
    const usesList: Uses[] = item.kind === 'aggregate' ? Object.values(item.commands).map((command: any) => command.uses) : 'uses' in item ? [item.uses] : [];
    for (const uses of usesList) for (const [alias, dependency] of Object.entries(uses)) {
      const existing = dependencyNames.get(alias);
      if (existing && existing !== dependency) throw new TypeError(`Conflicting dependency alias: ${alias}`);
      const named = serviceNames.get(dependency.name);
      if (named && named !== dependency) throw new TypeError(`Conflicting service name: ${dependency.name}`);
      serviceNames.set(dependency.name, dependency);
      dependencyNames.set(alias, dependency);
    }
  }
  return dependencyNames;
}
export function wire<M extends AnyModel>(definition: M, ...options: keyof ModelServices<M> extends never ? [options?: RuntimeOptions<M>] : [options: RuntimeOptions<M>]): Runtime<M> {
  const store = options[0]?.storage ?? memory();
  if (store.kind === 'sqlite' && Object.keys(definition.workflows).length) throw new TypeError('SQLite storage does not yet support durable workflows');
  const services = (options[0]?.services ?? {}) as Record<string, unknown>;
  const prefix = JSON.stringify([definition.name]);
  const key = (...parts: unknown[]) => JSON.stringify([definition.name, ...parts]);
  for (const [alias, dependency] of modelDependencies(definition)) {
    if (!Object.hasOwn(services, alias)) throw new TypeError(`Missing dependency: ${alias} (${dependency.name})`);
  }
  const context = (uses: Uses, metadata: ExecutionContext = {}): ContextOf<any> => {
    const dependencies = Object.fromEntries(Object.keys(uses).map(alias => [alias, services[alias]]));
    return { ...dependencies, ...metadata };
  };
  const consumerKey = (consumer: { name: string; version: number }) => key('consumer', consumer.name, consumer.version);
  const sourceEvents = (source: Source): Envelope[] => {
    if (source.kind !== 'view') return [...store.rows.entries()].filter(([id]) => id.startsWith(prefix.slice(0, -1) + ',') && JSON.parse(id)[1] === nameOf(source)).flatMap(([, row]) => [...row.events]);
    return [...store.views.entries()].filter(([id]) => {
      const parts = JSON.parse(id);
      return parts[0] === definition.name && parts[1] === source.name && parts[2] === source.version;
    }).flatMap(([, row]) => row.events);
  };
  const cursorFor = (id: string) => positionFor(store.cursors, id);
  const initialize = () => {
    for (const view of Object.values(definition.views) as AnyView[]) {
      const versionKey = key('version', view.name);
      if ((store.versions.get(versionKey) ?? 0) > view.version) throw new TypeError(`View versions cannot decrease: ${view.name}`);
      store.versions.set(versionKey, view.version);
      const baselineKey = `${consumerKey(view)}:baseline`;
      if (!store.cursors.has(baselineKey)) {
        const baseline = cursorFor(baselineKey);
        for (const aggregate of Object.values(definition.aggregates) as AggregateDefinition[]) {
          for (const envelope of sourceEvents(aggregate)) baseline.set(envelope.stream, envelope.seq);
        }
      }
    }
    // Policies begin at registration; projections and views rebuild from history.
    for (const consumer of definition.consumers as AnyConsumer[]) {
      const id = consumerKey(consumer);
      if (consumer.kind === 'policy' && !store.cursors.has(id)) {
        const cursor = cursorFor(id);
        for (const envelope of sourceEvents(consumer.from)) cursor.set(envelope.stream, envelope.seq);
      }
    }
  };
  if (store.initialize) store.initialize(initialize); else initialize();
  const output: Record<string, any> = { workflows: {}, streams: {} };
  let flushing: Promise<Result<void, Tagged>> | undefined;
  const flush = () => {
    if (flushing) return flushing;
    flushing = ordered(store, key('flush'), async () => {
      try {
        // Bounded drain. SQLite commits each view sweep and consumer batch separately.
        for (let pass = 0; pass < 10_000; pass++) {
          let progressed = false;
          for (const view of Object.values(definition.views) as AnyView[]) {
            const outcome = await atomic(store, async () => {
              let advanced = false;
              const id = consumerKey(view);
              const cursor = cursorFor(id);
              const watermark = positionFor(store.watermarks, id);
              for (const envelope of sourceEvents(view.from)) {
                if (envelope.seq <= (cursor.get(envelope.stream) ?? 0)) continue;
                if (view.on.some(factory => factory.name === envelope.event._tag)) {
                  const routes = view.keyOf(structuredClone(envelope));
                  const keys = routes === undefined ? [] : typeof routes === 'string' ? [routes] : [...new Set(routes)];
                  if (keys.some(route => typeof route !== 'string')) throw new TypeError('View routes must be strings');
                  const updates = keys.map(route => {
                    const rowKey = key(view.name, view.version, route);
                    const old = store.views.get(rowKey);
                    const state = parse(view.state, view.evolve(structuredClone(old?.state ?? view.initial()), structuredClone(envelope.event), structuredClone(envelope)));
                    const seq = (old?.events.length ?? 0) + 1;
                    const origin = envelope.origin ?? { stream: envelope.stream, seq: envelope.seq };
                    const replay = envelope.replay === true || origin.seq <= (store.cursors.get(`${consumerKey(view)}:baseline`)?.get(origin.stream) ?? 0);
                    const forwarded: Envelope = { ...envelope, origin, replay, id: `${envelope.id}:${view.name}:${view.version}:${route}`, stream: rowKey, seq, source: { type: view.name, id: route } };
                    return { rowKey, state, events: [...(old?.events ?? []), forwarded] };
                  });
                  for (const update of updates) {
                    store.views.set(update.rowKey, { state: structuredClone(update.state), events: update.events });
                    notify(store, update.rowKey);
                  }
                }
                cursor.set(envelope.stream, envelope.seq);
                watermark.set(envelope.stream, envelope.seq);
                if (envelope.origin) watermark.set(envelope.origin.stream, Math.max(watermark.get(envelope.origin.stream) ?? 0, envelope.origin.seq));
                advanced = true;
              }
              return ok(advanced);
            });
            if (outcome[1] !== null) return outcome as Result<void, Tagged>;
            progressed = outcome[0] || progressed;
          }
          const propagated = await atomic(store, async () => {
            for (const view of Object.values(definition.views) as AnyView[]) {
              if (view.from.kind === 'view') {
                const watermark = store.watermarks.get(consumerKey(view));
                for (const [stream, seq] of store.watermarks.get(consumerKey(view.from)) ?? []) watermark?.set(stream, Math.max(watermark.get(stream) ?? 0, seq));
              }
            }
            return ok(undefined);
          });
          if (propagated[1] !== null) return propagated as Result<void, Tagged>;
          for (const consumer of definition.consumers as AnyConsumer[]) {
            const pending = await read(store, () => {
              const cursor = store.cursors.get(consumerKey(consumer));
              const available = sourceEvents(consumer.from).filter(envelope => envelope.seq > (cursor?.get(envelope.stream) ?? 0));
              const batches: Envelope[][] = [];
              for (const envelope of available) {
                const selected = consumer.on.some(factory => factory.name === envelope.event._tag);
                const last = batches[batches.length - 1];
                if (consumer.kind === 'projection' && last && last.length < consumer.batch && last[0]?.stream === envelope.stream && selected && consumer.on.some(factory => factory.name === last[0]!.event._tag)) last.push(envelope);
                else batches.push([envelope]);
              }
              return batches;
            });
            if (pending[1] !== null) return pending as Result<void, Tagged>;
            for (const pendingBatch of pending[0]) {
              const outcome = await atomic<boolean, Tagged>(store, async () => {
                const cursor = cursorFor(consumerKey(consumer));
                // Another connection may have acknowledged this batch since selection.
                const batch = pendingBatch.filter(entry => entry.seq > (cursor.get(entry.stream) ?? 0));
                if (batch.length === 0) return ok(false);
                const envelope = batch[0]!;
                if (consumer.kind === 'policy' && envelope.replay || !consumer.on.some(factory => factory.name === envelope.event._tag)) { cursor.set(envelope.stream, envelope.seq); return ok(true); }
                const handled = await consumer.handle(
                  structuredClone(consumer.kind === 'policy' ? envelope : batch),
                  context(consumer.uses, { idempotencyKey: envelope.id, at: envelope.at }),
                );
                if (handled[1] !== null) return handled as Result<boolean, Tagged>;
                for (const entry of batch) cursor.set(entry.stream, entry.seq);
                return ok(true);
              });
              if (outcome[1] !== null) return outcome as Result<void, Tagged>;
              progressed = outcome[0] || progressed;
            }
          }
          if (!progressed) return ok(undefined);
        }
        throw new Error('Consumer cycle exceeded the in-memory drain limit');
      } catch (cause) { return fail(unexpected(cause)); }
    });
    void flushing.finally(() => { flushing = undefined; });
    return flushing;
  };
  output.flush = flush;
  for (const [alias, aggregate] of Object.entries(definition.aggregates) as Array<[string, AggregateDefinition]>) {
    const client: Record<string, any> = Object.create(null);
    let exposed = client;
    const aggregateName = nameOf(aggregate);
    type Decision = { readonly events: readonly Tagged[]; readonly reply?: unknown; readonly state?: unknown };
    const execute = (
      id: string, name: string, input: unknown, callOptions: CallOptions,
      decide: (state: unknown, metadata: ExecutionContext) => Promise<Result<Decision, Tagged>>,
    ) => ordered(store, key(aggregateName, id), () => atomic(store, async () => {
      try {
        if (typeof id !== 'string' || !id) return fail({ _tag: 'InvalidInput', message: 'An aggregate id must be a nonempty string' });
        if (callOptions.signal?.aborted) throw callOptions.signal.reason;
        const stream = key(aggregateName, id);
        if (callOptions.commandId !== undefined && (typeof callOptions.commandId !== 'string' || !callOptions.commandId)) return fail({ _tag: 'InvalidInput', message: 'commandId must be a nonempty string' });
        if (callOptions.expectedVersion !== undefined && (!Number.isSafeInteger(callOptions.expectedVersion) || callOptions.expectedVersion < 0)) return fail({ _tag: 'InvalidInput', message: 'expectedVersion must be a nonnegative safe integer' });
        const old = store.rows.get(stream);
        const commandId = callOptions.commandId ?? crypto.randomUUID();
        const signature = aggregate.kind === 'aggregate' ? structuredClone({ name, input }) : undefined;
        const previous = aggregate.kind === 'aggregate' ? old?.receipts.get(commandId) : undefined;
        if (previous) return isDeepStrictEqual(previous.input, signature) ? ok(structuredClone(previous.receipt)) : fail({ _tag: 'CommandConflict', commandId });
        const cursor = old?.events.length ?? 0;
        const version = old?.version ?? cursor;
        if (callOptions.expectedVersion !== undefined && callOptions.expectedVersion !== version) return fail({ _tag: 'Conflict', expected: callOptions.expectedVersion, actual: version });
        const at = Date.now();
        const initial = old?.state ?? aggregate.initial();
        const [decision, error] = await decide(initial, { ...callOptions, commandId, at });
        if (error !== null) return fail(error);
        if (callOptions.signal?.aborted) throw callOptions.signal.reason;
        const state = aggregate.kind !== 'aggregate' ? decision.state : decision.events.reduce(
          (state, event) => parse(aggregate.state, aggregate.evolve(structuredClone(state), structuredClone(event))),
          structuredClone(initial),
        );
        const events = decision.events.map((event, index): Envelope => {
          const seq = cursor + index + 1;
          return { id: `${stream}:${seq}`, stream, seq, at, source: { type: aggregateName, id }, event };
        });
        const receipt: Receipt = {
          commandId, stream, events, reply: decision.reply,
          ...(aggregate.kind !== 'aggregate'
            ? { version: version + 1, eventCursor: cursor + events.length }
            : { version: cursor + events.length }),
        };
        const receipts = new Map(old?.receipts);
        const copy = structuredClone(receipt);
        if (aggregate.kind === 'aggregate') receipts.set(commandId, { input: signature, receipt: copy });
        // Clone the result before committing so a failed clone leaves state and events untouched.
        const response = structuredClone(copy);
        store.rows.set(stream, { state: structuredClone(state), version: receipt.version, events: [...(old?.events ?? []), ...copy.events], receipts });
        notify(store, stream);
        return ok(response);
      } catch (cause) { return fail(unexpected(cause)); }
    }));
    if (aggregate.kind !== 'aggregate') {
      const schemas = new Map<string, AnyTaggedFactory>();
      for (const consumer of [...Object.values(definition.views), ...definition.consumers] as Array<AnyView | AnyConsumer>) {
        if (consumer.from !== aggregate) continue;
        for (const factory of consumer.on) {
          const previous = schemas.get(factory.name);
          if (previous && previous !== factory) throw new TypeError(`Conflicting event definition: ${factory.name}`);
          schemas.set(factory.name, factory);
        }
      }
      const methodClient = (name: string, prototypeMethod?: (...args: unknown[]) => unknown) =>
        (id: string, ...args: unknown[]) => execute(id, name, args, {}, async (state, metadata) => {
          const instance = aggregate.kind === 'class-aggregate'
            ? new aggregate(structuredClone(state))
            : aggregate.create(state, context(aggregate.uses, metadata));
          const method = prototypeMethod ?? Object.getOwnPropertyDescriptor(instance, name)?.value;
          if (typeof method !== 'function') throw new TypeError(`Missing aggregate method: ${name}`);
          const result: unknown = await method.apply(instance, args);
          tuple(result);
          const [reply, error] = result;
          if (error !== null) return fail(error);
          const events = instance.pullEvents().map(event => schemas.get(event._tag)?.parse(event) ?? event);
          return ok({ state: instance.getState(), events, reply });
        });
      if (aggregate.kind === 'class-aggregate') {
        for (const [name, method] of classMethods(aggregate)) client[name] = methodClient(name, method);
      } else {
        const methods = new Map<string, ReturnType<typeof methodClient>>();
        exposed = new Proxy(client, {
          get(target, name) {
            if (Object.hasOwn(target, name)) return Reflect.get(target, name);
            if (typeof name !== 'string' || isReservedFactoryMethod(name)) return undefined;
            let method = methods.get(name);
            if (!method) {
              method = methodClient(name);
              methods.set(name, method);
            }
            return method;
          },
        });
      }
    } else {
      for (const [name, command] of Object.entries(aggregate.commands) as Array<[string, AnyCommand]>) {
        client[name] = (id: string, input: unknown, callOptions: CallOptions = {}) =>
          execute(id, name, input, callOptions, async (state, metadata) => command(state, input, context(command.uses, metadata)));
      }
    }
    client.get = async (id: string) => {
      try { await store.locks.get(key(aggregateName, id)); return await read(store, () => structuredClone(store.rows.get(key(aggregateName, id))?.state ?? aggregate.initial())); }
      catch (cause) { return fail(unexpected(cause)); }
    };
    client.events = (id: string, readOptions: { after?: number } = {}) => read(store, () => structuredClone(store.rows.get(key(aggregateName, id))?.events.filter(event => event.seq > (readOptions.after ?? 0)) ?? []));
    output[alias] = exposed;
  }
  for (const [alias, view] of Object.entries(definition.views) as Array<[string, AnyView]>) {
    const rowKey = (id: string) => key(view.name, view.version, id);
    output[alias] = {
      async get(id: string, readOptions: ReadOptions = {}) {
        try {
          if (readOptions.signal?.aborted) throw readOptions.signal.reason;
          const outcome = readOptions.atLeast ? await flush() : ok(undefined);
          return await atomic(store, async () => {
            if (readOptions.atLeast) {
              const receipt = readOptions.atLeast;
              if ((store.watermarks.get(consumerKey(view))?.get(receipt.stream) ?? 0) < (receipt.eventCursor ?? receipt.version)) {
                if (outcome[1] !== null) return fail(unexpected(outcome[1]));
                return fail({ _tag: 'ConsistencyTimeout', ...receipt });
              }
            }
            return ok(structuredClone(store.views.get(rowKey(id))?.state ?? null));
          });
        } catch (cause) { return fail(unexpected(cause)); }
      },
      snapshot(id: string) { return read(store, () => { const row = store.views.get(rowKey(id)); return structuredClone({ state: row?.state ?? null, cursor: row?.events.length ?? 0 }); }); },
      events(id: string, readOptions: { after?: number } = {}) { return read(store, () => structuredClone(store.views.get(rowKey(id))?.events.filter(event => event.seq > (readOptions.after ?? 0)) ?? [])); },
      watch(id: string, readOptions: { signal?: AbortSignal } = {}) { return watch(store, rowKey(id), () => { const row = store.views.get(rowKey(id)); return { state: row?.state ?? null, cursor: row?.events.length ?? 0 }; }, readOptions.signal); },
    };
  }
  for (const [alias, stream] of Object.entries(definition.streams) as Array<[string, Stream<string, SchemaInput>]>) {
    output.streams[alias] = {
      async append(id: string, event: unknown, appendOptions: { id?: string } = {}) {
        return atomic(store, async () => {
          try {
            parse(stream.key, id);
            const parsed = parse(stream.event, event);
            const streamKey = key('stream', stream.name, id);
            const rows = store.streams.get(streamKey) ?? [];
            const eventId = appendOptions.id ?? crypto.randomUUID();
            const old = rows.find(row => row.id === eventId);
            if (old) return isDeepStrictEqual(old.event, parsed) ? ok({ cursor: old.seq }) : fail({ _tag: 'CommandConflict', commandId: eventId });
            const seq = rows.length + 1;
            store.streams.set(streamKey, [...rows, { id: eventId, event: structuredClone(parsed), seq }]);
            notify(store, streamKey);
            return ok({ cursor: seq });
          } catch (cause) { return fail(unexpected(cause)); }
        });
      },
      list(id: string, readOptions: { after?: number } = {}) { return read(store, () => structuredClone(store.streams.get(key('stream', stream.name, id))?.filter(row => row.seq > (readOptions.after ?? 0)) ?? [])); },
      watch(id: string, readOptions: { signal?: AbortSignal } = {}) { const streamKey = key('stream', stream.name, id); return watch(store, streamKey, () => { const rows = store.streams.get(streamKey) ?? []; return { state: rows, cursor: rows.length }; }, readOptions.signal); },
    };
  }
  for (const [alias, workflow] of Object.entries(definition.workflows) as Array<[string, AnyWorkflow]>) {
    const execute = async (rawInput: unknown, runOptions: ExecutionContext = {}) => {
      let input: unknown;
      try { input = parse(workflow.input, rawInput); }
      catch (cause) { return fail({ _tag: 'InvalidInput', message: String(cause) }); }
      try {
        const runId = workflow.key(input);
        if (typeof runId !== 'string' || !runId) throw new TypeError('Workflow key must be a nonempty string');
        const runKey = key('workflow', workflow.name, runId);
        return await ordered(store, runKey, async () => {
          let record = store.runs.get(runKey);
          if (record && !isDeepStrictEqual(record.input, input)) return fail({ _tag: 'CommandConflict', commandId: runId });
          if (!record) { record = makeRun(input); store.runs.set(runKey, record); }
          return executeWorkflow(workflow, runKey, input, record, context(workflow.uses, runOptions), runOptions);
        });
      } catch (cause) { return fail(unexpected(cause)); }
    };
    output.workflows[alias] = Object.assign(execute, {
      async signal(id: string, name: string, value: unknown) {
        try {
          const record = store.runs.get(key('workflow', workflow.name, id));
          if (!record) throw new TypeError(`Unknown workflow run: ${id}`);
          if (record.signals.has(name) && !isDeepStrictEqual(record.signals.get(name), value)) throw new TypeError(`Conflicting signal: ${name}`);
          record.signals.set(name, structuredClone(value));
          for (const listener of record.waiters.get(name) ?? []) listener(structuredClone(value));
          return ok(undefined);
        } catch (cause) { return fail(unexpected(cause)); }
      },
    });
  }
  return output as Runtime<M>;
}
export interface StoryContext<M extends AnyModel> {
  readonly bank: Runtime<M>;
  readonly equal: (actual: unknown, expected: unknown) => void;
  readonly given: <A extends Extract<M['aggregates'][keyof M['aggregates']], AnyAggregate>>(aggregate: A, id: string, events: readonly SourceEvent<A>[]) => Promise<Result<void, Unexpected>>;
}
export async function story<M extends AnyModel, R, E extends Tagged>(
  definition: M, body: (context: StoryContext<M>) => Promise<Result<R, E>> | Result<R, E>,
  ...options: keyof ModelServices<M> extends never ? [options?: RuntimeOptions<M>] : [options: RuntimeOptions<M>]
): Promise<Result<R, E | Unexpected>> {
  try {
    const storage = options[0]?.storage ?? memory();
    const bank = wire(definition, { ...options[0], storage } as RuntimeOptions<M>);
    return await body({
      bank,
      equal(actual, expected) { if (!isDeepStrictEqual(actual, expected)) throw new Error('Story assertion failed'); },
      async given(aggregate, id, events) {
        return atomic<void, Unexpected>(storage, async () => {
          try {
            if (!Object.values(definition.aggregates).includes(aggregate)) throw new TypeError('Unregistered aggregate');
            if (aggregate.kind !== 'aggregate') throw new TypeError('Snapshot aggregates are restored from state');
            const stream = JSON.stringify([definition.name, aggregate.name, id]);
            if (storage.rows.has(stream)) throw new TypeError('History already exists for this instance');
            let state = aggregate.initial();
            const history: Envelope[] = [];
            for (const value of events) {
              const factory = aggregate.events.find((factory: any) => factory.name === value._tag);
              if (!factory) throw new TypeError(`Undeclared event: ${value._tag}`);
              const event = factory.parse(value);
              state = parse(aggregate.state, aggregate.evolve(structuredClone(state), event));
              const seq = history.length + 1;
              history.push({ id: `${stream}:${seq}`, stream, seq, at: Date.now(), source: { type: aggregate.name, id }, event, replay: true });
            }
            storage.rows.set(stream, { state: structuredClone(state), events: history, receipts: new Map() });
            return ok(undefined);
          } catch (cause) { return fail(unexpected(cause)); }
        });
      },
    });
  } catch (cause) { return fail(unexpected(cause)); }
}
