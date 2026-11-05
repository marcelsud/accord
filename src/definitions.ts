import { object, parse, type Infer, type Schema, type SchemaInput, type Shape } from './schema.js';
import { fail, ok, unexpected, type InvalidInput, type Result, type Tagged, type Unexpected } from './result.js';

export type MaybePromise<T> = T | PromiseLike<T>;
export type TaggedValue<C> = C extends (...args: never[]) => infer T ? T : never;
export interface TaggedFactory<N extends string, P extends Shape | undefined, K extends 'event' | 'rejection' = 'event' | 'rejection'> extends Schema<
  Readonly<{ _tag: N }> & (P extends Shape ? Infer<P> : {})
> {
  (...args: P extends Shape ? [properties: Infer<P>] : []): Readonly<{ _tag: N }> & (P extends Shape ? Infer<P> : {});
  readonly kind: K;
  readonly name: N;
  readonly shape: P;
}
export type AnyTaggedFactory = TaggedFactory<string, any>;
export type AnyEvent = TaggedFactory<string, any, 'event'>;
export type AnyRejection = TaggedFactory<string, any, 'rejection'>;
export type Values<F extends readonly AnyTaggedFactory[]> = ReturnType<F[number]>;
function tagged(kind: 'event' | 'rejection', name: string, shape?: Shape): AnyTaggedFactory {
  if (!name || shape && Object.hasOwn(shape, '_tag')) throw new TypeError('Tags must have a name and cannot be overridden');
  const factory = (...args: unknown[]) => {
    if (shape === undefined && args.length) throw new TypeError(`${name} accepts no properties`);
    const properties = shape === undefined ? {} : object(shape).parse(args[0]);
    return Object.freeze({ ...properties, _tag: name });
  };
  Object.defineProperty(factory, 'name', { value: name });
  return Object.assign(factory, {
    kind, shape,
    parse(value: unknown) {
      if (value === null || typeof value !== 'object' || (value as Tagged)._tag !== name) throw new TypeError(`Expected ${name}`);
      const { _tag, ...properties } = value as Tagged & Record<string, unknown>;
      return shape === undefined ? (Object.keys(properties).length ? (() => { throw new TypeError(`${name} accepts no properties`); })() : factory()) : factory(properties);
    },
  }) as AnyTaggedFactory;
}
export function event<const N extends string>(name: N): TaggedFactory<N, undefined, 'event'>;
export function event<const N extends string, const P extends Shape>(name: N, shape: P & { readonly _tag?: never }): TaggedFactory<N, P, 'event'>;
export function event(name: string, shape?: Shape): AnyTaggedFactory { return tagged('event', name, shape); }
export function rejection<const N extends string>(name: N): TaggedFactory<N, undefined, 'rejection'>;
export function rejection<const N extends string, const P extends Shape>(name: N, shape: P & { readonly _tag?: never }): TaggedFactory<N, P, 'rejection'>;
export function rejection(name: string, shape?: Shape): AnyTaggedFactory { return tagged('rejection', name, shape); }

export const ServiceValue: unique symbol = Symbol.for('@marcelsud/accord/service-value');
export const RequirementId: unique symbol = Symbol.for('@marcelsud/accord/requirement');
export const EffectBody: unique symbol = Symbol.for('@marcelsud/accord/effect-body');
export interface Dependency<N extends string, V> {
  readonly kind: 'service' | 'external';
  readonly name: N;
  readonly [ServiceValue]: V;
}
export type AnyDependency = Dependency<string, any>;
export type Uses = Readonly<Record<string, AnyDependency>>;
export type ServiceOf<D extends AnyDependency> = D[typeof ServiceValue];
export type Requirement<D extends AnyDependency> = { readonly [RequirementId]: D['name'] };
export type Requirements<U extends Uses> = { [K in keyof U]: Requirement<U[K]> }[keyof U];
export interface ExecutionContext {
  readonly signal?: AbortSignal;
  readonly commandId?: string;
  readonly at?: number;
  readonly actor?: unknown;
  readonly idempotencyKey?: string;
}
export type ContextOf<U extends Uses> = { readonly [K in keyof U]: ServiceOf<U[K]> } & ExecutionContext;
export type ContextArgs<U extends Uses> = keyof U extends never ? [context?: ExecutionContext] : [context: ContextOf<U>];
export function service<const N extends string, const S extends SchemaInput>(name: N, schema: S): Dependency<N, Infer<S>> & { readonly schema: S } {
  return { kind: 'service', name, schema } as unknown as Dependency<N, Infer<S>> & { readonly schema: S };
}

/** Optional integrations implement this protocol; the core never imports Effect. */
export interface AdaptedBody<Args extends readonly unknown[], A, E extends Tagged, R> {
  readonly [EffectBody]: true;
  readonly requirements?: R;
  readonly bind: (uses: Uses) => (...args: [...Args, ContextOf<any>]) => Promise<Result<A, E | Unexpected>>;
}
export type Body<Args extends readonly unknown[], U extends Uses, A, E extends Tagged> =
  | ((...args: [...Args, ContextOf<U>]) => MaybePromise<Result<A, E | Unexpected>>)
  | AdaptedBody<Args, A, E | Unexpected, Requirements<U>>;
export function bindBody(body: any, uses: Uses): (...args: any[]) => MaybePromise<Result<any, any>> {
  return typeof body === 'function' ? body : body.bind(uses);
}
export function validateUses(uses: Uses): void {
  const reserved = new Set(['signal', 'commandId', 'at', 'actor', 'idempotencyKey', 'services', 'step', 'wait', 'sleep']);
  for (const [alias, dependency] of Object.entries(uses)) {
    if (reserved.has(alias) || !alias || !dependency || !['service', 'external'].includes(dependency.kind)) throw new TypeError(`Invalid dependency alias: ${alias}`);
  }
}
export function checkUses(uses: Uses, context: Record<string, unknown>): void {
  for (const [key, dependency] of Object.entries(uses)) {
    if (!Object.hasOwn(context, key)) throw new TypeError(`Missing dependency: ${key} (${dependency.name})`);
    if ('schema' in dependency) parse(dependency.schema as SchemaInput, context[key]);
  }
}
export function checkError(factories: readonly AnyTaggedFactory[], error: unknown): Tagged {
  if (error instanceof Error && (error as Unexpected)._tag === 'Unexpected') return error as Unexpected;
  const factory = factories.find(factory => factory.name === (error as Tagged | null)?._tag);
  if (!factory) throw new TypeError(`Undeclared rejection: ${(error as Tagged | null)?._tag}`);
  return factory.parse(error);
}
export function tuple(value: unknown): asserts value is Result<unknown, Tagged> {
  if (!Array.isArray(value) || value.length !== 2 || value[1] !== null && (!value[1] || typeof value[1]._tag !== 'string')) {
    throw new TypeError('Expected [value, null] or [null, taggedError]');
  }
  if (value[1] !== null && value[0] !== null) throw new TypeError('A failed result must contain null in its value slot');
}
export interface Decision<E extends Tagged, R> {
  readonly events: readonly E[];
  readonly reply?: R;
}
export type CommandDecision<E extends Tagged, R> = [R] extends [undefined]
  ? { readonly events: readonly E[]; readonly reply?: undefined }
  : { readonly events: readonly E[]; readonly reply: R };
export interface CommandContract<St extends SchemaInput, In extends SchemaInput, Ev extends readonly AnyEvent[], Re extends readonly AnyRejection[], Rep extends SchemaInput | undefined, U extends Uses> {
  readonly state: St;
  readonly input: In;
  readonly events: Ev;
  readonly rejects?: Re;
  readonly reply?: Rep;
  readonly uses?: U;
}
export interface AggregateCommandContract {
  readonly input: SchemaInput;
  readonly events: readonly AnyEvent[];
  readonly rejects?: readonly AnyRejection[];
  readonly reply?: SchemaInput;
  readonly uses?: Uses;
  readonly state?: never;
}
export interface AggregateContract {
  readonly state: SchemaInput;
  readonly commands: Readonly<Record<string, AggregateCommandContract>>;
}
type DeclaredUses<C> = C extends { readonly uses: infer U extends Uses } ? U : {};
type DeclaredReply<C> = C extends { readonly reply: infer R extends SchemaInput } ? Infer<R> : undefined;
type DeclaredRejections<C> = C extends { readonly rejects: infer R extends readonly AnyRejection[] } ? Values<R> : never;
export interface Command<S, I, E extends Tagged, Re extends Tagged, R, U extends Uses> {
  (state: S, input: I, ...context: ContextArgs<U>): Promise<Result<CommandDecision<E, R>, Re | InvalidInput | Unexpected>>;
  readonly kind: 'command';
  readonly contract: CommandContract<any, any, any, any, any, U>;
  readonly uses: U;
  readonly events: readonly AnyTaggedFactory[];
  readonly rejects: readonly AnyTaggedFactory[];
}
export type AnyCommand = Command<any, any, any, any, any, any>;
const commandOrigins = new WeakMap<AnyCommand, { state: SchemaInput; name: string }>();
export type StateOf<C> = C extends Command<infer S, any, any, any, any, any> ? S : never;
export type InputOf<C> = C extends Command<any, infer I, any, any, any, any> ? I : never;
export type EventsOf<C> = C extends Command<any, any, infer E, any, any, any> ? E : never;
export type RejectionsOf<C> = C extends Command<any, any, any, infer E, any, any> ? E : never;
export type ReplyOf<C> = C extends Command<any, any, any, any, infer R, any> ? R : never;
export function command<const A extends AggregateContract, const K extends keyof A['commands'] & string>(
  aggregate: A, name: K, body: Body<
    [state: Infer<A['state']>, input: Infer<A['commands'][NoInfer<K>]['input']>],
    DeclaredUses<A['commands'][NoInfer<K>]>,
    CommandDecision<Values<A['commands'][NoInfer<K>]['events']>, DeclaredReply<A['commands'][NoInfer<K>]>>,
    DeclaredRejections<A['commands'][NoInfer<K>]>
  >,
): Command<Infer<A['state']>, Infer<A['commands'][K]['input']>, Values<A['commands'][K]['events']>,
  DeclaredRejections<A['commands'][K]>, DeclaredReply<A['commands'][K]>, DeclaredUses<A['commands'][K]>>;
export function command<
  const St extends SchemaInput, const In extends SchemaInput, const Ev extends readonly AnyEvent[],
  const Re extends readonly AnyRejection[] = readonly [], const Rep extends SchemaInput | undefined = undefined,
  const U extends Uses = {},
>(contract: CommandContract<St, In, Ev, Re, Rep, U>, body: Body<
  [state: Infer<St>, input: Infer<In>], U, CommandDecision<Values<Ev>, Rep extends SchemaInput ? Infer<Rep> : undefined>, Values<Re>
>): Command<Infer<St>, Infer<In>, Values<Ev>, Values<Re>, Rep extends SchemaInput ? Infer<Rep> : undefined, U>;
export function command(contract: any, body: any, aggregateBody?: any): AnyCommand {
  let origin: { state: SchemaInput; name: string } | undefined;
  if (arguments.length === 3) {
    const name = body;
    if (typeof name !== 'string' || !contract?.commands || !Object.hasOwn(contract.commands, name)) {
      throw new TypeError(`Unknown command: ${String(name)}`);
    }
    const declaration = contract.commands[name];
    if (!declaration || Object.hasOwn(declaration, 'state')) throw new TypeError('Command state is inherited from its aggregate contract');
    origin = { state: contract.state, name };
    contract = { ...declaration, state: contract.state };
    body = aggregateBody;
  }
  const uses = contract.uses ?? {};
  validateUses(uses);
  const rejects = contract.rejects ?? [];
  const execute = bindBody(body, uses);
  const callable = async (state: unknown, input: unknown, context: ContextOf<any> = {}) => {
    let parsed: unknown;
    try { parsed = parse(contract.input, input); }
    catch (cause) { return fail({ _tag: 'InvalidInput' as const, message: cause instanceof Error ? cause.message : String(cause) }); }
    try {
      checkUses(uses, context);
      const result = await execute(structuredClone(parse(contract.state, state)), parsed, context);
      tuple(result);
      const [value, error] = result;
      if (error !== null) return fail(checkError(rejects, error));
      if (!value || typeof value !== 'object' || !('events' in value) || !Array.isArray(value.events)) throw new TypeError('A command must return a decision with events');
      const events = value.events.map((value: Tagged) => {
        const factory = contract.events.find((factory: AnyEvent) => factory.name === value?._tag);
        if (!factory) throw new TypeError(`Undeclared event: ${value?._tag}`);
        return factory.parse(value);
      });
      const returnedReply = (value as { reply?: unknown }).reply;
      const reply = contract.reply === undefined ? undefined : parse(contract.reply, returnedReply);
      if (contract.reply === undefined && returnedReply !== undefined) throw new TypeError('Undeclared command reply');
      return ok({ events, reply });
    } catch (cause) { return fail(unexpected(cause)); }
  };
  const result = Object.assign(callable, { kind: 'command' as const, contract, uses, events: contract.events, rejects }) as AnyCommand;
  if (origin) commandOrigins.set(result, origin);
  return result;
}

export interface ExternalContract<I extends SchemaInput, R extends SchemaInput | undefined, Re extends readonly AnyRejection[], U extends Uses> {
  readonly input: I;
  readonly reply?: R;
  readonly rejects?: Re;
  readonly uses?: U;
}
export interface External<N extends string, I, R, E extends Tagged, U extends Uses> extends Dependency<N,
  (input: I, options?: ExecutionContext) => Promise<Result<R, E | InvalidInput | Unexpected>>
> {
  readonly kind: 'external';
  readonly contract: ExternalContract<any, any, any, U>;
  readonly uses: U;
  readonly implement: (services: ContextOf<U>) => ServiceOf<External<N, I, R, E, U>>;
}
export function external<
  const N extends string, const I extends SchemaInput, const R extends SchemaInput | undefined = undefined,
  const Re extends readonly AnyRejection[] = readonly [], const U extends Uses = {},
>(name: N, contract: ExternalContract<I, R, Re, U>, body: Body<
  [input: Infer<I>], U, R extends SchemaInput ? Infer<R> : undefined, Values<Re>
>): External<N, Infer<I>, R extends SchemaInput ? Infer<R> : undefined, Values<Re>, U> {
  const uses = contract.uses ?? {};
  validateUses(uses);
  const execute = bindBody(body, uses);
  const implement = (services: ContextOf<U>) => async (input: unknown, options: ExecutionContext = {}) => {
    let parsed: unknown;
    try { parsed = parse(contract.input, input); }
    catch (cause) { return fail({ _tag: 'InvalidInput' as const, message: String(cause) }); }
    try {
      const context = { ...services, ...options };
      checkUses(uses, context);
      const result = await execute(parsed, context);
      tuple(result);
      const [value, error] = result;
      if (error !== null) return fail(checkError(contract.rejects ?? [], error));
      return ok(contract.reply === undefined ? undefined : parse(contract.reply, value));
    } catch (cause) { return fail(unexpected(cause)); }
  };
  return { kind: 'external', name, contract, uses, implement } as unknown as External<N, Infer<I>, R extends SchemaInput ? Infer<R> : undefined, Values<Re>, U>;
}

export interface Aggregate<N extends string, S, C extends Record<string, AnyCommand>> {
  readonly kind: 'aggregate'; readonly name: N;
  readonly state: SchemaInput; readonly initial: () => S;
  readonly commands: C;
  readonly events: readonly AnyTaggedFactory[];
  readonly evolve: (state: S, event: EventsOf<C[keyof C]>) => S;
}
export interface AnyAggregate {
  readonly kind: 'aggregate'; readonly name: string; readonly state: SchemaInput;
  readonly initial: () => any; readonly commands: Record<string, AnyCommand>;
  readonly events: readonly AnyTaggedFactory[]; readonly evolve: (state: any, event: any) => any;
}
export function aggregate<const N extends string, const S extends SchemaInput, const C extends Record<string, Command<Infer<S>, any, any, any, any, any>>>(
  name: N, contract: { readonly state: S; readonly initial: () => Infer<S>; readonly commands: C },
  evolve: (state: Infer<S>, event: EventsOf<C[keyof C]>) => Infer<S>,
): Aggregate<N, Infer<S>, C> {
  for (const key of Object.keys(contract.commands)) if (['get', 'events', 'constructor', '__proto__', 'prototype', 'then'].includes(key)) throw new TypeError(`Reserved command name: ${key}`);
  for (const [name, command] of Object.entries(contract.commands)) {
    const origin = commandOrigins.get(command);
    if (!origin) continue;
    if (origin.name !== name || origin.state !== contract.state) {
      throw new TypeError(`Command does not belong to this aggregate contract: ${name}`);
    }
  }
  const byName = new Map<string, AnyTaggedFactory>();
  for (const command of Object.values(contract.commands)) for (const event of command.events) {
    const previous = byName.get(event.name);
    if (previous && previous !== event) throw new TypeError(`Conflicting event definition: ${event.name}`);
    byName.set(event.name, event);
  }
  const events = [...byName.values()];
  parse(contract.state, contract.initial());
  return { kind: 'aggregate', name, ...contract, events, evolve };
}
export interface Envelope<E extends Tagged = Tagged> {
  readonly id: string; readonly stream: string; readonly seq: number; readonly at: number;
  readonly origin?: { readonly stream: string; readonly seq: number };
  readonly replay?: boolean;
  readonly source: { readonly type: string; readonly id: string };
  readonly event: E;
}
export type Source = AnyAggregate | AnyView;
export type SourceEvent<S> = S extends Aggregate<any, any, infer C> ? EventsOf<C[keyof C]> : S extends View<any, any, any, infer E> ? E : never;
export interface View<N extends string, S, From extends Source, E extends Tagged> {
  readonly kind: 'view'; readonly name: N; readonly from: From;
  readonly state: SchemaInput; readonly initial: () => S; readonly version: number;
  readonly on: readonly AnyTaggedFactory[];
  readonly keyOf: (envelope: Envelope<E>) => string | readonly string[] | undefined;
  readonly evolve: (state: S, event: E, envelope: Envelope<E>) => S;
}
export type AnyView = View<string, any, any, any>;
export function view<const N extends string, const F extends Source, const S extends SchemaInput, const On extends readonly AnyEvent[]>(
  name: N, contract: {
    readonly from: F; readonly state: S; readonly initial: () => Infer<S>; readonly version?: number;
    readonly on: On & readonly Schema<SourceEvent<F>>[];
    readonly keyOf?: (envelope: Envelope<Values<On>>) => string | readonly string[] | undefined;
  }, evolve: (state: Infer<S>, event: Values<On>, envelope: Envelope<Values<On>>) => Infer<S>,
): View<N, Infer<S>, F, Values<On>> {
  return { kind: 'view', name, ...contract, version: contract.version ?? 1, keyOf: contract.keyOf ?? (envelope => envelope.source.id), evolve };
}
export interface Consumer<N extends string, K extends 'policy' | 'projection', E extends Tagged, U extends Uses> {
  readonly kind: K; readonly name: N; readonly from: Source; readonly on: readonly AnyTaggedFactory[];
  readonly uses: U; readonly version: number; readonly batch: number;
  readonly handle: (input: K extends 'policy' ? Envelope<E> : readonly Envelope<E>[], context: ContextOf<U>) => Promise<Result<unknown, Tagged>>;
}
export type AnyConsumer = Consumer<string, 'policy' | 'projection', any, any>;
function consumer(kind: 'policy' | 'projection', name: string, contract: any, body: any): AnyConsumer {
  const uses = contract.uses ?? {};
  validateUses(uses);
  const execute = bindBody(body, uses);
  return {
    kind, name, ...contract, uses, version: contract.version ?? 1, batch: contract.batch?.size ?? 100,
    async handle(input, context) {
      try {
        checkUses(uses, context);
        const result = await execute(input, context);
        tuple(result);
        return result;
      } catch (cause) { return fail(unexpected(cause)); }
    },
  };
}
export interface ConsumerContract<F extends Source, On extends readonly AnyEvent[], U extends Uses> {
  readonly from: F; readonly on: On & readonly Schema<SourceEvent<F>>[]; readonly uses?: U;
  readonly version?: number; readonly batch?: { readonly size: number };
}
export function policy<const N extends string, const F extends Source, const On extends readonly AnyEvent[], const U extends Uses = {}, E extends Tagged = Tagged>(
  name: N, contract: ConsumerContract<F, On, U>, body: Body<[Envelope<Values<On>>], U, unknown, E>,
): Consumer<N, 'policy', Values<On>, U> { return consumer('policy', name, contract, body) as Consumer<N, 'policy', Values<On>, U>; }
export function projection<const N extends string, const F extends Source, const On extends readonly AnyEvent[], const U extends Uses = {}, E extends Tagged = Tagged>(
  name: N, contract: ConsumerContract<F, On, U>, body: Body<[readonly Envelope<Values<On>>[]], U, unknown, E>,
): Consumer<N, 'projection', Values<On>, U> { return consumer('projection', name, contract, body) as Consumer<N, 'projection', Values<On>, U>; }

export interface Stream<N extends string, S extends SchemaInput> {
  readonly kind: 'stream'; readonly name: N; readonly key: Schema<string>; readonly event: S;
}
export function stream<const N extends string, const S extends SchemaInput>(name: N, contract: { readonly key: Schema<string>; readonly event: S }): Stream<N, S> {
  return { kind: 'stream', name, ...contract };
}
export const guard = <S, E extends Tagged>(check: (state: S) => boolean, rejection: () => E) =>
  <I, A, F extends Tagged, U extends Uses>(body: (state: S, input: I, context: ContextOf<U>) => MaybePromise<Result<A, F>>) =>
    (state: S, input: I, context: ContextOf<U>): MaybePromise<Result<A, E | F>> => check(state) ? body(state, input, context) : fail(rejection());
