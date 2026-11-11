import {
  aggregate, command, event, external, fail, match, model, ok, rejection, string, unexpected, wire,
} from '@marcelsud/accord'

const BookState = { isbn: string, title: string }
const BookRegistered = event('BookRegistered', { isbn: string, title: string })
const UnknownSku = rejection('UnknownSku', { sku: string })
const AlreadyRegistered = rejection('AlreadyRegistered')

const VendorCatalog = external(
  'VendorCatalog',
  { input: { sku: string }, reply: { isbn: string, title: string }, rejects: [UnknownSku] },
  async (input) => {
    if (input.sku === 'missing') return fail(UnknownSku({ sku: input.sku }))
    return ok({ isbn: `978${input.sku}`, title: 'Domain-Driven Design' })
  },
)

const register = command(
  {
    state: BookState,
    input: { sku: string },
    events: [BookRegistered],
    rejects: [UnknownSku, AlreadyRegistered],
    reply: { isbn: string, title: string },
    uses: { catalog: VendorCatalog },
  },
  async (state, { sku }, { catalog }) => {
    if (state.isbn !== '') return fail(AlreadyRegistered())
    const [book, error] = await catalog({ sku })
    if (error !== null) return error._tag === 'UnknownSku' ? fail(error) : fail(unexpected(error))
    return ok({
      events: [BookRegistered({ isbn: book.isbn, title: book.title })],
      reply: { isbn: book.isbn, title: book.title },
    })
  },
)

const Book = aggregate(
  'Book',
  { state: BookState, initial: () => ({ isbn: '', title: '' }), commands: { register } },
  (state, happened) => match(happened, {
    BookRegistered: ({ isbn, title }) => ({ ...state, isbn, title }),
  }),
)

const catalog = wire(model('Catalog', { aggregates: { book: Book } }), {
  services: { catalog: VendorCatalog.implement({}) },
})

const [, missing] = await catalog.book.register('book-1', { sku: 'missing' })
if (missing?._tag !== 'UnknownSku') throw new Error('sku')

const [registered, registerError] = await catalog.book.register('book-1', { sku: '0321125215' })
if (registerError !== null) throw registerError
if (registered.reply.isbn !== '9780321125215' || registered.reply.title !== 'Domain-Driven Design') {
  throw new Error('translated')
}

const [state, stateError] = await catalog.book.get('book-1')
if (stateError !== null) throw stateError
if ('sku' in state) throw new Error('vendor shape leaked')
