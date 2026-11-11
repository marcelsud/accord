import { aggregate, event, fail, model, ok, rejection, string, wire } from '@marcelsud/accord'

const Borrowed = event('Borrowed', { memberId: string })
const NotOnShelf = rejection('NotOnShelf')

class Copy extends aggregate('Copy', {
  status: 'ON_SHELF' as 'ON_SHELF' | 'ON_LOAN',
  holder: null as string | null,
}) {
  borrow(memberId: string) {
    if (this.state.status !== 'ON_SHELF') return fail(NotOnShelf())

    this.state.status = 'ON_LOAN'
    this.state.holder = memberId
    this.emit(Borrowed({ memberId }))
    return ok({ memberId })
  }
}

const local = Copy.create()
const [localReply, localError] = local.borrow('ada')
if (localError !== null) throw localError
if (local.getState().holder !== 'ada' || local.pullEvents().length !== 1) throw new Error('local')
void localReply

const restored = Copy.restore({ status: 'ON_LOAN', holder: 'ada' })
const [, restoredError] = restored.borrow('bea')
if (restoredError?._tag !== 'NotOnShelf') throw new Error('local invariant')
if (restored.getState().holder !== 'ada') throw new Error('local unchanged')

const lending = wire(model('Lending', { aggregates: { copy: Copy } }))
const [first, firstError] = await lending.copy.borrow('copy-1', 'ada')
if (firstError !== null) throw firstError
const [, second] = await lending.copy.borrow('copy-1', 'bea')
if (second?._tag !== 'NotOnShelf') throw new Error('invariant')

const [state, stateError] = await lending.copy.get('copy-1')
if (stateError !== null) throw stateError
if (state.holder !== 'ada' || state.status !== 'ON_LOAN') throw new Error('committed')
const [history, historyError] = await lending.copy.events('copy-1')
if (historyError !== null) throw historyError
if (history.length !== first.events.length) throw new Error('one event')
