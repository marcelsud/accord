import {
  aggregate, command, event, fail, integer, match, model, ok, refine, rejection, s, wire,
} from '@marcelsud/accord'

const Cents = refine(integer, (amount) => amount > 0, 'positive cents')
const State = s.object({ open: s.boolean, balance: integer })
const Opened = event('Opened')
const Deposited = event('Deposited', { amount: Cents })
const AlreadyOpen = rejection('AlreadyOpen')
const NotOpen = rejection('NotOpen')

const open = command(
  { state: State, input: {}, events: [Opened], rejects: [AlreadyOpen] },
  (state) => (state.open ? fail(AlreadyOpen()) : ok({ events: [Opened()] })),
)

const deposit = command(
  {
    state: State,
    input: { amount: Cents },
    events: [Deposited],
    rejects: [NotOpen],
    reply: { balance: integer },
  },
  (state, { amount }) => {
    if (!state.open) return fail(NotOpen())
    return ok({ events: [Deposited({ amount })], reply: { balance: state.balance + amount } })
  },
)

const Account = aggregate(
  'Account',
  { state: State, initial: () => ({ open: false, balance: 0 }), commands: { open, deposit } },
  (state, happened) => match(happened, {
    Opened: () => ({ ...state, open: true }),
    Deposited: ({ amount }) => ({ ...state, balance: state.balance + amount }),
  }),
)

const bank = wire(model('Bank', { aggregates: { account: Account } }))

const [opened, openError] = await bank.account.open('a-1', {})
if (openError !== null) throw openError

const [deposited, depositError] = await bank.account.deposit(
  'a-1',
  { amount: 100 },
  { commandId: 'dep-1', expectedVersion: opened.version },
)
if (depositError !== null) throw depositError
if (deposited.reply.balance !== 100) throw new Error('balance')

const [replay, replayError] = await bank.account.deposit('a-1', { amount: 100 }, { commandId: 'dep-1' })
if (replayError !== null) throw replayError
if (replay.reply.balance !== 100 || replay.commandId !== deposited.commandId) throw new Error('replay')

const [, conflict] = await bank.account.deposit('a-1', { amount: 50 }, { commandId: 'dep-1' })
if (conflict?._tag !== 'CommandConflict') throw new Error('conflict')

const [, stale] = await bank.account.deposit('a-1', { amount: 50 }, { expectedVersion: 0 })
if (stale?._tag !== 'Conflict') throw new Error('stale')

const [, invalid] = await bank.account.deposit('a-1', { amount: -5 })
if (invalid?._tag !== 'InvalidInput') throw new Error('invalid')
