import { Effect } from "effect";
import { effectify } from "@marcelsud/accord/effect";
import { command, integer, service } from "@marcelsud/accord";
import { Balance, Cents, Deposited, NotOpen, State } from "./pure.js";

export const DepositRules = service("DepositRules", { maximum: integer });
export const limitedDeposit = command(
  {
    state: State,
    input: { amount: Cents },
    events: [Deposited],
    rejects: [NotOpen],
    reply: Balance,
    uses: { rules: DepositRules },
  },
  effectify((state, { amount }) =>
    Effect.gen(function* () {
      const rules = yield* effectify(DepositRules);
      if (!state.open || amount > rules.maximum)
        return yield* Effect.fail(NotOpen());
      return {
        events: [Deposited({ amount })],
        reply: { balance: state.balance + amount },
      };
    }),
  ),
);

const program = Effect.gen(function* () {
  const decision = yield* effectify(limitedDeposit)(
    { open: true, balance: 0 },
    { amount: 100 },
  );
  return decision.reply.balance;
});
const balance = await Effect.runPromise(
  Effect.provideService(program, effectify(DepositRules), { maximum: 1_000 }),
);
console.log(balance); // 100
