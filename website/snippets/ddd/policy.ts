import {
  aggregate, command, event, fail, match, model, ok, on, policy, rejection, service, string, wire,
} from '@marcelsud/accord'

const MemberState = { heldCopyId: string, releasedFor: string }
const HoldPlaced = event('HoldPlaced', { copyId: string })
const HoldReleased = event('HoldReleased', { copyId: string, eventId: string })
const Returned = event('Returned', { memberId: string })
const NothingHeld = rejection('NothingHeld')
const AlreadyHeld = rejection('AlreadyHeld')

const place = command(
  { state: MemberState, input: { copyId: string }, events: [HoldPlaced], rejects: [AlreadyHeld] },
  (state, { copyId }) => (state.heldCopyId === '' ? ok({ events: [HoldPlaced({ copyId })] }) : fail(AlreadyHeld())),
)

const release = command(
  {
    state: MemberState,
    input: { copyId: string, eventId: string },
    events: [HoldReleased],
    rejects: [NothingHeld],
    reply: { copyId: string },
  },
  (state, input) => {
    if (state.releasedFor === input.eventId) return ok({ events: [], reply: { copyId: input.copyId } })
    if (state.heldCopyId !== input.copyId) return fail(NothingHeld())
    return ok({ events: [HoldReleased(input)], reply: { copyId: input.copyId } })
  },
)

const Member = aggregate(
  'Member',
  { state: MemberState, initial: () => ({ heldCopyId: '', releasedFor: '' }), commands: { place, release } },
  (state, happened) => match(happened, {
    HoldPlaced: ({ copyId }) => ({ heldCopyId: copyId, releasedFor: state.releasedFor }),
    HoldReleased: ({ eventId }) => ({ heldCopyId: '', releasedFor: eventId }),
  }),
)

class Copy extends aggregate('Copy', { holder: null as string | null }) {
  borrow(memberId: string) {
    this.state.holder = memberId
    return ok({ memberId })
  }

  giveBack() {
    if (this.state.holder === null) return fail(NothingHeld())
    const memberId = this.state.holder
    this.state.holder = null
    this.emit(Returned({ memberId }))
    return ok({ memberId })
  }
}

type ReleaseHoldCommand = (
  memberId: string,
  input: { copyId: string; eventId: string },
  commandId: string,
) => Promise<readonly [unknown, { readonly _tag: string } | null]>

const Members = service('Lending/Members', {
  parse(value: unknown) {
    if (!value || typeof value !== 'object' || !('release' in value) || typeof value.release !== 'function') {
      throw new TypeError('Expected members.release')
    }
    return value as { release: ReleaseHoldCommand }
  },
})

const ReleaseHold = policy(
  'ReleaseHold',
  { from: Copy, uses: { members: Members } },
  on(Returned, (happened, { members }, envelope) => members.release(
    happened.memberId,
    { copyId: envelope.source.id, eventId: envelope.id },
    envelope.id,
  )),
)

const Lending = model('Lending', {
  aggregates: { copy: Copy, member: Member },
  policies: [ReleaseHold],
})

// wire() returns the client, so the service closes over a holder filled in just below.
const desk: { release?: ReleaseHoldCommand } = {}
const lending = wire(Lending, {
  services: {
    members: {
      release: (memberId, input, commandId) => {
        const releaseHold = desk.release
        if (releaseHold === undefined) throw new TypeError('Lending runtime is not ready')
        return releaseHold(memberId, input, commandId)
      },
    },
  },
})
desk.release = (memberId, input, commandId) => lending.member.release(memberId, input, { commandId })

const [, placeError] = await lending.member.place('ada', { copyId: 'copy-1' })
if (placeError !== null) throw placeError
const [, borrowError] = await lending.copy.borrow('copy-1', 'ada')
if (borrowError !== null) throw borrowError
const [returned, returnError] = await lending.copy.giveBack('copy-1')
if (returnError !== null) throw returnError
const envelope = returned.events[0]
if (envelope === undefined) throw new Error('event')

const [, deliveryError] = await lending.flush()
if (deliveryError !== null) throw deliveryError
const [, retryError] = await lending.flush()
if (retryError !== null) throw retryError

const [member, memberError] = await lending.member.get('ada')
if (memberError !== null) throw memberError
if (member.heldCopyId !== '' || member.releasedFor !== envelope.id) throw new Error('released')

const [replay, replayError] = await lending.member.release(
  'ada',
  { copyId: envelope.source.id, eventId: envelope.id },
  { commandId: envelope.id },
)
if (replayError !== null) throw replayError
if (replay.reply.copyId !== 'copy-1') throw new Error('replay')
