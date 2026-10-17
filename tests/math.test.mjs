// Unit tests for the split engine embedded in public/index.html.
// Run: node tests/math.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const src = html.slice(html.indexOf('// <math>'), html.indexOf('// </math>'));
const computeSplit = new Function(`${src}; return computeSplit;`)();

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ✓', name); };

const P = [
  { id: 'n', name: 'Nishant', is_host: true },
  { id: 'r', name: 'Rohan' }, { id: 'p', name: 'Priya' }, { id: 'a', name: 'Amit' },
];
const I = [
  { id: 'pbm', total_price_paise: 38000, is_alcohol: false },
  { id: 'nan', total_price_paise: 9000, is_alcohol: false },
  { id: 'bir', total_price_paise: 42000, is_alcohol: false },
  { id: 'kf', total_price_paise: 32000, is_alcohol: true },
];
const C = [
  ['pbm', 'r'], ['pbm', 'p'], ['nan', 'r'], ['nan', 'p'], ['nan', 'a'], ['bir', 'a'], ['kf', 'r'],
].map(([line_item_id, participant_id]) => ({ line_item_id, participant_id }));
const S = { cgst_paise: 3025, sgst_paise: 3025, liquor_vat_paise: 0, service_charge_paise: 6050, grand_total_paise: 133100, actual_paid_paise: 110000 };
const sum = (o) => Object.values(o.people).reduce((a, r) => a + r.paise, 0) + o.unclaimed.paise;

test('Bangalore Bistro case study matches Architecture doc §4.6', () => {
  const o = computeSplit(S, P, I, C);
  assert.equal(o.people.r.paise, 48095);
  assert.equal(o.people.p.paise, 20327);
  assert.equal(o.people.a.paise, 41578);
  assert.equal(o.people.n.paise, 0);
  assert.equal(sum(o), 110000);
  assert.ok(Math.abs(o.mFood - 995 / 890) < 1e-12);
  assert.equal(o.mLiq, 1.05);
});

test('no discount: shares sum to printed grand total', () => {
  const o = computeSplit({ ...S, actual_paid_paise: null }, P, I, C);
  assert.equal(sum(o), 133100);
});

test('non-drinker pays zero liquor VAT', () => {
  const s = { ...S, liquor_vat_paise: 6400, grand_total_paise: 139500, actual_paid_paise: null };
  const o = computeSplit(s, P, I, C);
  const without = computeSplit({ ...s, liquor_vat_paise: 0, grand_total_paise: 133100 }, P, I, C);
  assert.equal(o.people.p.paise, without.people.p.paise); // Priya unchanged
  assert.ok(o.people.r.paise > without.people.r.paise);  // Rohan absorbs VAT
  assert.equal(sum(o), 139500);
});

test('unclaimed items are reported and conservation still holds', () => {
  const o = computeSplit(S, P, I, C.filter((c) => c.line_item_id !== 'bir'));
  assert.equal(o.unclaimed.items.length, 1);
  assert.ok(o.unclaimed.paise > 0);
  assert.equal(sum(o), 110000);
});

test('round-off on printed total is absorbed proportionally', () => {
  const o = computeSplit({ ...S, grand_total_paise: 133000, actual_paid_paise: null }, P, I, C);
  assert.equal(sum(o), 133000);
});

test('VAT printed but no alcohol item: VAT moves to food bucket, nothing lost', () => {
  const items = I.map((i) => ({ ...i, is_alcohol: false }));
  const o = computeSplit({ ...S, liquor_vat_paise: 5000, grand_total_paise: 138100, actual_paid_paise: null }, P, items, C);
  assert.equal(sum(o), 138100);
});

test('awkward 3-way splits never drift by more than host residual', () => {
  const items = [{ id: 'x', total_price_paise: 10000, is_alcohol: false }];
  const claims = ['r', 'p', 'a'].map((pid) => ({ line_item_id: 'x', participant_id: pid }));
  const o = computeSplit({ cgst_paise: 250, sgst_paise: 250, liquor_vat_paise: 0, service_charge_paise: 0, grand_total_paise: 10500 }, P, items, claims);
  assert.deepEqual([o.people.r.paise, o.people.p.paise, o.people.a.paise], [3500, 3500, 3500]);
  assert.equal(o.people.n.paise, 0);
  const o2 = computeSplit({ cgst_paise: 0, sgst_paise: 0, liquor_vat_paise: 0, service_charge_paise: 0, grand_total_paise: 10000 }, P, items, claims);
  assert.equal(sum(o2), 10000);
  assert.equal(Math.abs(o2.people.n.paise) <= 2, true);
});

test('claims from unknown participants are ignored', () => {
  const o = computeSplit(S, P, I, [...C, { line_item_id: 'kf', participant_id: 'ghost' }]);
  assert.equal(o.people.r.paise, 48095);
});

console.log(`\n${passed} tests passed`);
