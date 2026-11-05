import { parse, type Infer, type SchemaInput } from './schema.js';
import { fail, ok, unexpected, type Result, type ResultError, type ResultValue, type Tagged, type Unexpected } from './result.js';
import { bindBody, tuple, validateUses, checkUses, checkError, type AdaptedBody, type AnyTaggedFactory, type AnyRejection, type ContextOf, type ExecutionContext, type MaybePromise, type Requirements, type Uses, type Values } from './definitions.js';

export interface StepContext extends ExecutionContext { readonly commandId: string; readonly idempotencyKey: string }
export interface WorkflowContext<U extends Uses> extends ExecutionContext {
  readonly services: ContextOf<U>;
  readonly step: <T extends Result<unknown, Tagged>>(name: string, task: (context: StepContext) => MaybePromise<T>, options?: {
    readonly compensate?: (value: NoInfer<ResultValue<T>>, context: StepContext) => MaybePromise<Result<unknown, Tagged>>;
  }) => Promise<Result<ResultValue<T>, ResultError<T> | Unexpected>>;
  readonly wait: <S extends SchemaInput>(name: string, schema: S) => Promise<Result<Infer<S>, Unexpected>>;
  readonly sleep: (name: string, milliseconds: number) => Promise<Result<void, Unexpected>>;
}
export interface Workflow<N extends string, I, R, E extends Tagged, U extends Uses> {
  readonly kind: 'workflow'; readonly name: N;
  readonly input: SchemaInput; readonly reply: SchemaInput;
  readonly rejects: readonly AnyTaggedFactory[]; readonly uses: U;
  readonly key: (input: I) => string;
  readonly handle: (input: I, context: WorkflowContext<U>) => MaybePromise<Result<R, E | Unexpected>>;
}
export type AnyWorkflow = Workflow<string, any, any, any, any>;
export function workflow<
  const N extends string, const I extends SchemaInput, const R extends SchemaInput,
  const Re extends readonly AnyRejection[] = readonly [], const U extends Uses = {},
>(name: N, contract: {
  readonly input: I; readonly reply: R; readonly key: (input: Infer<I>) => string;
  readonly rejects?: Re; readonly uses?: U;
}, body: ((input: Infer<I>, context: WorkflowContext<U>) => MaybePromise<Result<Infer<R>, Values<Re> | Unexpected>>)
  | AdaptedBody<[Infer<I>], Infer<R>, Values<Re> | Unexpected, Requirements<U>>,
): Workflow<N, Infer<I>, Infer<R>, Values<Re>, U> {
  const uses = (contract.uses ?? {}) as U;
  validateUses(uses);
  const execute = bindBody(body, uses);
  return { kind: 'workflow', name, ...contract, rejects: contract.rejects ?? [], uses, handle: (input, context) => execute(input, { ...context.services, ...context }) };
}
export interface RunRecord {
  readonly input: unknown;
  readonly steps: Map<string, unknown>;
  readonly compensated: Set<string>;
  readonly deadlines: Map<string, number>;
  readonly signals: Map<string, unknown>;
  readonly waiters: Map<string, Set<(value: unknown) => void>>;
  result?: Result<unknown, Tagged>;
}
export function makeRun(input: unknown): RunRecord {
  return { input: structuredClone(input), steps: new Map(), compensated: new Set(), deadlines: new Map(), signals: new Map(), waiters: new Map() };
}
function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Workflow interrupted');
}
function copyResult(result: Result<unknown, Tagged>): Result<unknown, Tagged> {
  if (result[1] instanceof Error) return fail(unexpected(result[1].cause));
  return structuredClone(result);
}
export async function executeWorkflow(
  definition: AnyWorkflow, key: string, input: unknown, record: RunRecord,
  services: ContextOf<any>, options: ExecutionContext,
): Promise<Result<unknown, Tagged>> {
  if (record.result) return copyResult(record.result);
  const compensations: Array<{ name: string; run: () => MaybePromise<Result<unknown, Tagged>> }> = [];
  const names = new Set<string>();
  const claim = (name: string) => {
    if (!name || names.has(name)) throw new TypeError(`Duplicate or empty workflow step: ${name}`);
    names.add(name);
  };
  const context: WorkflowContext<any> = {
    ...options, services,
    async step(name, task, stepOptions) {
      try {
        aborted(options.signal);
        claim(name);
        const meta = { ...options, commandId: `${key}:${name}`, idempotencyKey: `${key}:${name}` };
        let value: unknown;
        if (record.steps.has(name)) value = structuredClone(record.steps.get(name));
        else {
          const result = await task(meta);
          tuple(result);
          const [output, error] = result;
          if (error !== null) return fail(error) as never;
          value = structuredClone(output);
          record.steps.set(name, value);
        }
        if (stepOptions?.compensate) {
          const compensate = stepOptions.compensate;
          const { signal: _signal, ...undoMeta } = meta;
          compensations.push({ name, run: () => compensate(structuredClone(value) as never, { ...undoMeta, commandId: `${key}:${name}:undo`, idempotencyKey: `${key}:${name}:undo` }) });
        }
        return ok(value) as never;
      } catch (cause) { return fail(unexpected(cause)); }
    },
    async wait(name, schema) {
      try {
        aborted(options.signal);
        claim(name);
        if (record.signals.has(name)) return ok(parse(schema, record.signals.get(name)));
        const value = await new Promise<unknown>((resolve, reject) => {
          const listeners = record.waiters.get(name) ?? new Set();
          record.waiters.set(name, listeners);
          const cleanup = () => { listeners.delete(receive); options.signal?.removeEventListener('abort', cancel); };
          const receive = (value: unknown) => { cleanup(); resolve(value); };
          const cancel = () => { cleanup(); reject(options.signal?.reason ?? new Error('Workflow interrupted')); };
          listeners.add(receive);
          options.signal?.addEventListener('abort', cancel, { once: true });
          if (options.signal?.aborted) cancel();
        });
        return ok(parse(schema, value));
      } catch (cause) { return fail(unexpected(cause)); }
    },
    async sleep(name, milliseconds) {
      try {
        aborted(options.signal);
        claim(name);
        if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2 ** 31 - 1) throw new TypeError('Invalid sleep duration');
        const deadline = record.deadlines.get(name) ?? Date.now() + milliseconds;
        record.deadlines.set(name, deadline);
        await new Promise<void>((resolve, reject) => {
          const finish = () => { options.signal?.removeEventListener('abort', cancel); resolve(); };
          const timer = setTimeout(finish, Math.max(0, deadline - Date.now()));
          const cancel = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); reject(options.signal?.reason ?? new Error('Workflow interrupted')); };
          options.signal?.addEventListener('abort', cancel, { once: true });
          if (options.signal?.aborted) cancel();
        });
        return ok(undefined);
      } catch (cause) { return fail(unexpected(cause)); }
    },
  };
  let result: Result<unknown, Tagged>;
  try {
    checkUses(definition.uses, services);
    result = await definition.handle(input, context);
    tuple(result);
    const [value, error] = result;
    if (error === null) result = ok(parse(definition.reply, value));
    else result = fail(checkError(definition.rejects, error));
  } catch (cause) { result = fail(unexpected(cause)); }
  // Cancellation leaves successful checkpoints available for another invocation.
  if (options.signal?.aborted) return fail(unexpected(options.signal.reason));
  if (result[1] !== null) {
    for (const compensation of compensations.reverse()) {
      if (record.compensated.has(compensation.name)) continue;
      try {
        const outcome = await compensation.run();
        tuple(outcome);
        if (outcome[1] !== null) return fail(unexpected({ step: compensation.name, compensation: outcome[1], original: result[1] }));
        record.compensated.add(compensation.name);
      } catch (cause) { return fail(unexpected(cause)); }
    }
  }
  record.result = copyResult(result);
  return copyResult(result);
}
