// #region words
import {
  aggregate, event, fail, model, ok, on, rejection, story, string, view, wire,
} from '@marcelsud/accord'

const Borrowed = event('Borrowed', { memberId: string })
const NotOnShelf = rejection('NotOnShelf')
// #endregion words

// #region aggregate
class Copy extends aggregate('Copy', {
  status: 'ON_SHELF' as 'ON_SHELF' | 'ON_LOAN',
  holder: null as string | null,
}) {
  borrow(memberId: string) {
    if (this.state.status !== 'ON_SHELF') return fail(NotOnShelf())
    this.state.status = 'ON_LOAN'
    this.state.holder = memberId
    this.emit(Borrowed({ memberId }))
    return ok({ status: this.state.status })
  }
}
// #endregion aggregate

// #region read-model
const OnLoan = view(
  'OnLoan',
  { from: Copy, initial: { loans: 0 } },
  on(Borrowed, (state) => ({ loans: state.loans + 1 })),
)
// #endregion read-model

// #region wire
const Lending = model('Lending', { aggregates: { copy: Copy }, views: { onLoan: OnLoan } })
const lending = wire(Lending)

const [receipt, error] = await lending.copy.borrow('copy-1', 'ada')
if (error !== null) throw error
const [, second] = await lending.copy.borrow('copy-1', 'bea')
if (second?._tag !== 'NotOnShelf') throw new Error('invariant')

const [loans, loansError] = await lending.onLoan.get('copy-1', { atLeast: receipt })
if (loansError !== null) throw loansError
if (loans?.loans !== 1) throw new Error('view')
// #endregion wire

// #region story
const [status, storyError] = await story(Lending, async (test) => {
  const [borrowed, borrowError] = await test.bank.copy.borrow('copy-2', 'ada')
  if (borrowError !== null) return fail(borrowError)
  test.equal(borrowed.reply.status, 'ON_LOAN')
  const [row, rowError] = await test.bank.onLoan.get('copy-2', { atLeast: borrowed })
  if (rowError !== null) return fail(rowError)
  test.equal(row?.loans, 1)
  return ok(borrowed.reply.status)
})
if (storyError !== null) throw storyError
if (status !== 'ON_LOAN') throw new Error('story')
// #endregion story
