import { aggregate, event, model, ok, refine, string, trycatch, vo, wire } from '@marcelsud/accord'

class Email extends vo('Email', refine(string, (value) => value.includes('@'), 'email')) {
  domain(): string {
    const raw = this.snapshot()
    return raw.slice(raw.indexOf('@') + 1)
  }
}

const Registered = event('Registered', { email: string, domain: string })

class Member extends aggregate('Member', { email: '' }) {
  register(raw: string) {
    const email = Email.of(raw)
    this.state.email = email.snapshot()
    this.emit(Registered({ email: email.snapshot(), domain: email.domain() }))
    return ok({ domain: email.domain() })
  }
}

const [rejected, rejectedError] = trycatch(() => Email.of('not-an-email'))
if (rejectedError === null) throw new Error('expected invalid email')
void rejected

const lending = wire(model('Lending', { aggregates: { member: Member } }))
const [ada, adaError] = await lending.member.register('ada', 'ada@library.test')
if (adaError !== null) throw adaError
const [bea, beaError] = await lending.member.register('bea', 'ada@library.test')
if (beaError !== null) throw beaError
if (ada.reply.domain !== 'library.test' || bea.reply.domain !== 'library.test') throw new Error('domain')

const [adaState, adaReadError] = await lending.member.get('ada')
const [beaState, beaReadError] = await lending.member.get('bea')
if (adaReadError !== null || beaReadError !== null) throw adaReadError ?? beaReadError
if (adaState.email !== beaState.email) throw new Error('value')

const [, invalid] = await lending.member.register('cy', 'nope')
if (invalid?._tag !== 'Unexpected') throw new Error('boundary')
