'use strict';
// Run with: node test.js
const assert = require('assert');
const { parseCsv, toNested } = require('./csv-to-nested-json.js');

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name + ': ' + e.message); process.exitCode = 1; }
}

check('comma delimiter, quoted comma stays inside one field', () => {
  const { delimiter, header, rows, ragged } = parseCsv('order_id,customer,item,qty\nA1,"Doe, Jane",Widget,2\nA1,"Doe, Jane",Gadget,1\nB2,"Smith, John","Bolt, 3/8",4\n');
  assert.strictEqual(delimiter, ',');
  assert.deepStrictEqual(header, ['order_id', 'customer', 'item', 'qty']);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].customer, 'Doe, Jane');
  assert.strictEqual(rows[2].item, 'Bolt, 3/8');
  assert.deepStrictEqual(ragged, []);
});

check('semicolon export is detected, not read as one column', () => {
  const { delimiter, header, rows } = parseCsv('order_id;qty\nA1;2\n');
  assert.strictEqual(delimiter, ';');
  assert.deepStrictEqual(header, ['order_id', 'qty']);
  assert.strictEqual(rows[0].qty, '2');
});

check('BOM and trailing blank lines do not create a phantom row', () => {
  const { header, rows } = parseCsv('\ufefforder_id,qty\nA1,2\n\n\n');
  assert.deepStrictEqual(header, ['order_id', 'qty']);
  assert.strictEqual(rows.length, 1);
});

check('CRLF line endings parse cleanly', () => {
  const { rows } = parseCsv('order_id,qty\r\nA1,2\r\nB2,3\r\n');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1].order_id, 'B2');
});

check('short row is reported with its line number, the n8n Invalid Record Length shape', () => {
  const { ragged } = parseCsv('order_id,customer,item\nA1,"Doe, Jane",Widget\nA1,"Doe, Jane"\n');
  assert.strictEqual(ragged.length, 1);
  assert.deepStrictEqual(ragged[0], { line: 3, expected: 3, got: 2 });
});

check('a field with an embedded newline stays one record', () => {
  const { rows } = parseCsv('order_id,note\nA1,"line one\nline two"\nB2,plain\n');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].note, 'line one\nline two');
});

check('TSV whose text contains commas is split on tabs', () => {
  const { delimiter, header } = parseCsv('order_id\titem\nA1\tBolt, 3/8\n');
  assert.strictEqual(delimiter, '\t');
  assert.deepStrictEqual(header, ['order_id', 'item']);
});

check('nested output: repeated key becomes one parent with a child array', () => {
  const { rows } = parseCsv('order_id,customer,item,qty\nA1,"Doe, Jane",Widget,2\nA1,"Doe, Jane",Gadget,1\nB2,"Smith, John","Bolt, 3/8",4\n');
  const nested = toNested(rows, 'order_id', 'items');
  assert.strictEqual(nested.length, 2);
  assert.strictEqual(nested[0].order_id, 'A1');
  assert.strictEqual(nested[0].customer, 'Doe, Jane');
  assert.strictEqual(nested[0].items.length, 2);
  assert.strictEqual(nested[0].items[1].item, 'Gadget');
  assert.strictEqual(nested[1].items.length, 1);
});

check('a group where no column varies keeps its columns on the child, not an empty object', () => {
  const { rows } = parseCsv('order_id,customer,item\nA1,"Doe, Jane",Widget\nA1,"Doe, Jane",Widget\n');
  const nested = toNested(rows, 'order_id', 'items');
  assert.strictEqual(nested.length, 1);
  assert.deepStrictEqual(nested[0].items[0], { customer: 'Doe, Jane', item: 'Widget' });
  assert.deepStrictEqual(Object.keys(nested[0]).sort(), ['items', 'order_id']);
});

check('identical columns stay on the parent, only the differing ones go to the child', () => {
  const { rows } = parseCsv('order_id,customer,item\nA1,"Doe, Jane",Widget\nA1,"Doe, Jane",Gadget\n');
  const nested = toNested(rows, 'order_id', 'items');
  assert.strictEqual(nested[0].customer, 'Doe, Jane');
  assert.deepStrictEqual(Object.keys(nested[0].items[0]), ['item']);
});

check('single data row still yields one parent and one child', () => {
  const { rows } = parseCsv('order_id,item\nA1,Widget\n');
  const nested = toNested(rows, 'order_id', 'items');
  assert.strictEqual(nested.length, 1);
  assert.deepStrictEqual(nested[0], { order_id: 'A1', items: [{ item: 'Widget' }] });
});

check('empty input returns no rows instead of throwing', () => {
  const { rows } = parseCsv('');
  assert.deepStrictEqual(rows, []);
  assert.deepStrictEqual(toNested(rows, 'order_id', 'items'), []);
});

console.log('\n' + passed + ' checks passed');
