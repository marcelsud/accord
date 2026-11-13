import { aggregate, event, fail, integer, model, ok, rejection, service, wire } from '@marcelsud/accord'

const LoanOpened = event('LoanOpened', { openLoans: integer })
const LoanLimit = rejection('LoanLimit', { maximum: integer })
const LoanRules = service('LoanRules', { maximumOpen: integer })

const Member = aggregate(
  'Member',
  { openLoans: 0 },
  ({ state, emit, rules }) => ({
    borrow() {
      if (state.openLoans >= rules.maximumOpen) return fail(LoanLimit({ maximum: rules.maximumOpen }))
      state.openLoans += 1
      emit(LoanOpened({ openLoans: state.openLoans }))
      return ok({ openLoans: state.openLoans })
    },
  }),
  { uses: { rules: LoanRules } },
)

const lending = wire(model('Lending', { aggregates: { member: Member } }), {
  services: { rules: { maximumOpen: 2 } },
})

const [first, firstError] = await lending.member.borrow('ada')
if (firstError !== null || first.reply.openLoans !== 1) throw firstError ?? new Error('first')
const [, secondError] = await lending.member.borrow('ada')
if (secondError !== null) throw secondError
const [, third] = await lending.member.borrow('ada')
if (third?._tag !== 'LoanLimit' || third.maximum !== 2) throw new Error('limit')

const [state, stateError] = await lending.member.get('ada')
if (stateError !== null) throw stateError
if (state.openLoans !== 2) throw new Error('unchanged')
