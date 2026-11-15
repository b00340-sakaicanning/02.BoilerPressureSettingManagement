#!/usr/bin/env node
/**
 * Code.gs / Tests.gs をローカルの Node.js で検証する（plan/01 K-25、plan/08 §2）
 * 元: 02.物品購入届CSV出力/tools/run_tests_node.js
 *
 *   node tools/run_tests_node.js            … pure テスト＋フェイク上の結合テスト＋移行データの照合（実データがあれば）
 *   node tools/run_tests_node.js --pure     … pure テストだけ
 *   node tools/run_tests_node.js --verbose  … フェイクのログ（UI の表示など）も出す
 *
 * GAS のサービスは tools/gas_fakes.js のフェイクで代用する。
 * ドライブ・ロック・トリガー・シートの書式の実際の動きは、GAS の開発環境で確認すること。
 * Tests.gs からは、グローバルの __FAKES__（フェイクの helpers）で queuePrompt などを使える。
 * GAS 上では __FAKES__ は無いので、Tests.gs では typeof で確かめてから使うこと。
 *
 * 移行データの照合（TC-MG-01〜09 の実データ版）: reference/移行データ/ に CSV があれば、
 * まっさらなフェイクに取り込み、件数と内訳を Excel の値（2026/11/12 時点。docs/04 第1部 §13.5）と比べる。
 * 個人名は出力しない。Excel の記録が増えたら MIGRATION_EXPECTED を直す。
 */
'use strict';
process.env.TZ = 'Asia/Tokyo'; // GAS（appsscript.json の timeZone）と同じにする
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createGasFakes } = require('./gas_fakes.js');

const ROOT = path.resolve(__dirname, '..');
const pureOnly = process.argv.includes('--pure');
const verbose = process.argv.includes('--verbose');

/** 2026/11/12 時点の Excel の値（docs/04 第1部 §13.5、plan/08 TC-MG） */
const MIGRATION_EXPECTED = {
  count: 154,
  byPattern: { 1: 8, 2: 64, 3: 30, 5: 52 },
  byFuel: { 'ガス': 126, '重油': 28 },
  diffRows: [88, 131, 141, 145],
  blankSetterRows: [12, 14, 88],
  byProduct: { '小型(0.35〜1.0L)': 39, '小型(水、スポーツ)': 13, '1.5L(お茶)': 18, '2L(水、スポーツ)': 35, '2L(麦茶なし)': 3, '2L(麦茶あり)': 29, '': 17 },
  from: '2025/01/21',
  to: '2026/11/12'
};

function createContext() {
  const fakes = createGasFakes({ spreadsheetName: 'ボイラ圧力設定DB_開発', log: verbose ? (m) => console.log('  ' + m) : () => {} });
  const sandbox = Object.assign({ console: console, TextEncoder: TextEncoder, TextDecoder: TextDecoder }, fakes);
  delete sandbox.helpers;
  sandbox.__FAKES__ = fakes.helpers;
  const context = vm.createContext(sandbox);
  for (const f of ['gas_app/Code.gs', 'gas_app/Tests.gs']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  const run = (code) => vm.runInContext(code, context);
  return { fakes, run, has: (fn) => run(`typeof ${fn} === 'function'`) };
}

function section(title) { console.log('\n=== ' + title + ' ==='); }

const main = createContext();
let failed = 0;
section('pure テスト');
const pure = main.run('runAllTests({pureOnly: true})');
failed += pure.failed;

if (!pureOnly) {
  if (main.has('menuSetup')) {
    section('初期設定（フェイク）');
    main.run('resetExecutionCache_(); menuSetup()');
    const last = main.fakes.helpers.uiLog.slice(-1)[0];
    if (last) console.log(last);
  }

  if (main.has('seedDevData')) {
    section('開発用サンプルデータ投入');
    console.log(main.run('resetExecutionCache_(); seedDevData()'));
  }

  section('全テスト（フェイク上）');
  const all = main.run('runAllTests()');
  failed = all.failed;

  failed += checkMigration();
}

console.log('\n' + (failed ? `NG が ${failed} 件あります` : 'すべて OK です'));
process.exit(failed ? 1 : 0);

// ------------------------------------------------------------------
// 移行データの照合（実データ）
// ------------------------------------------------------------------
function checkMigration() {
  const dir = path.join(ROOT, 'reference', '移行データ');
  const files = ['records.csv', 'patterns.csv', 'operators.csv', 'products.csv'];
  section('移行データの照合（reference/移行データ。実データ）');
  if (!files.every((f) => fs.existsSync(path.join(dir, f)))) {
    console.log('SKIP 移行 CSV がありません（node tools/migrate/convert_excel.js で作る）');
    return 0;
  }
  if (!main.has('importMigration_')) { console.log('SKIP importMigration_ がまだありません'); return 0; }

  const ctx = createContext();
  let ng = 0;
  const check = (id, name, fn) => {
    try { const note = fn(); console.log(' OK  ' + id + ' ' + name + (note ? ' — ' + note : '')); }
    catch (e) { ng++; console.log(' NG  ' + id + ' ' + name + ' — ' + (e && e.message ? e.message : e)); }
  };
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg ? msg + ': ' : '') + '期待値 ' + JSON.stringify(b) + ' / 実際 ' + JSON.stringify(a)); };
  const ok = (c, msg) => { if (!c) throw new Error(msg); };

  ctx.run('resetExecutionCache_(); menuSetup()');
  const folderId = ctx.fakes.helpers.addFolder('ボイラ圧力設定_移行');
  ctx.run(`resetExecutionCache_(); setSetting_('MIGRATION_FOLDER_ID', ${JSON.stringify(folderId)})`);
  files.forEach((f) => ctx.fakes.helpers.addFile(folderId, f, new Uint8Array(fs.readFileSync(path.join(dir, f)))));

  const r = ctx.run('resetExecutionCache_(); importMigration_({})');
  check('TC-MG-07', '取込（エラーなし）', () => { ok(r.ok, (r.errors || []).slice(0, 5).join(' / ')); return '記録 ' + r.counts.records + '件、入力者 ' + r.counts.operators + '名、パターン ' + r.counts.patterns + '件、品種 ' + r.counts.products + '件'; });
  if (!r.ok) return ng;

  // シートから読み直して確かめる（氏名は読まない）
  const recs = ctx.run(`resetExecutionCache_(); readAll_('RECORDS').map(function (x) { return { recordId: x.recordId, sourceRow: x.sourceRow, date: formatDate_(x.date), time: x.time,
    changedAt: x.changedAt ? x.changedAt.getTime() : 0, pattern: x.pattern, fuel: x.fuel, pressure: x.pressure, setterName: x.setterName, setterId: x.setterId,
    product: x.product, note: x.note, masterDiff: x.masterDiff, source: x.source }; })`);
  const ops = ctx.run(`readAll_('OPERATORS').map(function (o) { return { operatorId: o.operatorId, shortName: o.shortName, active: o.active, note: o.note }; })`);
  const pats = ctx.run(`readAll_('PATTERNS').map(function (p) { return { pattern: p.pattern, mainPressure: p.mainPressure, products: p.products }; })`);
  const countBy = (list, key) => list.reduce((m, x) => { m[x[key]] = (m[x[key]] || 0) + 1; return m; }, {});
  const rowsOf = (list) => list.map((x) => x.sourceRow).sort((a, b) => a - b);

  check('TC-MG-01', '件数', () => eq(recs.length, MIGRATION_EXPECTED.count));
  check('TC-MG-02', 'パターン別・燃料別の件数', () => { eq(countBy(recs, 'pattern'), MIGRATION_EXPECTED.byPattern, 'パターン別'); eq(countBy(recs, 'fuel'), MIGRATION_EXPECTED.byFuel, '燃料別'); });
  check('TC-MG-03', '時刻がすべて "HH:mm"、12行目と132行目は "00:00"', () => {
    const bad = recs.filter((x) => !/^\d{2}:\d{2}$/.test(x.time));
    eq(bad.length, 0, '"HH:mm" でない時刻');
    eq(recs.filter((x) => x.sourceRow === 12 || x.sourceRow === 132).map((x) => x.time), ['00:00', '00:00'], '0:00 の行');
  });
  check('TC-MG-04', '読み仮名が本文に混ざっていない', () => {
    const hit = recs.filter((x) => /ムギチャ|コガタ|セイサン/.test(x.note));
    eq(hit.map((x) => x.sourceRow), [], '読み仮名らしき文字を含む行');
  });
  check('TC-MG-05', '設定者の置き換えと「ヒ」の登録', () => {
    const by = countBy(recs, 'setterName');
    eq([by['y'] || 0, by['ｙ'] || 0, by['Y'] || 0, by['ヒ'] || 0], [8, 0, 39, 14], '「y」「ｙ」「Y」「ヒ」の件数（全角の「ｙ」は半角の「y」にそろえる）');
    eq(ops.filter((o) => /[Ａ-Ｚａ-ｚ０-９]/.test(o.shortName)).length, 0, '入力者マスタの記入称に全角英数字が無い');
    eq((ops.filter((o) => o.shortName === 'y')[0] || {}).operatorId, 'U02', '「y」の入力者');
    const hi = ops.filter((o) => o.shortName === 'ヒ')[0];
    eq(hi && [hi.operatorId, hi.active, hi.note], ['U08', false, '退職'], '「ヒ」の入力者');
    eq(recs.filter((x) => x.setterName && !x.setterId).length, 0, '設定者ID が空の記録（設定者あり）');
  });
  check('TC-MG-06', '品種の振り分け（代表例）', () => {
    const productOf = (note) => { const x = recs.filter((r) => r.note === note)[0]; if (!x) throw new Error('備考「' + note + '」の記録がありません'); return x.product; };
    const sorted = (o) => Object.keys(o).sort().reduce((m, k) => { m[k] = o[k]; return m; }, {});
    eq(sorted(countBy(recs, 'product')), sorted(MIGRATION_EXPECTED.byProduct), '品種ごとの件数（2026/11/15 に8つへ集約）');
    eq(productOf('２L麦茶'), '2L(麦茶あり)', '２L麦茶');
    eq(productOf('2Lスポーツ'), '2L(水、スポーツ)', '2Lスポーツ');
    eq(productOf('1.5L生産'), '1.5L(お茶)', '1.5L生産');
    eq(productOf('0.5L生産のため'), '小型(0.35〜1.0L)', '0.5L生産のため');
    eq(productOf('0.5水生産のため'), '小型(水、スポーツ)', '0.5水生産のため');
    const p3 = recs.filter((x) => x.pattern === 3);
    eq(p3.filter((x) => !x.product || x.product === '2L(麦茶なし)').length, 0, 'パターン3で品種が空・2L(麦茶なし)の記録（2L(麦茶あり)にする）');
    eq(recs.filter((x) => x.pattern !== 3 && /^2L(生産)?(の為|のため)?$/.test(x.note)).every((x) => x.product === '2L(麦茶なし)'), true, 'パターン3以外の「2L」だけの備考は 2L(麦茶なし)');
    eq(ctx.run(`resetExecutionCache_(); getProducts_().map(function (p) { return p.name; })`), ['小型(0.35〜1.0L)', '小型(水、スポーツ)', '1.5L(お茶)', '1.5L(水、スポーツ)', '2L(麦茶あり)', '2L(麦茶なし)', '2L(水、スポーツ)', 'その他'], '品種マスタ');
    eq(productOf('P05W (141℃)'), '2L(麦茶あり)', 'P05W (141℃)（どの規則にも当てはまらないが、パターン3で品種が空）');
    const x55 = recs.filter((r) => /0\.55m水生産/.test(r.note))[0]; ok(x55, '「0.55m水生産」の記録がありません'); eq(x55.product, '小型(水、スポーツ)', '0.55m水生産');
    const x525 = recs.filter((r) => /0\.525生産\(スポーツ\)/.test(r.note))[0]; ok(x525, '「0.525生産(スポーツ)」の記録がありません'); eq(x525.product, '小型(水、スポーツ)', '0.525生産(スポーツ)');
    const p4 = pats.filter((p) => p.pattern === 4)[0]; eq(p4 && p4.products, '', 'パターン4の主要品種');
  });
  check('TC-MG-07', '変更日時の古い順に並び、記録ID が重ならず、データ区分が「移行」', () => {
    for (let i = 1; i < recs.length; i++) ok(recs[i - 1].changedAt <= recs[i].changedAt, '並び順が違う: ' + recs[i - 1].sourceRow + ' → ' + recs[i].sourceRow);
    eq(new Set(recs.map((x) => x.recordId)).size, recs.length, '記録ID の重なり');
    ok(recs.every((x) => /^BP-\d{8}-\d{3,}$/.test(x.recordId)), '記録ID の形');
    eq(Object.keys(countBy(recs, 'source')), ['移行'], 'データ区分');
    return '最初 ' + recs[0].recordId + ' / 最後 ' + recs[recs.length - 1].recordId;
  });
  check('TC-MG-08', 'マスタとの差異・設定者が空・期間（docs/04 第1部 §13.5）', () => {
    eq(rowsOf(recs.filter((x) => x.masterDiff)), MIGRATION_EXPECTED.diffRows, 'マスタとの差異');
    eq(rowsOf(recs.filter((x) => !x.setterName)), MIGRATION_EXPECTED.blankSetterRows, '設定者が空');
    eq([r.check.from, r.check.to], [MIGRATION_EXPECTED.from, MIGRATION_EXPECTED.to], '期間');
  });
  check('TC-MG-09', '取込をもう一度実行すると止まる', () => {
    const again = ctx.run('resetExecutionCache_(); importMigration_({})');
    eq(again.ok, false);
    ok(again.errors[0].indexOf('すでに移行データが 154 件あります') === 0, again.errors[0]);
    eq(ctx.run(`resetExecutionCache_(); readAll_('RECORDS').length`), recs.length, '件数が変わらない');
  });
  if (!ctx.has('listRecords')) return ng;
  const list = (filter, page) => {
    const res = ctx.run(`listRecords({ operatorId: 'U01', token: null }, ${JSON.stringify(filter)}, ${page})`);
    if (!res.ok) throw new Error(JSON.stringify(res.error));
    return res.data;
  };
  check('TC-LS-01', '実データの履歴: 154件が新しい順に20件ずつ8ページ（20×7＋14）、先頭は最新の記録', () => {
    const sizes = [1, 2, 3, 4, 5, 6, 7, 8].map((p) => list({}, p).items.length);
    eq(sizes, [20, 20, 20, 20, 20, 20, 20, 14], 'ページごとの件数');
    const last = list({}, 8);
    eq([last.pageCount, last.hasMore, last.offset], [8, false, 140], '最後のページ');
    const newest = recs.slice().sort((a, b) => b.changedAt - a.changedAt)[0];
    eq(list({}, 1).items[0].recordId, newest.recordId, '先頭');
  });
  check('TC-LS-04', '実データの履歴: パターン5・重油で絞ると Excel と同じ件数', () => {
    const exp = recs.filter((x) => x.pattern === 5 && x.fuel === '重油').length;
    eq(list({ pattern: 5, fuel: '重油' }, 1).total, exp, 'P5・重油');
    return exp + ' 件';
  });
  check('TC-LS-04', '実データの履歴: 無効の設定者「ヒ」（U08）で絞れる', () => eq(list({ setterId: 'U08' }, 1).total, 14, '「ヒ」の件数'));
  return ng;
}
