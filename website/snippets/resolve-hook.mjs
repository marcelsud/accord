const dist = new URL('../../dist/', import.meta.url)

const aliases = new Map([
  ['@marcelsud/accord', new URL('index.js', dist).href],
  ['@marcelsud/accord/sqlite', new URL('sqlite.js', dist).href],
])

export async function resolve(specifier, context, nextResolve) {
  const aliased = aliases.get(specifier)
  if (aliased) return nextResolve(aliased, context)
  return nextResolve(specifier, context)
}
