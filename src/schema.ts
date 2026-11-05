/** Runtime schemas are values, so shapes work with or without the `s.` prefix. */
export interface Schema<T> {
  readonly parse: (value: unknown) => T;
}
export interface Shape { readonly [key: string]: SchemaInput }
export type SchemaInput = Schema<unknown> | Shape;
export type Infer<S> = S extends Schema<infer T> ? T : S extends Shape ?
  { -readonly [K in keyof S as undefined extends Infer<S[K]> ? never : K]: Infer<S[K]> } &
  { -readonly [K in keyof S as undefined extends Infer<S[K]> ? K : never]?: Infer<S[K]> } : never;

function invalid(expected: string): never {
  throw new TypeError(`Expected ${expected}`);
}
export const string: Schema<string> = { parse: value => typeof value === 'string' ? value : invalid('string') };
export const number: Schema<number> = { parse: value => typeof value === 'number' && Number.isFinite(value) ? value : invalid('finite number') };
export const integer: Schema<number> = { parse: value => typeof value === 'number' && Number.isSafeInteger(value) ? value : invalid('safe integer') };
export const boolean: Schema<boolean> = { parse: value => typeof value === 'boolean' ? value : invalid('boolean') };
export const unknown: Schema<unknown> = { parse: value => value };
export const literal = <const T extends string | number | boolean | null>(expected: T): Schema<T> => ({
  parse: value => value === expected ? expected : invalid(JSON.stringify(expected)),
});
export const optional = <S extends SchemaInput>(schema: S): Schema<Infer<S> | undefined> => ({
  parse: value => value === undefined ? undefined : parse(schema, value),
});
export const nullable = <S extends SchemaInput>(schema: S): Schema<Infer<S> | null> => ({
  parse: value => value === null ? null : parse(schema, value),
});
export const array = <S extends SchemaInput>(schema: S): Schema<Infer<S>[]> => ({
  parse: value => Array.isArray(value) ? value.map(item => parse(schema, item)) : invalid('array'),
});
export const refine = <S extends SchemaInput>(schema: S, check: (value: Infer<S>) => boolean, description: string): Schema<Infer<S>> => ({
  parse: value => {
    const parsed = parse(schema, value);
    return check(parsed) ? parsed : invalid(description);
  },
});
export const union = <const S extends readonly SchemaInput[]>(...schemas: S): Schema<Infer<S[number]>> => ({
  parse: value => {
    for (const schema of schemas) {
      try { return parse(schema, value) as Infer<S[number]>; } catch { /* Try the next alternative. */ }
    }
    return invalid('one of the union alternatives');
  },
});
export function object<const S extends Shape>(shape: S): Schema<Infer<S>> {
  return {
    parse(value) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid('object');
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(shape, key)) throw new TypeError(`Unknown property: ${key}`);
      }
      const output: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(shape)) {
        try {
          const field = parse(schema, Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined);
          if (field !== undefined || Object.hasOwn(value, key)) Object.defineProperty(output, key, { value: field, enumerable: true });
        } catch (cause) {
          throw new TypeError(`Invalid property: ${key}`, { cause });
        }
      }
      return output as Infer<S>;
    },
  };
}
export function parse<S extends SchemaInput>(schema: S, value: unknown): Infer<S> {
  return (typeof schema.parse === 'function' ? (schema as Schema<unknown>).parse(value) : object(schema as Shape).parse(value)) as Infer<S>;
}
export const s = { string, number, integer, int: integer, boolean, unknown, literal, optional, nullable, array, refine, union, object };
