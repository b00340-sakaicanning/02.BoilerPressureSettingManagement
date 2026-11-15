#!/usr/bin/env node
/**
 * Excel（ボイラ圧力設定変更履歴.xlsx）を移行 CSV に変換する（docs/04 第1部 §13.2、K-15）
 *
 *   node tools/migrate/convert_excel.js "reference/ボイラ圧力設定変更履歴.xlsx" "reference/移行データ"
 *   node tools/migrate/convert_excel.js "reference/ボイラ圧力設定変更履歴.xlsx" --dump-headers   … シート名と見出しだけを表示
 *
 * 出力（UTF-8・BOM なし・LF）: records.csv、patterns.csv、operators.csv、products.csv、report.md
 * 外部ライブラリは使わない。macOS の unzip コマンドで xlsx の中の XML を読み、正規表現で解析する。
 * 出力には個人名（入力者マスタの氏名）が入るので、出力先は Git 管理外の reference/ の下にすること。
 * 変換の規則を変えたら、docs/04 第1部 §13.2 も直す。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SHEET_RECORDS = '圧力設定変更履歴';
const SHEET_PATTERNS = '基準パターンマスタ';
const SHEET_OPERATORS = '入力者マスタ';
const FUELS = ['ガス', '重油'];
const EXPECTED_COUNT = 154; // 2026/11/12 時点の件数（増えているのは本番前なら正常）

// ------------------------------------------------------------------
// xlsx の読み取り
// ------------------------------------------------------------------
function readEntry(xlsx, entry) {
  try { return execFileSync('unzip', ['-p', xlsx, entry], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return null; }
}

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/** <si> や <is> の中の文字をつなげる。<rPh>（読み仮名）の中は読まない */
const phoneticStats = { stringsWithPhonetic: 0 };
function richText(xml) {
  const hasPh = /<rPh\b/.test(xml);
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<phoneticPr\b[^>]*\/>/g, '');
  let out = '';
  body.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (m, t) => { out += decodeXml(t); return m; });
  body.replace(/<t\b[^>]*\/>/g, '');
  return { text: out, hasPh };
}

function colToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n; // 1 始まり
}

function openWorkbook(xlsx) {
  if (!fs.existsSync(xlsx)) throw new Error('ファイルがありません: ' + xlsx);
  const wb = readEntry(xlsx, 'xl/workbook.xml');
  const rels = readEntry(xlsx, 'xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('xlsx として読めません: ' + xlsx);
  const date1904 = /date1904="(1|true)"/.test(wb);
  const relMap = {};
  rels.replace(/<Relationship\b([^>]*)\/?>/g, (m, attrs) => {
    const id = (attrs.match(/\bId="([^"]+)"/) || [])[1];
    const target = (attrs.match(/\bTarget="([^"]+)"/) || [])[1];
    if (id && target) relMap[id] = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    return m;
  });
  const sheets = {};
  wb.replace(/<sheet\b([^>]*)\/?>/g, (m, attrs) => {
    const name = decodeXml((attrs.match(/\bname="([^"]*)"/) || [])[1] || '');
    const rid = (attrs.match(/\br:id="([^"]+)"/) || [])[1];
    if (name && rid && relMap[rid]) sheets[name] = 'xl/' + relMap[rid];
    return m;
  });
  const shared = [];
  const ssXml = readEntry(xlsx, 'xl/sharedStrings.xml') || '';
  ssXml.replace(/<si\b[^>]*>([\s\S]*?)<\/si>/g, (m, inner) => {
    const r = richText(inner);
    if (r.hasPh) phoneticStats.stringsWithPhonetic++;
    shared.push(r.text);
    return m;
  });
  return { xlsx, sheets, shared, date1904 };
}

/** シートを { 行番号: { 列番号: 値 } } で返す。値は文字列か数値 */
function readSheet(book, name) {
  const p = book.sheets[name];
  if (!p) throw new Error('シートがありません: ' + name + '（あるシート: ' + Object.keys(book.sheets).join('、') + '）');
  const xml = readEntry(book.xlsx, p) || '';
  const rows = {};
  xml.replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (m, attrs, inner) => {
    const ref = (attrs.match(/\br="([A-Z]+)(\d+)"/) || []);
    if (!ref[1]) return m;
    const col = colToIndex(ref[1]); const row = Number(ref[2]);
    const t = (attrs.match(/\bt="([^"]+)"/) || [])[1] || 'n';
    inner = inner || '';
    let v = null;
    if (t === 'inlineStr') {
      const is = (inner.match(/<is>([\s\S]*?)<\/is>/) || [])[1];
      if (is !== undefined) { const r = richText(is); if (r.hasPh) phoneticStats.stringsWithPhonetic++; v = r.text; }
    } else {
      const raw = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (raw !== undefined) {
        if (t === 's') v = book.shared[Number(raw)];
        else if (t === 'str' || t === 'e') v = decodeXml(raw);
        else if (t === 'b') v = raw === '1';
        else v = Number(raw);
      }
    }
    if (v === null || v === '') return m;
    (rows[row] = rows[row] || {})[col] = v;
    return m;
  });
  return rows;
}

function serialToYmd(serial, date1904) {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + Math.round(serial) * 86400000);
  return d.getUTCFullYear() + '/' + pad2(d.getUTCMonth() + 1) + '/' + pad2(d.getUTCDate());
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }

// ------------------------------------------------------------------
// 値の変換
// ------------------------------------------------------------------
function convertTime(v) {
  if (typeof v === 'number') {
    if (v < 0 || v >= 1) return { value: null, kind: 'number' };
    const total = Math.round(v * 1440);
    if (total >= 1440) return { value: null, kind: 'number' };
    return { value: pad2(Math.floor(total / 60)) + ':' + pad2(total % 60), kind: 'number' };
  }
  const s = String(v === undefined || v === null ? '' : v).normalize('NFKC').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { value: null, kind: 'string' };
  return { value: pad2(Number(m[1])) + ':' + m[2], kind: m[1].length === 2 && m[1][0] === '0' ? 'string-padded' : 'string' };
}

function str(v) { return v === undefined || v === null ? '' : String(v).trim(); }

function csvLine(values) {
  return values.map((v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',');
}

function headerRow(rows) {
  const h = rows[1] || {};
  const out = {};
  Object.keys(h).forEach((c) => { out[Number(c)] = str(h[c]); });
  return out;
}
/** 見出しに keyword を含む列番号（最初に見つかったもの） */
function findCol(header, keywords, label, sheet) {
  for (const k of keywords) {
    const c = Object.keys(header).find((col) => header[col].indexOf(k) >= 0);
    if (c) return Number(c);
  }
  throw new Error(sheet + ' に「' + label + '」の列が見つかりません（見出し: ' + Object.values(header).join(' / ') + '）');
}

// ------------------------------------------------------------------
// 本体
// ------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const xlsx = args[0] || 'reference/ボイラ圧力設定変更履歴.xlsx';
  const book = openWorkbook(xlsx);

  if (args.includes('--dump-headers')) {
    console.log('シート: ' + Object.keys(book.sheets).join('、') + (book.date1904 ? '（1904年起点）' : ''));
    Object.keys(book.sheets).forEach((name) => {
      const rows = readSheet(book, name);
      const nums = Object.keys(rows).map(Number);
      console.log('- ' + name + ': 行 ' + (nums.length ? Math.min(...nums) + '〜' + Math.max(...nums) : 'なし') + ' / 見出し: ' + Object.values(headerRow(rows)).join(' | '));
    });
    return;
  }

  const outDir = args[1] || 'reference/移行データ';
  const rulesPath = path.join(__dirname, 'product_rules.json');
  const rulesJson = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const rules = rulesJson.rules.map((r) => ({ re: new RegExp(r.pattern), product: r.product, pattern: r.pattern, byPattern: r.byPattern || {} }));
  const blankByPattern = rulesJson.blankByPattern || {};
  const errors = [];
  const warnings = [];

  // ---- 基準パターンマスタ ----
  const pRows = readSheet(book, SHEET_PATTERNS);
  const pHead = headerRow(pRows);
  const pc = {
    pattern: findCol(pHead, ['パターン'], 'パターン', SHEET_PATTERNS),
    main: findCol(pHead, ['メイン'], 'メイン', SHEET_PATTERNS),
    sub: findCol(pHead, ['サブ'], 'サブ', SHEET_PATTERNS),
    products: findCol(pHead, ['品種'], '主要品種', SHEET_PATTERNS)
  };
  let noteCol = null;
  try { noteCol = findCol(pHead, ['注記', '備考', '注'], '注記', SHEET_PATTERNS); } catch (e) { noteCol = null; }
  const patterns = [];
  Object.keys(pRows).map(Number).filter((r) => r >= 2).sort((a, b) => a - b).forEach((r) => {
    const row = pRows[r];
    if (row[pc.pattern] === undefined) return;
    const no = Number(String(row[pc.pattern]).replace(/[^\d]/g, ''));
    // 「メイン圧力: 0.66（小型）」のような文字列から、最初の括弧の中（最後の閉じ括弧まで）を取り出す
    const rawProducts = str(row[pc.products]);
    const m = rawProducts.match(/^[^（(]*[（(]([\s\S]*)[）)]\s*$/);
    // 括弧がなければ、頭の「メイン圧力: 0.69」の部分を取り除いた残り（パターン4 は空になる）
    let products = m ? m[1].trim() : rawProducts.replace(/^メイン(ボイラ)?圧力\s*[:：]?\s*[\d.]+\s*/, '').trim();
    if (/^(なし|無し|-|ー)?$/.test(products)) products = '';
    patterns.push({
      pattern: no, mainPressure: Number(row[pc.main]).toFixed(2), subPressure: Number(row[pc.sub]).toFixed(2),
      products: products, note: noteCol ? str(row[noteCol]) : '', sortOrder: no, active: 'TRUE', _raw: rawProducts
    });
  });
  const patternMap = {};
  patterns.forEach((p) => { patternMap[p.pattern] = p; });

  // 記入称の全角英数字を半角にする（2026/11/15 の依頼: 「ｙ」→「y」。大文字・小文字は変えないので「Y」とは別の人のまま）
  const toHalfShort = (s) => String(s).replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  // ---- 入力者マスタ ----
  const oRows = readSheet(book, SHEET_OPERATORS);
  const oHead = headerRow(oRows);
  const oc = { shortName: findCol(oHead, ['記入称', '記入'], '記入称', SHEET_OPERATORS), fullName: findCol(oHead, ['氏名', '名前'], '氏名', SHEET_OPERATORS) };
  const operators = [];
  const opShortReplaced = [];
  Object.keys(oRows).map(Number).filter((r) => r >= 2).sort((a, b) => a - b).forEach((r) => {
    const row = oRows[r];
    const sn = toHalfShort(str(row[oc.shortName]));
    if (sn !== str(row[oc.shortName])) opShortReplaced.push(str(row[oc.shortName]) + '→' + sn);
    if (!sn) return;
    operators.push({ operatorId: 'U' + pad2(operators.length + 1), shortName: sn, fullName: str(row[oc.fullName]), sortOrder: operators.length + 1, active: 'TRUE', note: '' });
  });
  const opByShort = {};
  operators.forEach((o) => { opByShort[o.shortName] = o; });

  // ---- 履歴 ----
  const rRows = readSheet(book, SHEET_RECORDS);
  const rHead = headerRow(rRows);
  const rc = {
    date: findCol(rHead, ['日付'], '日付', SHEET_RECORDS), time: findCol(rHead, ['時刻'], '時刻', SHEET_RECORDS),
    pattern: findCol(rHead, ['パターン'], '設定パターン', SHEET_RECORDS), fuel: findCol(rHead, ['ボイラ', '燃料'], 'メインボイラ', SHEET_RECORDS),
    pressure: findCol(rHead, ['圧力'], '設定圧力', SHEET_RECORDS), setter: findCol(rHead, ['設定者'], '設定者', SHEET_RECORDS),
    note: findCol(rHead, ['備考'], '備考', SHEET_RECORDS)
  };
  const records = [];
  const timeKinds = { number: 0, string: 0, 'string-padded': 0 };
  const zeroTimeRows = [];
  const setterReplaced = [];
  const unknownSetters = {};
  Object.keys(rRows).map(Number).filter((r) => r >= 2).sort((a, b) => a - b).forEach((r) => {
    const row = rRows[r];
    if (row[rc.date] === undefined) return;
    const where = 'Excel ' + r + '行目';
    let date = null;
    if (typeof row[rc.date] === 'number') date = serialToYmd(row[rc.date], book.date1904);
    else { const m = str(row[rc.date]).normalize('NFKC').match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/); if (m) date = m[1] + '/' + pad2(+m[2]) + '/' + pad2(+m[3]); }
    if (!date) errors.push(where + ': 日付が読めません（' + str(row[rc.date]) + '）');
    const t = convertTime(row[rc.time]);
    timeKinds[t.kind] = (timeKinds[t.kind] || 0) + 1;
    if (t.value === null) errors.push(where + ': 時刻が読めません（' + str(row[rc.time]) + '）');
    if (t.value === '00:00') zeroTimeRows.push(r + '（' + (typeof row[rc.time] === 'number' ? '数値' : '文字列') + '）');
    const pattern = Number(row[rc.pattern]);
    if (!patternMap[pattern]) errors.push(where + ': パターン ' + str(row[rc.pattern]) + ' が基準パターンマスタにありません');
    const fuel = str(row[rc.fuel]);
    if (FUELS.indexOf(fuel) < 0) errors.push(where + ': メインボイラが「ガス」「重油」ではありません（' + fuel + '）');
    const pressureNum = Number(row[rc.pressure]);
    if (!isFinite(pressureNum)) errors.push(where + ': 設定圧力が数値ではありません');
    let setter = str(row[rc.setter]);
    const half = toHalfShort(setter);
    if (half !== setter) { setter = half; setterReplaced.push(r); }
    if (setter && !opByShort[setter]) unknownSetters[setter] = (unknownSetters[setter] || 0) + 1;
    const note = str(row[rc.note]);
    const norm = note.normalize('NFKC');
    const hit = note ? rules.find((x) => x.re.test(norm)) : null;
    // 規則で決めた品種を、パターンの番号で置き換える（byPattern・blankByPattern。docs/04 第1部 §13.3）
    let product = hit ? hit.product : '';
    let byPattern = '';
    if (hit && hit.byPattern[String(pattern)]) { product = hit.byPattern[String(pattern)]; byPattern = 'パターン' + pattern + 'のため'; }
    else if (!product && blankByPattern[String(pattern)]) { product = blankByPattern[String(pattern)]; byPattern = 'パターン' + pattern + 'で品種が空のため'; }
    records.push({ sourceRow: r, date, time: t.value, pattern, fuel, pressure: pressureNum.toFixed(2), setterName: setter, product, note, _hit: !!hit, _byPattern: byPattern });
  });

  // マスタにない記入称（退職者など）は無効の人として足す（D-06）
  Object.keys(unknownSetters).forEach((sn) => {
    const o = { operatorId: 'U' + pad2(operators.length + 1), shortName: sn, fullName: '', sortOrder: operators.length + 1, active: 'FALSE', note: '退職' };
    operators.push(o); opByShort[sn] = o;
  });

  // ---- 集計（レポート用） ----
  const countBy = (key) => records.reduce((m, x) => { m[x[key]] = (m[x[key]] || 0) + 1; return m; }, {});
  const diffs = records.filter((x) => patternMap[x.pattern] && Math.round(Number(x.pressure) * 100) !== Math.round(Number(patternMap[x.pattern].mainPressure) * 100));
  const blankSetter = records.filter((x) => !x.setterName).map((x) => x.sourceRow);
  const blankNote = records.filter((x) => !x.note).map((x) => x.sourceRow);
  const unmatched = records.filter((x) => x.note && !x._hit);
  const byPatternRows = records.filter((x) => x._byPattern);
  const order = [];
  for (let i = 1; i < records.length; i++) {
    const a = records[i - 1], b = records[i];
    if ((a.date + ' ' + a.time) > (b.date + ' ' + b.time)) order.push(a.sourceRow + '行目（' + a.date + ' ' + a.time + '）→ ' + b.sourceRow + '行目（' + b.date + ' ' + b.time + '）');
  }
  const dates = records.map((x) => x.date).filter(Boolean).sort();
  if (records.length !== EXPECTED_COUNT) warnings.push('件数が ' + records.length + ' 件です（2026/11/12 時点は ' + EXPECTED_COUNT + ' 件。本番前で記録が増えているのなら正常）');
  if (Object.keys(unknownSetters).length) warnings.push('入力者マスタにない記入称を、無効の人として足しました: ' + Object.keys(unknownSetters).map((k) => k + '（' + unknownSetters[k] + '件）').join('、'));

  // ---- 出力 ----
  fs.mkdirSync(outDir, { recursive: true });
  const write = (name, header, list) => fs.writeFileSync(path.join(outDir, name), [csvLine(header)].concat(list.map((o) => csvLine(header.map((h) => o[h])))).join('\n') + '\n');
  write('records.csv', ['sourceRow', 'date', 'time', 'pattern', 'fuel', 'pressure', 'setterName', 'product', 'note'], records);
  write('patterns.csv', ['pattern', 'mainPressure', 'subPressure', 'products', 'note', 'sortOrder', 'active'], patterns);
  write('operators.csv', ['operatorId', 'shortName', 'fullName', 'sortOrder', 'active', 'note'], operators);
  write('products.csv', ['name', 'sortOrder', 'active'], rulesJson.products.map((n, i) => ({ name: n, sortOrder: i + 1, active: 'TRUE' })));

  const table = (obj, keys) => (keys || Object.keys(obj)).map((k) => '| ' + k + ' | ' + (obj[k] || 0) + ' |').join('\n');
  const productCounts = countBy('product');
  const lines = [
    '# 移行データの変換レポート',
    '',
    '- 変換日時: ' + new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
    '- 元ファイル: ' + path.basename(xlsx),
    '- 規則: tools/migrate/product_rules.json（docs/04 第1部 §13.2・§13.3）',
    '- このファイルと CSV には個人名が入ります。Git や history に写さないでください',
    '',
    '## 警告・エラー',
    '',
    errors.length ? errors.map((e) => '- **エラー**: ' + e).join('\n') : '- エラー: なし',
    warnings.length ? warnings.map((w) => '- 警告: ' + w).join('\n') : '- 警告: なし',
    '',
    '## 件数と内訳（docs/04 第1部 §13.5 と照合する）',
    '',
    '| 項目 | 値 |', '|---|---|',
    '| 件数 | ' + records.length + ' |',
    '| 期間 | ' + (dates[0] || '') + '〜' + (dates[dates.length - 1] || '') + ' |',
    '| マスタとの差異 | ' + diffs.length + '件（移行元行 ' + diffs.map((x) => x.sourceRow).join('、') + '） |',
    '| 設定者が空 | ' + blankSetter.length + '件（移行元行 ' + blankSetter.join('、') + '） |',
    '| 備考が空 | ' + blankNote.length + '件（移行元行 ' + blankNote.join('、') + '） |',
    '',
    '### パターン別', '', '| パターン | 件数 |', '|---|---|', table(countBy('pattern')),
    '', '### 燃料別', '', '| 燃料 | 件数 |', '|---|---|', table(countBy('fuel')),
    '', '### 設定圧力別', '', '| MPa | 件数 |', '|---|---|', table(countBy('pressure')),
    '', '### 設定者別（記入称。置き換え後）', '', '| 記入称 | 件数 |', '|---|---|', table(countBy('setterName')),
    '',
    '## マスタとの差異の明細', '',
    '| 移行元行 | 日付 | パターン | 設定圧力 | 基準（メイン） |', '|---|---|---|---|---|',
    diffs.map((x) => '| ' + x.sourceRow + ' | ' + x.date + ' | ' + x.pattern + ' | ' + x.pressure + ' | ' + patternMap[x.pattern].mainPressure + ' |').join('\n'),
    '',
    '## 時刻の変換', '',
    '- 文字列 ' + (timeKinds.string + timeKinds['string-padded']) + '件（うち「08:31」のような0埋め ' + timeKinds['string-padded'] + '件）、時刻の数値 ' + timeKinds.number + '件',
    '- "00:00" になった行: ' + (zeroTimeRows.length ? zeroTimeRows.join('、') : 'なし') + '（D-22: 0:00 として移す）',
    '',
    '## 文字の整理', '',
    '- 読み仮名が付いていた文字列: ' + phoneticStats.stringsWithPhonetic + '個（読み仮名は取り除いた）',
    '- 記入称の全角英数字を半角にした（「ｙ」→「y」）: 入力者マスタ ' + (opShortReplaced.length ? opShortReplaced.join('、') : 'なし') +
      ' / 履歴の設定者 ' + setterReplaced.length + '件' + (setterReplaced.length ? '（' + setterReplaced.join('、') + '行目）' : ''),
    '- 日付・時刻の順番が前後している箇所（取込のときに変更日時の順に並べ替える）: ' + (order.length ? order.join(' / ') : 'なし'),
    '',
    '## 基準パターンマスタ', '',
    '| パターン | メイン | サブ | 主要品種（取り出し後） | 元の文字列 | 注記 |', '|---|---|---|---|---|---|',
    patterns.map((p) => '| ' + [p.pattern, p.mainPressure, p.subPressure, p.products, p._raw, p.note].join(' | ') + ' |').join('\n'),
    '',
    '## 入力者マスタ（氏名は省略）', '',
    '| 入力者ID | 記入称 | 有効 | 備考 |', '|---|---|---|---|',
    operators.map((o) => '| ' + [o.operatorId, o.shortName, o.active, o.note].join(' | ') + ' |').join('\n'),
    '',
    '## 品種の振り分け結果', '',
    '| 品種 | 件数 |', '|---|---|',
    rulesJson.products.concat(['']).map((p) => '| ' + (p || '（空）') + ' | ' + (productCounts[p] || 0) + ' |').join('\n'),
    '',
    '### 振り分けの明細', '',
    '| 移行元行 | 備考 | 品種 |', '|---|---|---|',
    records.filter((x) => x.note || x._byPattern).map((x) => '| ' + x.sourceRow + ' | ' + (x.note ? x.note.replace(/\|/g, '｜') : '（備考なし）') + ' | ' +
      (x.product ? x.product + (x._byPattern ? '（' + x._byPattern + '）' : '') : '**（当てはまらない）**') + ' |').join('\n'),
    '',
    '### パターンの番号で決めた品種（' + byPatternRows.length + '件）', '',
    byPatternRows.length ? byPatternRows.map((x) => '- ' + x.sourceRow + '行目: ' + (x.note || '（備考なし）') + ' → ' + x.product + '（' + x._byPattern + '）').join('\n') : 'なし',
    '',
    '### 当てはまらなかった備考（' + unmatched.length + '件）', '',
    unmatched.length ? unmatched.map((x) => '- ' + x.sourceRow + '行目: ' + x.note).join('\n') : 'なし',
    ''
  ];
  fs.writeFileSync(path.join(outDir, 'report.md'), lines.join('\n'));

  console.log('変換しました: ' + outDir);
  console.log('  記録 ' + records.length + '件 / パターン ' + patterns.length + '件 / 入力者 ' + operators.length + '名 / 品種 ' + rulesJson.products.length + '件');
  console.log('  エラー ' + errors.length + '件 / 警告 ' + warnings.length + '件 / 当てはまらなかった備考 ' + unmatched.length + '件');
  if (errors.length) { errors.forEach((e) => console.log('  エラー: ' + e)); process.exitCode = 1; }
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message || e); process.exit(1); }
}
module.exports = { convertTime, serialToYmd, richText };
