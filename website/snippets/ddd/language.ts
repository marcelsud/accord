import { aggregate, event, memory, model, ok, string, wire } from '@marcelsud/accord'

const BookCatalogued = event('BookCatalogued', { title: string })
const Borrowed = event('Borrowed', { memberId: string })

const Book = aggregate('Book', { title: '' }, ({ state, emit }) => ({
  catalog(title: string) {
    state.title = title
    emit(BookCatalogued({ title }))
    return ok({ title })
  },
}))

const Copy = aggregate('Copy', { holder: null as string | null }, ({ state, emit }) => ({
  borrow(memberId: string) {
    state.holder = memberId
    emit(Borrowed({ memberId }))
    return ok({ memberId })
  },
}))

// Catalog and Lending are separate bounded contexts. They can share a process
// store; the model name is part of every stream key.
const storage = memory()
const Catalog = model('Catalog', { aggregates: { book: Book } })
const Lending = model('Lending', { aggregates: { copy: Copy } })
const catalog = wire(Catalog, { storage })
const lending = wire(Lending, { storage })

const [, bookError] = await catalog.book.catalog('isbn-1', 'Domain-Driven Design')
if (bookError !== null) throw bookError
const [, copyError] = await lending.copy.borrow('isbn-1', 'ada')
if (copyError !== null) throw copyError

const [book, bookReadError] = await catalog.book.get('isbn-1')
if (bookReadError !== null) throw bookReadError
const [copy, copyReadError] = await lending.copy.get('isbn-1')
if (copyReadError !== null) throw copyReadError
if (book.title !== 'Domain-Driven Design' || copy.holder !== 'ada') throw new Error('state')

const [bookEvents, bookHistoryError] = await catalog.book.events('isbn-1')
if (bookHistoryError !== null) throw bookHistoryError
const [copyEvents, copyHistoryError] = await lending.copy.events('isbn-1')
if (copyHistoryError !== null) throw copyHistoryError
const bookStream = bookEvents[0]?.stream
const copyStream = copyEvents[0]?.stream
if (bookStream === undefined || copyStream === undefined || bookStream === copyStream) {
  throw new Error('contexts')
}
