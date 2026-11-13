#!/usr/bin/env node
// csv-to-nested-json - dependency-free CSV reader + parent/child JSON builder.
// Tested against quoted commas, CRLF, BOM, semicolon/tab/pipe delimiters, ragged rows.
'use strict';

function detectDelimiter(line) {
  const candidates = [',', ';', '\t', '|'];
  let best = ',', bestCount = -1;
  for (const d of candidates) {
    let count = 0, inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (inQuotes && line[i + 1] === '"') i++; else inQuotes = !inQuotes; }
      else if (ch === d && !inQuotes) count++;
    }
    // TAB wins ties over comma, because a tab-separated export with commas inside text
    // still has more tabs than commas on the header row.
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return bestCount <= 0 ? ',' : best;
}

function parseCsv(input) {
  let text = String(input);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = text.split('\n', 1)[0] || '';
  const delimiter = detectDelimiter(firstLine);

  const records = [];
  let row = [], field = '', inQuotes = false, quotedField = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') { inQuotes = true; quotedField = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; quotedField = false; continue; }
    if (ch === '\n') { row.push(field); records.push(row); row = []; field = ''; quotedField = false; continue; }
    field += ch;
  }
  row.push(field);
  records.push(row);

  // Drop a trailing empty record produced by a final newline or blank lines at EOF.
  while (records.length && records[records.length - 1].every((v) => String(v).trim() === '')) records.pop();

  const header = (records.shift() || []).map((h) => h.trim().replace(/^"|"$/g, ''));
  const ragged = [];
  const rows = records.map((cells, n) => {
    const line = n + 2;
    if (cells.length !== header.length) ragged.push({ line, expected: header.length, got: cells.length });
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cells[c] === undefined ? '' : cells[c];
    obj.__line = line;
    return obj;
  });
  return { delimiter, header, rows, ragged };
}

function toNested(rows, keyColumn, childName = 'items') {
  if (!rows.length) return [];
  const header = Object.keys(rows[0]).filter((c) => c !== '__line');
  const keyOf = (r) => String(r[keyColumn] === undefined ? '' : r[keyColumn]).trim();

  const groups = [];
  const byKey = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!byKey.has(k)) { const g = { key: k, rows: [] }; byKey.set(k, g); groups.push(g); }
    byKey.get(k).rows.push(r);
  }

  return groups.map((g) => {
    const parent = { [keyColumn]: g.key };
    const varying = [];
    for (const col of header) {
      if (col === keyColumn) continue;
      const vals = g.rows.map((r) => r[col]);
      if (vals.every((v) => v === vals[0])) parent[col] = vals[0];
      else varying.push(col);
    }
    // When no column varies the parent would be a copy of its only child, so all
    // columns stay on the child instead of returning items: [{}].
    const childColumns = varying.length ? varying : header.filter((c) => c !== keyColumn);
    if (!varying.length) for (const c of childColumns) delete parent[c];
    parent[childName] = g.rows.map((r) => {
      const o = {};
      for (const c of childColumns) o[c] = r[c];
      return o;
    });
    return parent;
  });
}

module.exports = { parseCsv, toNested, detectDelimiter };

if (require.main === module) {
  const fs = require('fs');
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const getFlag = (name, fallback) => {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  if (!file) {
    console.error('usage: node csv-to-nested-json.js <file.csv> --key order_id [--child items]');
    process.exit(2);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const { delimiter, rows, header, ragged } = parseCsv(raw);
  if (ragged.length) {
    // This is the same condition n8n reports as "Invalid Record Length: columns length is N, got M".
    console.error('warning: ' + ragged.length + ' row(s) do not match the header width');
    for (const r of ragged.slice(0, 5)) console.error('  line ' + r.line + ': expected ' + r.expected + ' fields, got ' + r.got);
  }
  const key = getFlag('key', header[0]);
  if (!header.includes(key)) {
    console.error('key column "' + key + '" is not in the file. Columns: ' + header.join(', '));
    process.exit(2);
  }
  const nested = toNested(rows, key, getFlag('child', 'items'));
  console.log(JSON.stringify(nested, null, 2));
  console.error('delimiter=' + (delimiter === '\t' ? 'TAB' : delimiter) + ' rows=' + rows.length + ' parents=' + nested.length);
}
