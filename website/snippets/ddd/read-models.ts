import { aggregate, event, model, ok, on, projection, string, trycatch, view, wire } from '@marcelsud/accord'
import { sqlite } from '@marcelsud/accord/sqlite'

const Borrowed = event('Borrowed', { memberId: string })

class Copy extends aggregate('Copy', { loans: 0 }) {
  borrow(memberId: string) {
    this.state.loans += 1
    this.emit(Borrowed({ memberId }))
    return ok({ loans: this.state.loans })
  }
}

using storage = sqlite(':memory:')
storage.database.exec(`
  CREATE TABLE loan_log (
    event_id TEXT PRIMARY KEY,
    copy_id TEXT NOT NULL,
    member_id TEXT NOT NULL
  ) STRICT
`)
const insert = storage.database.prepare(
  'INSERT INTO loan_log(event_id, copy_id, member_id) VALUES (?, ?, ?) ON CONFLICT(event_id) DO NOTHING',
)
const count = storage.database.prepare('SELECT COUNT(*) AS n FROM loan_log')

const OnLoan = view(
  'OnLoan',
  { from: Copy, initial: { loans: 0 } },
  on(Borrowed, (state) => ({ loans: state.loans + 1 })),
)

const LoanLog = projection('LoanLog', { from: Copy, on: [Borrowed] }, (batch) => trycatch(() => {
  for (const { id, source, event: happened } of batch) insert.run(id, source.id, happened.memberId)
}))

const lending = wire(model('Lending', {
  aggregates: { copy: Copy },
  views: { onLoan: OnLoan },
  projections: [LoanLog],
}), { storage })

const [receipt, error] = await lending.copy.borrow('copy-1', 'ada')
if (error !== null) throw error
const [row, rowError] = await lending.onLoan.get('copy-1', { atLeast: receipt })
if (rowError !== null) throw rowError
if (row?.loans !== 1) throw new Error('view')

const [, flushError] = await lending.flush()
if (flushError !== null) throw flushError
const logged = count.get()
if (!logged || Number(logged.n) !== 1) throw new Error('projection')
