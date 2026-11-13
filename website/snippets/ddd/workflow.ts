import {
  aggregate, command, event, fail, literal, match, model, ok, rejection, string, unexpected, union, wire, workflow,
  type Result, type RuntimeError,
} from '@marcelsud/accord'

const Status = union(literal('IN'), literal('OUT'))
const CopyState = { status: Status }
const Borrowed = event('Borrowed', { memberId: string })
const Returned = event('Returned')
const NotOnShelf = rejection('NotOnShelf')
const NotOnLoan = rejection('NotOnLoan')
const CheckoutFailed = rejection('CheckoutFailed')

const borrow = command(
  {
    state: CopyState,
    input: { memberId: string },
    events: [Borrowed],
    rejects: [NotOnShelf],
    reply: { status: Status },
  },
  (state, { memberId }) => (state.status === 'IN'
    ? ok({ events: [Borrowed({ memberId })], reply: { status: 'OUT' as const } })
    : fail(NotOnShelf())),
)

const returnCopy = command(
  { state: CopyState, input: {}, events: [Returned], rejects: [NotOnLoan] },
  (state) => (state.status === 'OUT' ? ok({ events: [Returned()] }) : fail(NotOnLoan())),
)

const Copy = aggregate(
  'Copy',
  { state: CopyState, initial: () => ({ status: 'IN' as const }), commands: { borrow, returnCopy } },
  (state, happened) => match(happened, {
    Borrowed: () => ({ ...state, status: 'OUT' as const }),
    Returned: () => ({ ...state, status: 'IN' as const }),
  }),
)

type CopyFailure = ReturnType<typeof NotOnShelf> | ReturnType<typeof NotOnLoan> | RuntimeError
type CopyClient = {
  borrow: (
    id: string,
    input: { memberId: string },
    options: { commandId: string },
  ) => Promise<Result<{ readonly reply: { readonly status: 'IN' | 'OUT' } }, CopyFailure>>
  returnCopy: (
    id: string,
    input: Record<string, never>,
    options: { commandId: string },
  ) => Promise<Result<unknown, CopyFailure>>
}

const client: { copy?: CopyClient } = {}

const Checkout = workflow(
  'Checkout',
  {
    input: { memberId: string, copyId: string },
    reply: { status: Status },
    key: (input) => input.copyId,
    rejects: [CheckoutFailed, NotOnShelf, NotOnLoan],
  },
  async (input, run) => {
    const copy = client.copy
    if (copy === undefined) return fail(CheckoutFailed())

    const [, borrowError] = await run.step(
      'borrow',
      (meta) => copy.borrow(input.copyId, { memberId: input.memberId }, { commandId: meta.commandId }),
      { compensate: (_value, meta) => copy.returnCopy(input.copyId, {}, { commandId: meta.commandId }) },
    )
    if (borrowError !== null) {
      return fail(borrowError._tag === 'NotOnShelf' ? NotOnShelf() : unexpected(borrowError))
    }

    const [, labelError] = await run.step('label', () => fail(CheckoutFailed()))
    if (labelError !== null) return fail(labelError)
    return ok({ status: 'OUT' as const })
  },
)

const lending = wire(model('Desk', { aggregates: { copy: Copy }, workflows: { checkout: Checkout } }))
client.copy = {
  borrow: (id, input, options) => lending.copy.borrow(id, input, options),
  returnCopy: (id, input, options) => lending.copy.returnCopy(id, input, options),
}

const [, failed] = await lending.workflows.checkout({ memberId: 'ada', copyId: 'copy-1' })
if (failed?._tag !== 'CheckoutFailed') throw new Error('saga')
const [state, stateError] = await lending.copy.get('copy-1')
if (stateError !== null) throw stateError
if (state.status !== 'IN') throw new Error('compensated')
