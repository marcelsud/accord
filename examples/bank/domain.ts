import {
  aggregate,
  event,
  fail,
  integer,
  model,
  ok,
  refine,
  rejection,
  view,
} from "@marcelsud/accord";

const Cents = refine(integer, (value) => value > 0, "positive cents");
const Opened = event("Opened");
const Deposited = event("Deposited", { amount: Cents, balance: integer });
const AlreadyOpen = rejection("AlreadyOpen");
const NotOpen = rejection("NotOpen");

export class Account extends aggregate("Account", { open: false, balance: 0 }) {
  open() {
    if (this.state.open) return fail(AlreadyOpen());

    this.state.open = true;
    this.emit(Opened());
    return ok(undefined);
  }

  deposit(amount: number) {
    if (!this.state.open) return fail(NotOpen());

    const event = Deposited({ amount, balance: this.state.balance + amount });
    this.state.balance = event.balance;
    this.emit(event);
    return ok({ balance: event.balance });
  }
}

const Summary = view(
  "Summary",
  {
    from: Account,
    on: [Deposited],
    state: { balance: integer },
    initial: () => ({ balance: 0 }),
  },
  (_state, { balance }) => ({ balance }),
);

export const Bank = model("Bank", {
  aggregates: { account: Account },
  views: { summary: Summary },
});
