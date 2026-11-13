import { aggregate, event, model, ok, string, wire } from '@marcelsud/accord'

const Borrowed = event('Borrowed', { memberId: string })

class Copy extends aggregate('Copy', { holder: null as string | null }) {
  borrow(memberId: string) {
    const happened = Borrowed({ memberId })
    this.state.holder = happened.memberId
    this.emit(happened)
    return ok({ memberId: happened.memberId })
  }
}

const lending = wire(model('Lending', { aggregates: { copy: Copy } }))
const [receipt, error] = await lending.copy.borrow('copy-1', 'ada')
if (error !== null) throw error

const envelope = receipt.events[0]
if (envelope === undefined) throw new Error('event')
const happened = Borrowed.parse(envelope.event)
if (happened.memberId !== 'ada') throw new Error('payload')
if (envelope.source.type !== 'Copy' || envelope.source.id !== 'copy-1') throw new Error('source')
if (envelope.seq !== 1 || envelope.id !== `${envelope.stream}:1`) throw new Error('identity')

const [history, historyError] = await lending.copy.events('copy-1', { after: 0 })
if (historyError !== null) throw historyError
if (history.length !== 1 || history[0]?.id !== envelope.id) throw new Error('history')
