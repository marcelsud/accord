import { aggregate, event, fail, match, model, ok, rejection, string, wire } from '@marcelsud/accord'

const Borrowed = event('Borrowed', { memberId: string })
const NotOnShelf = rejection('NotOnShelf')

class Copy extends aggregate('Copy', { status: 'ON_SHELF' as 'ON_SHELF' | 'ON_LOAN' }) {
  borrow(memberId: string) {
    if (this.state.status !== 'ON_SHELF') return fail(NotOnShelf())
    this.state.status = 'ON_LOAN'
    this.emit(Borrowed({ memberId }))
    return ok({ memberId })
  }
}

const lending = wire(model('Lending', { aggregates: { copy: Copy } }))
const [first, firstError] = await lending.copy.borrow('copy-1', 'ada')
if (firstError !== null) throw firstError

const [, second] = await lending.copy.borrow('copy-1', 'bea')
if (second === null) throw new Error('expected NotOnShelf')

const message = match(second, {
  NotOnShelf: () => 'already on loan',
  InvalidInput: ({ message: detail }) => detail,
  Unexpected: () => 'unexpected',
})
if (message !== 'already on loan') throw new Error(message)

const [history, historyError] = await lending.copy.events('copy-1')
if (historyError !== null) throw historyError
if (history.length !== 1 || first.events.length !== 1) throw new Error('no second event')
