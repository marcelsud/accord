export interface Tagged { readonly _tag: string }
export type Result<T, E extends Tagged> = readonly [value: T, error: null] | readonly [value: unknown, error: E];
export type ResultValue<T> = T extends readonly [infer V, null] ? V : never;
export type ResultError<T> = T extends readonly [unknown, infer E extends Tagged] ? E : never;
export type Unexpected = Error & { readonly _tag: 'Unexpected' };
export type InvalidInput = { readonly _tag: 'InvalidInput'; readonly message: string };
export const ok = <T>(value: T): readonly [T, null] => [value, null];
export const fail = <E extends Tagged>(error: E): readonly [unknown, E] => [null, error];
export const unexpected = (cause: unknown): Unexpected => Object.assign(
  new Error('Unexpected failure', { cause }), { _tag: 'Unexpected' as const },
);
export type Attempt<T> = [T] extends [never] ? Result<never, Unexpected> : T extends PromiseLike<infer U> ? Result<Awaited<U>, Unexpected> | Promise<Result<Awaited<U>, Unexpected>> : Result<T, Unexpected>;
export function trycatch<T>(task: () => T): Attempt<T>;
export function trycatch<T>(task: PromiseLike<T>): Promise<Result<Awaited<T>, Unexpected>>;
export function trycatch(task: (() => unknown) | PromiseLike<unknown>): Result<unknown, Unexpected> | Promise<Result<unknown, Unexpected>> {
  if (typeof task !== 'function') return Promise.resolve().then(() => task).then(ok, cause => fail(unexpected(cause)));
  try {
    const value = task();
    if (value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as PromiseLike<unknown>).then === 'function') {
      return Promise.resolve(value).then(ok, cause => fail(unexpected(cause)));
    }
    return ok(value);
  } catch (cause) { return fail(unexpected(cause)); }
}
export type MatchCases<U extends Tagged> = { [K in U['_tag']]: (value: Extract<U, { _tag: K }>) => unknown };
export function match<U extends Tagged, const C extends MatchCases<U>>(
  value: U, cases: C & Record<Exclude<keyof C, U['_tag']>, never>,
): C[keyof C] extends (...args: never[]) => infer R ? R : never {
  if (!Object.hasOwn(cases, value._tag)) throw new TypeError(`Unhandled tag: ${value._tag}`);
  // The exhaustive mapped type checks each handler against its corresponding tag.
  const handler = (cases as Record<string, (value: U) => unknown>)[value._tag]!;
  return handler(value) as C[keyof C] extends (...args: never[]) => infer R ? R : never;
}
