import assert from 'node:assert/strict';
import test from 'node:test';
import { array, integer, string, vo } from '../src/index.js';

class Balance extends vo('Balance', integer) {
  inc(amount: number): Balance {
    return Balance.of(this.value + amount);
  }
}

test('value objects validate construction and snapshot raw data', () => {
  const balance = Balance.of(100);
  assert.ok(balance instanceof Balance);
  assert.equal(balance.inc(50).snapshot(), 150);
  assert.equal(balance.snapshot(), 100);
  assert.throws(() => Balance.of(1.5), /safe integer/);
  assert.throws(() => new Balance(Number.NaN), /safe integer/);
});

test('snapshot projections receive a detached copy of the value', () => {
  class Labels extends vo('Labels', { names: array(string) }) {}

  const labels = Labels.of({ names: ['original'] });
  const snapshot = labels.snapshot();
  snapshot.names.push('snapshot');

  const projected = labels.snapshot(({ names }) => {
    names.push('projected');
    return { labels: names };
  });
  assert.deepEqual(projected, { labels: ['original', 'projected'] });
  assert.deepEqual(labels.snapshot(), { names: ['original'] });
});
