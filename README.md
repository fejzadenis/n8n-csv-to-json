# n8n CSV to JSON

Turn a flat CSV into parent/child JSON in n8n, so one order with five line items becomes one item with a five-row `items` array instead of five duplicate orders.

The code here is the same parser and grouping logic used in the browser converter at [fejzadenis.github.io/leadflow/csv-to-json-n8n.html](https://fejzadenis.github.io/leadflow/csv-to-json-n8n.html), which was checked by hand on quoted commas, semicolons, tabs, BOM, CRLF, blank lines, ragged rows and multiline fields.

## The two ways to do it

**1. No code, in the browser.** Paste your CSV into the [converter](https://fejzadenis.github.io/leadflow/csv-to-json-n8n.html), choose the key column, copy the nested JSON out. Nothing is uploaded, the parsing happens in the page.

**2. In n8n, with a Code node.** Read the file with **Extract from File** (operation *Extract from CSV*, set **Header Row** on) and add **Split Out** or leave the default one-item-per-row output. Then a **Code** node, *Run Once for All Items*:

```js
const KEY = 'order_id';   // the column that identifies one parent
const CHILD = 'items';    // name of the child array

const items = $input.all();
const rows = items.map(i => i.json);
if (!rows.length) return [];

const header = Object.keys(rows[0]);
const keyOf = r => String(r[KEY] ?? '').trim();

const groups = [];
const byKey = new Map();
for (const r of rows) {
  const k = keyOf(r);
  if (!byKey.has(k)) { const g = { key: k, rows: [] }; byKey.set(k, g); groups.push(g); }
  byKey.get(k).rows.push(r);
}

return groups.map(g => {
  const parent = { [KEY]: g.key };
  const varying = [];
  for (const col of header) {
    if (col === KEY) continue;
    const vals = g.rows.map(r => r[col]);
    if (vals.every(v => v === vals[0])) parent[col] = vals[0];
    else varying.push(col);
  }
  const childCols = varying.length ? varying : header.filter(c => c !== KEY);
  if (!varying.length) for (const c of childCols) delete parent[c];
  parent[CHILD] = g.rows.map(r => {
    const o = {};
    for (const c of childCols) o[c] = r[c];
    return o;
  });
  return { json: parent };
});
```

Two details that matter, and that the naive version gets wrong:

- Columns identical inside a group belong on the parent; only the columns that actually differ go into the child, otherwise every child repeats the customer name.
- When *nothing* varies (duplicate rows), all non-key columns go to the child. Returning `items: [{}]` looks like data loss and sends you hunting for a bug that is not there.

## Command line

No dependencies, Node 18+:

```sh
node csv-to-nested-json.js sample-orders.csv --key order_id
node csv-to-nested-json.js sample-orders.csv --key order_id --child lines
```

It prints the nested JSON to stdout, and the detected delimiter plus row/parent counts to stderr. Rows whose field count disagrees with the header are reported by line number - that is the condition n8n reports as `Invalid Record Length: columns length is N, got M`.

```sh
node test.js   # 12 checks, no framework
```

## The input traps this handles

| Input | What happens without care | Here |
| --- | --- | --- |
| `"Doe, Jane"` | comma inside quotes splits the row | stays one field |
| `;` or tab separated | file reads as a single column, no error at all | delimiter detected from the header row |
| UTF-8 BOM | first column is named `\ufefforder_id` and never matches your expression | stripped |
| CRLF | trailing \r ends up inside the last value | normalised |
| blank lines at EOF | phantom empty row | dropped |
| `"Bolt, 3/8"` | 2 fields where the header says 4 | quoted field kept, line reported if the count is still wrong |
| field containing a newline | one record becomes two | stays one record |

If n8n is already refusing the file and you want the reason in one page instead: [Invalid Record Length: columns length is 7, got 8](https://fejzadenis.github.io/leadflow/invalid-record-length.html).

## When it is not a code problem

Some files are broken in a way no expression fixes: the delimiter changes halfway down, one quote is unbalanced and swallows the next 400 rows, or a column shifts because a cell has an unescaped comma. That is a data problem, and it is what the paid repair is for.

**Fixed-scope CSV repair: $49 launch price** - send the file plus the error you get, you get back a corrected file, the n8n settings that import it, and a one-paragraph explanation of what was wrong. Files up to 25,000 rows. Larger files and bigger jobs are quoted before any work starts, at [the price list](https://fejzadenis.github.io/leadflow/#pricing). Write to **perun.intelligence@gmail.com**.

Not sure it is fixable? Send it anyway - the first look is free, and if it is a five-minute setting I answer with that instead of an invoice.
