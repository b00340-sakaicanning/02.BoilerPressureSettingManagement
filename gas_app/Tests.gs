/**
 * ボイラ圧力設定管理 — テスト（Tests.gs）
 * 版: v1.1（2026/11/15。フェーズ8: 履歴のページ分け・品種の集約）
 *
 * - 開発環境の GAS プロジェクトだけに貼る（本番には貼らない。plan/02 §3.1）
 * - Code.gs の関数を呼ぶだけ。Code.gs からこのファイルは呼ばない
 * - ローカル: node tools/run_tests_node.js（--pure で pure テストだけ）
 * - GAS 上: メニュー「開発: テストを実行」または runAllTests() を実行
 * - テストケースの ID と内容は plan/08_テスト計画.md（TC-xx）に合わせる
 * - フェイクの補助（queuePrompt、setLockAvailable など）は、ローカルでだけ __FAKES__ で使える。
 *   GAS 上には無いので、使うときは typeof __FAKES__ !== 'undefined' を確かめ、無ければ skip_ する
 * - テストのデータに実在の個人名を使わない（plan/README §2.2-11）
 */

// ---------------------------------------------------------------------
// テストの枠組み（元: 02.物品購入届CSV出力/gas_app/Tests.gs）
// ---------------------------------------------------------------------

function assertEq_(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error((msg ? msg + ': ' : '') + '期待値 ' + e + ' / 実際 ' + a);
}
function assertTrue_(cond, msg) { if (!cond) throw new Error(msg || '条件が成り立ちません'); }
function assertThrows_(fn, code, msg) {
  try { fn(); } catch (e) {
    if (code && e.code !== code) throw new Error((msg ? msg + ': ' : '') + 'エラーコード ' + code + ' を期待しましたが ' + (e.code || e.message) + ' でした');
    return e;
  }
  throw new Error((msg ? msg + ': ' : '') + 'エラーになりませんでした（期待: ' + code + '）');
}

/** テストの一覧 [ID, 名前, 関数, 種類]。種類: pure=GASのサービスを使わない / gas=シートなどを使う */
function testList_() {
  return [
    ['TC-DL-01', 'menuSetup でシート・見出し・設定・品種ができる', test_DL01_, 'gas'],
    ['TC-DL-02', 'menuSetup をもう一度実行しても重複しない', test_DL02_, 'gas'],
    ['TC-DL-03', '見出しの列の順番を入れ替えても readAll_ で読める', test_DL03_, 'gas'],
    ['TC-DL-04', '時刻の列に "08:05" を書いて読むと文字列のまま', test_DL04_, 'gas'],
    ['TC-DL-05', 'normalizeTime_ の変換', test_DL05_, 'pure'],
    ['TC-DL-06', 'nextRecordId_ を同じ日に2回呼ぶと 001、002', test_DL06_, 'gas'],
    ['TC-DL-07', '同じ日に999件あるときの採番は 1000', test_DL07_, 'pure'],
    ['TC-DL-08', 'writeLog_ で操作ログに1行足される', test_DL08_, 'gas'],
    ['TC-DL-09', '日付・数値・真偽値の変換（parseDate_、toDate_、round2_、toBool_、calcMasterDiff_）', test_DL09_, 'pure'],
    ['TC-LK-02', 'ロックが取れないときは BUSY', test_LK02_, 'gas'],
    ['TC-AU-07', '管理者暗証番号は salt とハッシュだけが保存される', test_AU07_, 'gas'],
    ['TC-MG-07', '移行 CSV（試験用）を確かめると、変更日時の順に並び記録ID が振られる', test_MG07_, 'gas'],
    ['TC-MG-08', '移行 CSV（試験用）のマスタとの差異と照合の集計', test_MG08_, 'gas'],
    ['TC-MG-09', '移行データがあるときに取込をもう一度実行すると止まる', test_MG09_, 'gas'],
    ['TC-MG-10', '存在しない記入称や不正な時刻があるとエラーの一覧を返し、何も書き込まない', test_MG10_, 'gas'],
    ['TC-MG-11', '移行用フォルダから4つの CSV を読む（ゴミ箱のファイルは無視、無ければエラー）', test_MG11_, 'gas'],
    ['TC-QY-01', '今の設定は、変更日時が最新の削除されていない記録', test_QY01_, 'gas'],
    ['TC-QY-02', '最新の記録を削除すると、今の設定が1つ前の記録になる', test_QY02_, 'gas'],
    ['TC-QY-03', '変更日時が同じ記録が2件なら、登録日時が新しい方が今の設定', test_QY03_, 'gas'],
    ['TC-QY-04', '無効な操作者: getHome は AUTH_REQUIRED、getInitialData は operatorValid=false', test_QY04_, 'gas'],
    ['TC-IN-01', '全項目を正しく入れて登録すると1行増え、version 1・データ区分「アプリ」・操作ログ「登録」', test_IN01_, 'gas'],
    ['TC-IN-03', 'パターン2で 0.65 にして登録すると masterDiff が TRUE', test_IN03_, 'gas'],
    ['TC-IN-04', '圧力 0.49 / 0.81 / 0.675 / 文字は VALIDATION（pressure）', test_IN04_, 'gas'],
    ['TC-IN-05', 'パターン・燃料・日付・時刻が未入力なら VALIDATION（それぞれの項目）', test_IN05_, 'gas'],
    ['TC-IN-06', '無効なパターン・存在しない品種は VALIDATION', test_IN06_, 'gas'],
    ['TC-IN-07', '備考201文字は VALIDATION（note）、200文字は登録できる', test_IN07_, 'gas'],
    ['TC-IN-08', '設定者として、別の人の setterId で登録すると FORBIDDEN', test_IN08_, 'gas'],
    ['TC-IN-10', 'payload の recordId・version などのシステム項目は無視される', test_IN10_, 'gas'],
    ['TC-IN-12', '無効な操作者の ctx で登録すると AUTH_REQUIRED（need=operator）', test_IN12_, 'gas'],
    ['TC-LS-01', '条件なし: 1ページ目は新しい順に HISTORY_PAGE_SIZE 件、total は削除されていない件数', test_LS01_, 'gas'],
    ['TC-LS-02', '最後のページ: 残りの件数だけ。ページ数を超えた番号は最後のページ', test_LS02_, 'gas'],
    ['TC-LS-03', '期間で絞ると両端の日を含む。不正な日付は VALIDATION', test_LS03_, 'gas'],
    ['TC-LS-04', 'パターン・燃料・設定者・品種の組み合わせは AND', test_LS04_, 'gas'],
    ['TC-LS-05', '品種「（未設定）」は品種が空の記録だけ', test_LS05_, 'gas'],
    ['TC-LS-06', '設定者が includeDeleted=true にしても削除済みは出ない', test_LS06_, 'gas'],
    ['TC-LS-07', '管理者が includeDeleted=true にすると削除済みも出る', test_LS07_, 'gas'],
    ['TC-LS-08', '削除済みの記録は設定者には NOT_FOUND、管理者には見える。getRecord の can〜', test_LS08_, 'gas'],
    ['TC-LS-09', 'HISTORY_PAGE_SIZE: 設定した件数で分ける。5〜100 の整数でなければ 20', test_LS09_, 'gas'],
    ['TC-AU-01', '正しい暗証番号でトークンが返り、操作ログ「管理者認証」。checkAdmin が true', test_AU01_, 'gas'],
    ['TC-AU-02', '違う暗証番号は AUTH_FAILED、操作ログ「管理者認証の失敗」', test_AU02_, 'gas'],
    ['TC-AU-03', '5回続けて間違えると AUTH_LOCKED。正しい番号でもロック中は入れない', test_AU03_, 'gas'],
    ['TC-AU-04', '期限切れのトークンで削除すると AUTH_REQUIRED（need=admin）', test_AU04_, 'gas'],
    ['TC-AU-05', 'トークンを発行した人と違う操作者では AUTH_REQUIRED', test_AU05_, 'gas'],
    ['TC-AU-06', 'logoutAdmin のあとは AUTH_REQUIRED', test_AU06_, 'gas'],
    ['TC-ED-01', '本人が自分のアプリの記録を修正すると反映され、version+1、ログ「修正」に変更前後', test_ED01_, 'gas'],
    ['TC-ED-02', '本人は30日前の自分の記録も修正できる（期限なし）', test_ED02_, 'gas'],
    ['TC-ED-03', '他人の記録を修正すると FORBIDDEN', test_ED03_, 'gas'],
    ['TC-ED-04', '本人でも移行データは修正できない（FORBIDDEN）', test_ED04_, 'gas'],
    ['TC-ED-05', '本人が設定者を変えて修正すると FORBIDDEN', test_ED05_, 'gas'],
    ['TC-ED-06', '管理者は移行データを修正でき、設定者も変えられる', test_ED06_, 'gas'],
    ['TC-ED-07', '管理者が削除すると論理削除になり、一覧から消え、ログ「削除」', test_ED07_, 'gas'],
    ['TC-ED-08', '管理者が元に戻すと、ログ「削除の取り消し」', test_ED08_, 'gas'],
    ['TC-ED-09', '設定者が削除すると AUTH_REQUIRED（need=admin）', test_ED09_, 'gas'],
    ['TC-ED-10', '修正で圧力を変えるとマスタとの差異を計算し直す。変わった項目が無ければ書き込まない', test_ED10_, 'gas'],
    ['TC-LK-01', '古い version で修正・削除すると CONFLICT、シートは変わらない', test_LK01_, 'gas'],
    ['TC-LG-01', '操作ログの一覧は管理者だけ、新しい順', test_LG01_, 'gas'],
    ['TC-BK-01', '今すぐバックアップ: フォルダに複製ができ、ログ「バックアップ」。フォルダ ID が空なら何もしない', test_BK01_, 'gas'],
    ['TC-BK-02', '保管期間（12か月）より前のバックアップはゴミ箱へ移り、それ以外は残る', test_BK02_, 'gas'],
    ['TC-BK-03', 'バックアップのトリガーを2回設定しても1つだけ', test_BK03_, 'gas'],
    ['TC-ST-01', '履歴シート: A〜I 列が人の見る項目で、J 列以降は列のグループ', test_ST01_, 'gas'],
    ['TC-ST-02', '履歴シート: 削除済みの行は灰色＋取り消し線、マスタとの差異は背景色（条件付き書式）', test_ST02_, 'gas'],
    ['TC-ST-03', 'どのシートも保護（警告だけ）が1つ付いている', test_ST03_, 'gas']
  ];
}

/** すべてのテストを実行する。options.pureOnly=true なら pure だけ、options.only=[ID...] で絞り込み */
function runAllTests(options) {
  options = options || {};
  const results = [];
  testList_().forEach(function (t) {
    if (options.pureOnly && t[3] !== 'pure') return;
    if (options.only && options.only.indexOf(t[0]) < 0) return;
    resetExecutionCache_();
    try {
      const note = t[2]();
      results.push({ id: t[0], name: t[1], ok: true, note: note || '' });
    } catch (e) {
      if (e && e.skip) results.push({ id: t[0], name: t[1], ok: true, skipped: true, note: e.message });
      else results.push({ id: t[0], name: t[1], ok: false, note: e && e.message ? e.message : String(e) });
    }
  });
  const failed = results.filter(function (r) { return !r.ok; });
  results.forEach(function (r) {
    console.log((r.ok ? (r.skipped ? 'SKIP' : ' OK ') : ' NG ') + ' ' + r.id + ' ' + r.name + (r.note ? ' — ' + r.note : ''));
  });
  console.log('合計 ' + results.length + ' 件 / NG ' + failed.length + ' 件');
  return { total: results.length, failed: failed.length, results: results };
}

function menuRunAllTests() {
  const r = runAllTests();
  const ng = r.results.filter(function (x) { return !x.ok; });
  alert_('テスト結果: ' + r.total + '件中 NG ' + r.failed + '件' + (ng.length ? '\n\n' + ng.slice(0, 15).map(function (x) { return x.id + ' ' + x.note; }).join('\n') : '') +
    '\n\n詳細は「実行数」または「ログ」を確認してください。');
}

function skip_(msg) { const e = new Error(msg); e.skip = true; return e; }

function hasFakes_() { return typeof __FAKES__ !== 'undefined'; }

// ---------------------------------------------------------------------
// TC-DL データ層
// ---------------------------------------------------------------------

function sheetCounts_() {
  resetExecutionCache_();
  const ss = getSpreadsheet_();
  const out = { sheets: ss.getSheets().length };
  Object.keys(SHEETS).forEach(function (k) {
    const sh = ss.getSheetByName(SHEETS[k]);
    out[k] = sh ? { rows: readAll_(k).length, cols: sh.getLastColumn(), protections: sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length } : null;
  });
  return out;
}

function test_DL01_() {
  menuSetup();
  resetExecutionCache_();
  const ss = getSpreadsheet_();
  Object.keys(SHEETS).forEach(function (k) {
    const sh = ss.getSheetByName(SHEETS[k]);
    assertTrue_(sh, 'シートがありません: ' + SHEETS[k]);
    const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    COLUMNS[k].forEach(function (c) { assertTrue_(header.indexOf(c[0]) >= 0, SHEETS[k] + ' に見出しがありません: ' + c[0]); });
  });
  const keys = readAll_('SETTINGS').map(function (r) { return r.key; });
  SETTING_DEFAULTS.forEach(function (d) { assertTrue_(keys.indexOf(d[0]) >= 0, '設定がありません: ' + d[0]); });
  assertEq_(getSetting_('PRESSURE_MIN'), '0.50', '設定の値が文字列のまま');
  const names = readAll_('PRODUCTS').map(function (p) { return p.name; });
  PRODUCTS_INITIAL.forEach(function (n) { assertTrue_(names.indexOf(n) >= 0, '品種がありません: ' + n); });
}

function test_DL02_() {
  menuSetup();
  const before = sheetCounts_();
  menuSetup();
  const after = sheetCounts_();
  // 操作ログには「初期設定」が1行増えるのが正しい（docs/04 第1部 §12）
  assertEq_(after.LOGS.rows, before.LOGS.rows + 1, '操作ログは「初期設定」が1行増える');
  after.LOGS.rows = before.LOGS.rows;
  assertEq_(after, before, '2回目の menuSetup の前後（操作ログの行数を除く）');
  const sh = getSheet_('RECORDS');
  assertEq_(sh.getConditionalFormatRules().length, 2, '条件付き書式の数');
  const info = headerInfo_('RECORDS');
  assertEq_(sh.getColumnGroupDepth(info.cols.recordId), 1, '記録ID の列のグループの深さ');
  assertEq_(sh.getColumnGroupDepth(info.cols.masterDiff), 0, 'マスタとの差異の列はグループに入れない');
}

function test_DL03_() {
  const sh = getSheet_('PRODUCTS');
  const last = sh.getLastRow();
  const width = sh.getLastColumn();
  const range = sh.getRange(1, 1, last, width);
  const orig = range.getValues();
  const origFmt = range.getNumberFormats();
  const expected = readAll_('PRODUCTS').map(function (r) { return { name: r.name, sortOrder: r.sortOrder, active: r.active }; });
  try {
    // 1列目（品種名）と2列目（表示順）を入れ替える
    const swapped = orig.map(function (row) { const r = row.slice(); r[0] = row[1]; r[1] = row[0]; return r; });
    const swappedFmt = origFmt.map(function (row) { const r = row.slice(); r[0] = row[1]; r[1] = row[0]; return r; });
    range.setNumberFormats(swappedFmt);
    range.setValues(swapped);
    resetExecutionCache_();
    const got = readAll_('PRODUCTS').map(function (r) { return { name: r.name, sortOrder: r.sortOrder, active: r.active }; });
    assertEq_(got, expected, '列を入れ替えたあとの読み取り');
  } finally {
    range.setNumberFormats(origFmt);
    range.setValues(orig);
    resetExecutionCache_();
  }
}

function test_DL04_() {
  const sh = getSheet_('RECORDS');
  const id = 'TEST-DL04-' + new Date().getTime();
  appendRow_('RECORDS', { date: new Date(2030, 0, 1), time: '08:05', pattern: 2, fuel: 'ガス', pressure: 0.67, recordId: id, version: 1, deleted: false });
  resetExecutionCache_();
  const row = findRowIndex_('RECORDS', 'recordId', id);
  assertTrue_(row > 0, 'テスト用の行が見つかりません');
  try {
    const col = headerInfo_('RECORDS').cols.time;
    const raw = sh.getRange(row, col).getValue();
    assertEq_(typeof raw, 'string', 'セルの値の型');
    assertEq_(raw, '08:05', 'セルの値');
    assertEq_(sh.getRange(row, col).getNumberFormats()[0][0], '@', 'セルの書式');
    const rec = readAll_('RECORDS').filter(function (r) { return r.recordId === id; })[0];
    assertEq_(rec.time, '08:05', 'readAll_ の時刻');
    assertEq_(rec.pressure, 0.67, 'readAll_ の圧力');
  } finally {
    sh.deleteRow(row); // テスト用の行だけは物理的に消す（業務の記録は物理削除しない）
    resetExecutionCache_();
  }
}

function test_DL05_() {
  assertEq_(normalizeTime_('8:5'), '08:05');
  assertEq_(normalizeTime_('8:05'), '08:05');
  assertEq_(normalizeTime_('08:05'), '08:05');
  assertEq_(normalizeTime_('０８：０５'), '08:05', '全角');
  assertEq_(normalizeTime_(' 23:59 '), '23:59', '前後の空白');
  assertEq_(normalizeTime_(0.3368), '08:05', '1日の割合（Excel の時刻の値）');
  assertEq_(normalizeTime_(0), '00:00', '数値の 0');
  assertEq_(normalizeTime_('0:00'), '00:00');
  assertEq_(normalizeTime_('24:00'), null, '24時');
  assertEq_(normalizeTime_('12:60'), null, '60分');
  assertEq_(normalizeTime_('abc'), null);
  assertEq_(normalizeTime_(''), null);
  assertEq_(normalizeTime_(1.2), null, '1以上の数値');
}

function test_DL06_() {
  withLock_(function () {
    const d = new Date(2030, 0, 1, 8, 0);
    assertEq_(nextRecordId_(d), 'BP-20300101-001');
    assertEq_(nextRecordId_(d), 'BP-20300101-002');
    assertEq_(nextRecordId_(new Date(2030, 0, 2, 0, 0)), 'BP-20300102-001', '別の日は 001 から');
  });
}

function test_DL07_() {
  const ids = [];
  for (let i = 1; i <= 999; i++) ids.push(formatRecordId_('BP', '20261114', i));
  ids.push('BP-20261113-500');
  const seq = nextSeqFromIds_(ids, 'BP-20261114-');
  assertEq_(seq, 1000);
  assertEq_(formatRecordId_('BP', '20261114', seq), 'BP-20261114-1000');
  assertEq_(formatRecordId_('BP', '20261114', 1), 'BP-20261114-001');
  assertEq_(nextSeqFromIds_(['BP-20261114-1000', 'BP-20261114-999'], 'BP-20261114-'), 1001, '1000件目より後');
}

function test_DL08_() {
  const before = readAll_('LOGS').length;
  writeLog_({ operatorId: 'U01' }, ROLES.SETTER, 'CREATE', 'BP-TEST-001', { pattern: 2, pressure: 0.67 });
  resetExecutionCache_();
  const logs = readAll_('LOGS');
  assertEq_(logs.length, before + 1, 'ログの件数');
  const last = logs[logs.length - 1];
  assertEq_(last.action, '登録');
  assertEq_(last.recordId, 'BP-TEST-001');
  assertEq_(last.operatorId, 'U01');
  assertEq_(last.role, '設定者');
  assertEq_(JSON.parse(last.detail), { pattern: 2, pressure: 0.67 }, 'detail');
  writeLog_(null, ROLES.SYSTEM, 'SETUP', '', {});
  resetExecutionCache_();
  const sys = readAll_('LOGS').slice(-1)[0];
  assertEq_([sys.operatorId, sys.operatorName, sys.role], ['SYSTEM', 'システム', 'システム'], 'システムの操作');
}

function test_DL09_() {
  assertEq_(formatDate_(parseDate_('2026/11/14')), '2026/11/14');
  assertEq_(formatDate_(parseDate_('2026-1-5')), '2026/01/05');
  assertEq_(parseDate_('2026/02/30'), null, '実在しない日付');
  assertEq_(parseDate_('2026/11'), null);
  assertEq_(formatDateTime_(toDate_('2026/11/12 10:40:00')), '2026/11/12 10:40');
  assertEq_(formatDateTime_(combineDateTime_(parseDate_('2026/11/12'), '07:05')), '2026/11/12 07:05');
  assertEq_(toDate_(''), null);
  assertEq_(round2_(0.675), 0.68);
  assertEq_(round2_('0.67'), 0.67);
  assertEq_([toBool_(true), toBool_('TRUE'), toBool_('false'), toBool_(''), toBool_(0)], [true, true, false, false, false]);
  assertEq_(calcMasterDiff_(0.67, { mainPressure: 0.67 }), false);
  assertEq_(calcMasterDiff_(0.65, { mainPressure: 0.67 }), true);
  assertEq_(calcMasterDiff_(0.1 + 0.57, { mainPressure: 0.67 }), false, '浮動小数の誤差');
  assertEq_(calcMasterDiff_(0.67, null), false, 'パターンなし');
  assertEq_(columnLetter_(1) + columnLetter_(20) + columnLetter_(27), 'ATAA');
}

// ---------------------------------------------------------------------
// TC-LK 排他 / TC-AU 認証
// ---------------------------------------------------------------------

function test_LK02_() {
  if (!hasFakes_()) throw skip_('ロックが取れない状態はローカル（フェイク）でだけ作れます');
  __FAKES__.setLockAvailable(false);
  try {
    assertThrows_(function () { appendRow_('LOGS', { logId: 'x' }); }, 'BUSY');
  } finally {
    __FAKES__.setLockAvailable(true);
  }
}

function test_AU07_() {
  if (!hasFakes_()) throw skip_('ダイアログへの入力はローカル（フェイク）でだけ再現できます');
  const keepSalt = getSetting_('ADMIN_PIN_SALT'), keepHash = getSetting_('ADMIN_PIN_HASH');
  try {
    __FAKES__.queuePrompt(['4826', '4826']);
    assertEq_(menuSetAdminPin(), '設定');
    resetExecutionCache_();
    const salt = getSetting_('ADMIN_PIN_SALT'), hash = getSetting_('ADMIN_PIN_HASH');
    assertTrue_(salt.length > 0, 'salt');
    assertTrue_(/^[0-9a-f]{64}$/.test(hash), 'ハッシュの形');
    assertEq_(hash, sha256Hex_(salt + ':4826'), 'ハッシュの値');
    // 平文の暗証番号がどのセルにも残っていない（uuid などに数字の並びが偶然含まれることはあるので、完全一致で見る）
    getSpreadsheet_().getSheets().forEach(function (sh) {
      if (!sh.getLastRow()) return;
      sh.getDataRange().getValues().forEach(function (row) {
        row.forEach(function (v) { assertTrue_(String(v).trim() !== '4826', sh.getName() + ' に暗証番号の平文があります'); });
      });
    });
    const pinLog = readAll_('LOGS').filter(function (l) { return l.action === '管理者暗証番号の設定'; }).slice(-1)[0];
    assertTrue_(pinLog, '操作ログ「管理者暗証番号の設定」がありません');
    assertEq_(pinLog.detail, '{}', 'ログの内容に暗証番号を書かない');
    // 1回目と2回目が違えば、変わらない
    __FAKES__.queuePrompt(['1111', '2222']);
    assertEq_(menuSetAdminPin(), '不一致');
    resetExecutionCache_();
    assertEq_(getSetting_('ADMIN_PIN_HASH'), hash, '不一致のときはハッシュが変わらない');
    // 形が違えば設定しない
    __FAKES__.queuePrompt(['12a4']);
    assertEq_(menuSetAdminPin(), '形式エラー');
  } finally {
    setSetting_('ADMIN_PIN_SALT', keepSalt);
    setSetting_('ADMIN_PIN_HASH', keepHash);
    resetExecutionCache_();
  }
}

// ---------------------------------------------------------------------
// TC-MG 移行（試験用の CSV。架空のデータ）
// 実データ（reference/移行データ）の照合は tools/run_tests_node.js の「移行データの照合」で行う
// ---------------------------------------------------------------------

function migrationFixture_() {
  return {
    operators: 'operatorId,shortName,fullName,sortOrder,active,note\nU01,A,架空 一郎,1,TRUE,\nU02,B,架空 二郎,2,TRUE,\nU03,Z,,3,FALSE,退職\n',
    patterns: 'pattern,mainPressure,subPressure,products,note,sortOrder,active\n2,0.67,0.65,1.5L,,2,TRUE\n5,0.65,0.63,小型,注記あり,5,TRUE\n',
    products: 'name,sortOrder,active\n小型(0.35〜1.0L),1,TRUE\n2L(水、スポーツ),2,TRUE\n',
    records: 'sourceRow,date,time,pattern,fuel,pressure,setterName,product,note\n' +
      '2,2025/01/21,08:53,2,ガス,0.67,A,2L(水、スポーツ),\n' +
      '3,2025/01/23,10:40,5,重油,0.63,Z,小型(0.35〜1.0L),"テスト, カンマ入り"\n' +
      '4,2025/01/22,00:00,2,ガス,0.67,,,\n' +
      '5,2025/01/22,00:00,5,ガス,0.65,B,,同じ時刻\n'
  };
}

function test_MG07_() {
  const before = readAll_('RECORDS').length;
  const r = importMigration_({ texts: migrationFixture_(), dryRun: true });
  assertTrue_(r.ok, 'エラー: ' + (r.errors || []).join(' / '));
  assertEq_(r.counts, { records: 4, operators: 3, patterns: 2, products: 2 }, '件数');
  assertEq_(r.records.map(function (x) { return x.sourceRow; }), [2, 4, 5, 3], '変更日時の順（同じ日時は移行元行の順）');
  const ids = r.records.map(function (x) { return x.recordId; });
  assertTrue_(/^BP-20250121-\d{3}$/.test(ids[0]) && /^BP-20250122-\d{3}$/.test(ids[1]) && /^BP-20250123-\d{3}$/.test(ids[3]), '記録ID の日付: ' + ids.join(','));
  assertTrue_(ids[1].slice(0, 12) === ids[2].slice(0, 12) && Number(ids[2].slice(12)) === Number(ids[1].slice(12)) + 1, '同じ日の連番: ' + ids.join(','));
  const z = r.records.filter(function (x) { return x.sourceRow === 3; })[0];
  assertEq_([z.setterId, z.setterName, z.note, z.time], ['U03', 'Z', 'テスト, カンマ入り', '10:40'], '無効の人・カンマ入りの備考');
  const blank = r.records.filter(function (x) { return x.sourceRow === 4; })[0];
  assertEq_([blank.setterId, blank.setterName, blank.time, blank.product], ['', '', '00:00', ''], '設定者が空・0:00');
  r.records.forEach(function (x) {
    assertEq_([x.source, x.createdBy, x.updatedBy, x.version, x.deleted], ['移行', 'SYSTEM', 'SYSTEM', 1, false], '移行データのシステム項目');
  });
  resetExecutionCache_();
  assertEq_(readAll_('RECORDS').length, before, 'dryRun は書き込まない');
}

function test_MG08_() {
  const r = importMigration_({ texts: migrationFixture_(), dryRun: true });
  assertTrue_(r.ok, 'エラー: ' + (r.errors || []).join(' / '));
  assertEq_(r.check.diffRows, [3], 'マスタとの差異（P5 で 0.63）');
  assertEq_(r.check.blankSetterRows, [4], '設定者が空');
  assertEq_(r.check.byPattern, { 2: 2, 5: 2 }, 'パターン別');
  assertEq_(r.check.byFuel, { 'ガス': 3, '重油': 1 }, '燃料別');
  assertEq_([r.check.from, r.check.to], ['2025/01/21', '2025/01/23'], '期間');
  assertTrue_(formatMigrationCheck_(r.check).indexOf('マスタとの差異: 1件（移行元行 3）') >= 0, 'ダイアログの文言');
}

function test_MG09_() {
  const existing = readAll_('RECORDS').filter(function (x) { return x.source === '移行'; }).length;
  if (!existing) throw skip_('移行データがないため確かめられません（取込を実行したあとに確かめる）');
  const before = readAll_('RECORDS').length;
  const r = importMigration_({ texts: migrationFixture_() });
  assertEq_(r.ok, false);
  assertTrue_(r.errors[0].indexOf('すでに移行データが') === 0, r.errors[0]);
  resetExecutionCache_();
  assertEq_(readAll_('RECORDS').length, before, '書き込んでいない');
}

function test_MG10_() {
  const before = readAll_('RECORDS').length;
  const t = migrationFixture_();
  t.records += '6,2025/01/24,25:00,2,ガス,0.67,Q,,\n7,2025/02/30,08:00,9,灯油,0.675,A,未登録の品種,\n';
  const r = importMigration_({ texts: t, dryRun: true });
  assertEq_(r.ok, false);
  const all = r.errors.join('\n');
  ['時刻が正しくありません（25:00）', '設定者「Q」が operators.csv にありません', '日付が正しくありません（2025/02/30）',
    'パターン 9 が patterns.csv にありません', 'メインボイラが「ガス」「重油」ではありません（灯油）', '設定圧力が小数2桁までの数値ではありません（0.675）',
    '品種「未登録の品種」が products.csv にありません'].forEach(function (m) { assertTrue_(all.indexOf(m) >= 0, 'エラーに含まれない: ' + m); });
  const noHeader = importMigration_({ texts: { records: 'a,b\n1,2\n', patterns: t.patterns, operators: t.operators, products: t.products }, dryRun: true });
  assertTrue_(noHeader.errors[0].indexOf('records.csv: 見出しがありません') === 0, noHeader.errors[0]);
  resetExecutionCache_();
  assertEq_(readAll_('RECORDS').length, before, '書き込んでいない');
}

function test_MG11_() {
  if (!hasFakes_()) throw skip_('ドライブのファイルはローカル（フェイク）でだけ用意できます');
  const keep = getSetting_('MIGRATION_FOLDER_ID');
  try {
    const t = migrationFixture_();
    const folderId = __FAKES__.addFolder('移行テスト');
    setSetting_('MIGRATION_FOLDER_ID', folderId);
    ['records', 'patterns', 'operators'].forEach(function (k) { __FAKES__.addFile(folderId, k + '.csv', t[k]); });
    resetExecutionCache_();
    let f = readMigrationFiles_();
    assertEq_(f.errors, ['products.csv が移行用フォルダにありません'], '足りないファイル');
    const trashedId = __FAKES__.addFile(folderId, 'products.csv', 'name,sortOrder,active\n古い,1,TRUE\n');
    DriveApp.getFileById(trashedId).setTrashed(true);
    __FAKES__.addFile(folderId, 'products.csv', t.products);
    f = readMigrationFiles_();
    assertEq_(f.errors, [], 'ゴミ箱のファイルは数えない');
    assertEq_(f.texts.products, t.products, '読んだ中身');
    __FAKES__.addFile(folderId, 'records.csv', t.records);
    f = readMigrationFiles_();
    assertEq_(f.errors, ['records.csv が移行用フォルダに 2 個あります（1つにしてください）'], '同じ名前が2つ');
    setSetting_('MIGRATION_FOLDER_ID', '');
    resetExecutionCache_();
    assertEq_(readMigrationFiles_().errors, ['設定シートの MIGRATION_FOLDER_ID が空です'], 'フォルダ ID が空');
  } finally {
    setSetting_('MIGRATION_FOLDER_ID', keep);
    resetExecutionCache_();
  }
}

// ---------------------------------------------------------------------
// TC-QY 参照（今の設定・直近の記録）
// ---------------------------------------------------------------------

/** 有効な操作者の ctx（テスト用。最初の有効な入力者） */
function testCtx_() {
  const op = getOperators_().filter(function (o) { return o.active; })[0];
  if (!op) throw skip_('有効な入力者がいません');
  return { operatorId: op.operatorId, token: null };
}

/** テスト用の記録を足す（finally で removeTestRecords_ を呼ぶこと） */
function addTestRecord_(id, changedAt, createdAt) {
  const p = getPatterns_()[0];
  appendRow_('RECORDS', {
    date: parseDate_(formatDate_(changedAt)), time: Utilities.formatDate(changedAt, TZ, 'HH:mm'), pattern: p.pattern, fuel: 'ガス', pressure: p.mainPressure,
    setterName: 'T', recordId: id, changedAt: changedAt, setterId: 'U01', source: SOURCES.APP, createdAt: createdAt, createdBy: 'U01',
    updatedAt: createdAt, updatedBy: 'U01', version: 1, deleted: false, masterDiff: false
  });
}

/** テスト用の記録（記録ID が TEST- で始まる行）を物理的に消す（業務の記録は物理削除しない） */
function removeTestRecords_() {
  resetExecutionCache_();
  const sh = getSheet_('RECORDS');
  readAll_('RECORDS').filter(function (r) { return String(r.recordId).indexOf('TEST-') === 0; })
    .map(function (r) { return r._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (row) { sh.deleteRow(row); });
  resetExecutionCache_();
}

function test_QY01_() {
  const res = getHome(testCtx_());
  assertTrue_(res.ok, JSON.stringify(res.error));
  resetExecutionCache_();
  const expected = readAll_('RECORDS').filter(function (r) { return !r.deleted; })
    .sort(function (a, b) { return b.changedAt.getTime() - a.changedAt.getTime(); })[0];
  if (!expected) { assertEq_(res.data.current, null, '記録が無いとき'); return '記録なし'; }
  assertEq_(res.data.current.recordId, expected.recordId, '今の設定');
  assertEq_(res.data.recent[0].recordId, expected.recordId, '直近の先頭');
  assertTrue_(res.data.recent.length <= getSettingNumber_('RECENT_COUNT'), '直近の件数');
  for (let i = 1; i < res.data.recent.length; i++) assertTrue_(res.data.recent[i - 1].changedAt >= res.data.recent[i].changedAt, '直近が新しい順');
  assertTrue_(res.data.recent.every(function (r) { return !r.deleted; }), '直近に削除済みが無い');
  assertTrue_(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(res.data.current.changedAt), '変更日時は文字列: ' + res.data.current.changedAt);
}

function test_QY02_() {
  try {
    addTestRecord_('TEST-QY02-A', new Date(2031, 0, 1, 9, 0), new Date());
    addTestRecord_('TEST-QY02-B', new Date(2031, 0, 2, 9, 0), new Date());
    let res = getHome(testCtx_());
    assertEq_(res.data.current.recordId, 'TEST-QY02-B', '削除前');
    resetExecutionCache_();
    updateRow_('RECORDS', findRowIndex_('RECORDS', 'recordId', 'TEST-QY02-B'), { deleted: true });
    res = getHome(testCtx_());
    assertEq_(res.data.current.recordId, 'TEST-QY02-A', '削除後は1つ前');
  } finally {
    removeTestRecords_();
  }
}

function test_QY03_() {
  try {
    const same = new Date(2031, 5, 1, 10, 0);
    addTestRecord_('TEST-QY03-OLD', same, new Date(2031, 5, 1, 10, 1));
    addTestRecord_('TEST-QY03-NEW', same, new Date(2031, 5, 1, 10, 5));
    addTestRecord_('TEST-QY03-OLD2', same, new Date(2031, 5, 1, 10, 2));
    const res = getHome(testCtx_());
    assertEq_(res.data.current.recordId, 'TEST-QY03-NEW', '登録日時が新しい方');
    assertEq_(res.data.recent.slice(0, 3).map(function (r) { return r.recordId; }), ['TEST-QY03-NEW', 'TEST-QY03-OLD2', 'TEST-QY03-OLD'], '並び');
  } finally {
    removeTestRecords_();
  }
}

function test_QY04_() {
  const bad = getHome({ operatorId: 'U99', token: null });
  assertEq_(bad.ok, false);
  assertEq_([bad.error.code, bad.error.detail && bad.error.detail.need], ['AUTH_REQUIRED', 'operator'], 'getHome のエラー');
  const inactive = getOperators_().filter(function (o) { return !o.active; })[0];
  if (inactive) assertEq_(getHome({ operatorId: inactive.operatorId }).error.code, 'AUTH_REQUIRED', '無効な人');
  const init = getInitialData({ operatorId: '', token: null });
  assertTrue_(init.ok, JSON.stringify(init.error));
  assertEq_([init.data.operatorValid, init.data.recent.length, init.data.isAdmin], [false, 0, false], '未選択の getInitialData');
  assertTrue_(init.data.patterns.length > 0 && init.data.operators.length > 0, 'マスタが返る');
  const keys = Object.keys(init.data.settings).sort();
  assertEq_(keys, PUBLIC_SETTING_KEYS.slice().sort(), '画面に返す設定のキー');
  assertEq_(typeof init.data.settings.PRESSURE_MIN, 'number', '数値の設定は数値');
  const ok = getInitialData(testCtx_());
  assertEq_(ok.data.operatorValid, true, '有効な人');
}

// ---------------------------------------------------------------------
// TC-IN 入力（登録したテスト用の記録は、終わったら物理的に消す）
// ---------------------------------------------------------------------

/** 登録できる payload（2031年の日付にして、本物の「今の設定」と区別しやすくする） */
function validPayload_(ctx, over) {
  const p = findPattern_(2) || getPatterns_().filter(function (x) { return x.active; })[0];
  const product = getProducts_().filter(function (x) { return x.active; })[0];
  const base = { date: '2031-03-01', time: '09:15', pattern: p.pattern, fuel: 'ガス', pressure: p.mainPressure, setterId: ctx.operatorId, product: product ? product.name : '', note: 'テスト登録' };
  Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
  return base;
}

/** テストで登録した記録を物理的に消す（業務の記録は物理削除しない） */
function removeRecordsByIds_(ids) {
  resetExecutionCache_();
  const sh = getSheet_('RECORDS');
  readAll_('RECORDS').filter(function (r) { return ids.indexOf(r.recordId) >= 0; })
    .map(function (r) { return r._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (row) { sh.deleteRow(row); });
  resetExecutionCache_();
}

function expectValidation_(res, keys, msg) {
  assertEq_(res.ok, false, msg + ': 登録できてしまった');
  assertEq_(res.error.code, 'VALIDATION', msg + ': エラーコード');
  keys.forEach(function (k) { assertTrue_(res.error.fields && res.error.fields[k], msg + ': fields.' + k + ' が無い（' + JSON.stringify(res.error.fields) + '）'); });
}

function test_IN01_() {
  const ctx = testCtx_();
  const before = readAll_('RECORDS').length;
  const res = createRecord(ctx, validPayload_(ctx));
  try {
    assertTrue_(res.ok, JSON.stringify(res.error));
    assertTrue_(/^BP-20310301-\d{3}$/.test(res.data.recordId), '記録ID: ' + res.data.recordId);
    assertEq_([res.data.version, res.data.masterDiff], [1, false]);
    resetExecutionCache_();
    assertEq_(readAll_('RECORDS').length, before + 1, '1行増える');
    const r = readAll_('RECORDS').filter(function (x) { return x.recordId === res.data.recordId; })[0];
    const op = findOperator_(ctx.operatorId);
    assertEq_([formatDate_(r.date), r.time, formatDateTime_(r.changedAt), r.fuel, r.setterId, r.setterName, r.source, r.createdBy, r.updatedBy, r.version, r.deleted, r.note],
      ['2031/03/01', '09:15', '2031/03/01 09:15', 'ガス', ctx.operatorId, op.shortName, 'アプリ', ctx.operatorId, ctx.operatorId, 1, false, 'テスト登録'], '保存した値');
    const log = readAll_('LOGS').filter(function (l) { return l.recordId === res.data.recordId; })[0];
    assertTrue_(log && log.action === '登録' && log.role === '設定者', '操作ログ「登録」');
    const home = getHome(ctx);
    assertEq_(home.data.current.recordId, res.data.recordId, '登録した記録が今の設定になる');
  } finally {
    if (res.ok) removeRecordsByIds_([res.data.recordId]);
  }
}

function test_IN03_() {
  const ctx = testCtx_();
  const p2 = findPattern_(2);
  if (!p2) throw skip_('パターン2がありません');
  const res = createRecord(ctx, validPayload_(ctx, { pattern: 2, pressure: round2_(p2.mainPressure - 0.02) }));
  try {
    assertTrue_(res.ok, JSON.stringify(res.error));
    assertEq_(res.data.masterDiff, true, 'masterDiff');
    resetExecutionCache_();
    const r = readAll_('RECORDS').filter(function (x) { return x.recordId === res.data.recordId; })[0];
    assertEq_([r.masterDiff, r.pressure], [true, round2_(p2.mainPressure - 0.02)], 'シートの値');
  } finally {
    if (res.ok) removeRecordsByIds_([res.data.recordId]);
  }
}

function test_IN04_() {
  const ctx = testCtx_();
  const before = readAll_('RECORDS').length;
  ['0.49', '0.81', '0.675', 'abc', '', '-0.6'].forEach(function (v) {
    expectValidation_(createRecord(ctx, validPayload_(ctx, { pressure: v })), ['pressure'], '圧力 ' + v);
  });
  resetExecutionCache_();
  assertEq_(readAll_('RECORDS').length, before, '書き込んでいない');
  const edge = createRecord(ctx, validPayload_(ctx, { pressure: '０．５０' }));
  try { assertTrue_(edge.ok, '全角の 0.50（下限ちょうど）: ' + JSON.stringify(edge.error)); }
  finally { if (edge.ok) removeRecordsByIds_([edge.data.recordId]); }
}

function test_IN05_() {
  const ctx = testCtx_();
  expectValidation_(createRecord(ctx, validPayload_(ctx, { pattern: '', fuel: '', date: '', time: '' })), ['pattern', 'fuel', 'date', 'time'], '未入力');
  expectValidation_(createRecord(ctx, validPayload_(ctx, { date: '2031-02-30', time: '25:00' })), ['date', 'time'], '不正な日時');
  expectValidation_(createRecord(ctx, validPayload_(ctx, { fuel: '灯油' })), ['fuel'], '燃料');
}

function test_IN06_() {
  const ctx = testCtx_();
  expectValidation_(createRecord(ctx, validPayload_(ctx, { pattern: 99 })), ['pattern'], '存在しないパターン');
  expectValidation_(createRecord(ctx, validPayload_(ctx, { product: '存在しない品種' })), ['product'], '存在しない品種');
  const p4 = findPattern_(4);
  if (!p4) return 'パターン4が無いため、無効なパターンは確かめていない';
  const row = p4._row;
  try {
    updateRow_('PATTERNS', row, { active: false });
    expectValidation_(createRecord(ctx, validPayload_(ctx, { pattern: 4, pressure: p4.mainPressure })), ['pattern'], '無効なパターン');
  } finally {
    updateRow_('PATTERNS', row, { active: p4.active });
    resetExecutionCache_();
  }
}

function test_IN07_() {
  const ctx = testCtx_();
  const max = getSettingNumber_('NOTE_MAX_LENGTH');
  expectValidation_(createRecord(ctx, validPayload_(ctx, { note: new Array(max + 2).join('あ') })), ['note'], (max + 1) + '文字');
  const ok = createRecord(ctx, validPayload_(ctx, { note: '  ' + new Array(max + 1).join('い') + '  ' }));
  try {
    assertTrue_(ok.ok, max + '文字（前後の空白は取る）: ' + JSON.stringify(ok.error));
  } finally {
    if (ok.ok) removeRecordsByIds_([ok.data.recordId]);
  }
}

function test_IN08_() {
  const ctx = testCtx_();
  const other = getOperators_().filter(function (o) { return o.active && o.operatorId !== ctx.operatorId; })[0];
  if (!other) throw skip_('有効な入力者が2人以上いません');
  const res = createRecord(ctx, validPayload_(ctx, { setterId: other.operatorId }));
  assertEq_([res.ok, res.error && res.error.code], [false, 'FORBIDDEN']);
}

function test_IN10_() {
  const ctx = testCtx_();
  const res = createRecord(ctx, validPayload_(ctx, { recordId: 'HACK-1', version: 99, source: '移行', createdBy: 'SYSTEM', deleted: true, masterDiff: true }));
  try {
    assertTrue_(res.ok, JSON.stringify(res.error));
    assertTrue_(res.data.recordId !== 'HACK-1', '記録ID');
    resetExecutionCache_();
    const r = readAll_('RECORDS').filter(function (x) { return x.recordId === res.data.recordId; })[0];
    assertEq_([r.version, r.source, r.createdBy, r.deleted, r.masterDiff], [1, 'アプリ', ctx.operatorId, false, false], 'システム項目');
  } finally {
    if (res.ok) removeRecordsByIds_([res.data.recordId]);
  }
}

function test_IN12_() {
  const res = createRecord({ operatorId: 'U99', token: null }, validPayload_({ operatorId: 'U99' }));
  assertEq_([res.ok, res.error.code, res.error.detail && res.error.detail.need], [false, 'AUTH_REQUIRED', 'operator']);
}

// ---------------------------------------------------------------------
// TC-LS 履歴
// ---------------------------------------------------------------------

/**
 * 管理者の ctx（テスト用）。authenticateAdmin（フェーズ6）を通さず、キャッシュに直接トークンを置く。
 * 使い終わったら dropTestToken_(ctx) で消す
 */
function adminCtxForTest_() {
  const ctx = testCtx_();
  const token = 'test-' + uuid_();
  CacheService.getScriptCache().put('auth:' + token, JSON.stringify({ operatorId: ctx.operatorId, expiresAt: new Date().getTime() + 600000 }), 600);
  ctx.token = token;
  return ctx;
}
function dropTestToken_(ctx) { if (ctx && ctx.token) CacheService.getScriptCache().remove('auth:' + ctx.token); }

/** 期待値の計算用: 削除されていない記録を新しい順に */
function expectedRows_(pred, includeDeleted) {
  resetExecutionCache_();
  return sortRecords_(readAll_('RECORDS').filter(function (r) { return r.recordId && (includeDeleted || !r.deleted) && (!pred || pred(r)); }));
}

function ids_(list) { return list.map(function (r) { return r.recordId; }); }

function test_LS01_() {
  const ctx = testCtx_();
  const size = historyPageSize_();
  const exp = expectedRows_();
  const res = listRecords(ctx, {}, 1);
  assertTrue_(res.ok, JSON.stringify(res.error));
  assertEq_(res.data.total, exp.length, 'total');
  assertEq_(ids_(res.data.items), ids_(exp.slice(0, size)), '新しい順の先頭 ' + size + ' 件');
  assertEq_([res.data.page, res.data.pageCount, res.data.pageSize, res.data.offset], [1, Math.max(1, Math.ceil(exp.length / size)), size, 0], 'page・pageCount・pageSize・offset');
  assertEq_(res.data.hasMore, exp.length > size, 'hasMore');
  assertEq_(ids_(listRecords(ctx, {}, 0).data.items), ids_(res.data.items), 'ページ番号が0なら1ページ目');
  assertTrue_(res.data.items.every(function (r) { return !r.deleted; }), '削除済みが無い');
  return '全 ' + exp.length + ' 件';
}

function test_LS02_() {
  const ctx = testCtx_();
  const exp = expectedRows_();
  if (exp.length < 3) throw skip_('記録が3件未満');
  const size = historyPageSize_();
  const last = Math.ceil(exp.length / size);
  const res = listRecords(ctx, {}, last);
  assertEq_(ids_(res.data.items), ids_(exp.slice((last - 1) * size)), '最後のページ');
  assertEq_([res.data.page, res.data.hasMore, res.data.offset], [last, false, (last - 1) * size], 'page・hasMore・offset');
  assertEq_(listRecords(ctx, {}, last + 10).data.page, last, 'ページ数を超えた番号は最後のページ');
}

function test_LS09_() {
  const ctx = testCtx_();
  const before = getSetting_('HISTORY_PAGE_SIZE');
  const exp = expectedRows_();
  if (exp.length < 8) throw skip_('記録が8件未満');
  try {
    setSetting_('HISTORY_PAGE_SIZE', '7'); resetExecutionCache_();
    const p2 = listRecords(ctx, {}, 2).data;
    assertEq_([p2.pageSize, p2.pageCount, p2.offset], [7, Math.ceil(exp.length / 7), 7], '7件ずつ');
    assertEq_(ids_(p2.items), ids_(exp.slice(7, 14)), '2ページ目の中身');
    ['3', '101', '7.5', 'abc'].forEach(function (v) {
      setSetting_('HISTORY_PAGE_SIZE', v); resetExecutionCache_();
      assertEq_(listRecords(ctx, {}, 1).data.pageSize, 20, '「' + v + '」なら 20');
    });
  } finally {
    setSetting_('HISTORY_PAGE_SIZE', before); resetExecutionCache_();
  }
}

function test_LS03_() {
  const ctx = testCtx_();
  const all = expectedRows_();
  if (!all.length) throw skip_('記録がありません');
  const d = formatDate_(all[Math.floor(all.length / 2)].date);
  const one = listRecords(ctx, { dateFrom: d.replace(/\//g, '-'), dateTo: d }, 0);
  const exp = all.filter(function (r) { return formatDate_(r.date) === d; });
  assertEq_(ids_(one.data.items), ids_(exp), d + ' の1日だけ');
  const last = all[0], first = all[all.length - 1];
  const both = listRecords(ctx, { dateFrom: formatDate_(first.date), dateTo: formatDate_(last.date) }, 0);
  assertEq_(both.data.total, all.length, '最初の日から最後の日まで（両端を含む）');
  expectValidation_(listRecords(ctx, { dateFrom: '2026-02-30' }, 0), ['dateFrom'], '不正な日付');
}

function test_LS04_() {
  const ctx = testCtx_();
  const all = expectedRows_();
  const sample = all.filter(function (r) { return r.setterId && r.product; })[0];
  if (!sample) throw skip_('設定者と品種のある記録がありません');
  const filter = { pattern: sample.pattern, fuel: sample.fuel, setterId: sample.setterId, product: sample.product };
  const exp = all.filter(function (r) { return r.pattern === sample.pattern && r.fuel === sample.fuel && r.setterId === sample.setterId && r.product === sample.product; });
  const res = listRecords(ctx, filter, 0);
  assertEq_(res.data.total, exp.length, '件数');
  assertEq_(ids_(res.data.items), ids_(exp.slice(0, historyPageSize_())), '中身');
  const pOnly = listRecords(ctx, { pattern: String(sample.pattern) }, 0);
  assertEq_(pOnly.data.total, all.filter(function (r) { return r.pattern === sample.pattern; }).length, 'パターンだけ（文字列で渡す）');
  return JSON.stringify(filter) + ' → ' + exp.length + ' 件';
}

function test_LS05_() {
  const ctx = testCtx_();
  const exp = expectedRows_(function (r) { return !r.product; });
  const res = listRecords(ctx, { product: PRODUCT_UNSET }, 0);
  assertEq_(res.data.total, exp.length, '品種が空の件数');
  assertTrue_(res.data.items.every(function (r) { return r.product === ''; }), '品種が空だけ');
}

function test_LS06_() {
  const ctx = testCtx_();
  const res = listRecords(ctx, { includeDeleted: true }, 0);
  assertEq_(res.data.total, expectedRows_().length, '削除済みを含めない件数');
}

function test_LS07_() {
  const ctx = adminCtxForTest_();
  try {
    const withDel = expectedRows_(null, true);
    const res = listRecords(ctx, { includeDeleted: true }, 0);
    assertEq_(res.data.total, withDel.length, '削除済みも含めた件数');
    const deletedCount = withDel.filter(function (r) { return r.deleted; }).length;
    assertEq_(listRecords(ctx, {}, 0).data.total, withDel.length - deletedCount, '指定しなければ含めない');
    return '削除済み ' + deletedCount + ' 件';
  } finally {
    dropTestToken_(ctx);
  }
}

function test_LS08_() {
  const ctx = testCtx_();
  const admin = adminCtxForTest_();
  const created = createRecord(ctx, validPayload_(ctx, { note: '詳細のテスト' }));
  try {
    assertTrue_(created.ok, JSON.stringify(created.error));
    const id = created.data.recordId;
    // 本人（アプリで登録した自分の記録）
    let g = getRecord(ctx, id);
    assertTrue_(g.ok, JSON.stringify(g.error));
    assertEq_([g.data.record.recordId, g.data.record.note, g.data.record.source], [id, '詳細のテスト', 'アプリ'], '中身');
    assertEq_([g.data.canEdit, g.data.canDelete, g.data.canRestore, g.data.canChangeSetter], [true, false, false, false], '本人の権限');
    // 他人
    const other = getOperators_().filter(function (o) { return o.active && o.operatorId !== ctx.operatorId; })[0];
    if (other) {
      g = getRecord({ operatorId: other.operatorId }, id);
      assertEq_([g.data.canEdit, g.data.canDelete], [false, false], '他人の権限');
    }
    // 移行データ（本人でも直せない。D-11）
    const mig = expectedRows_(function (r) { return r.source === SOURCES.MIGRATION && r.setterId; })[0];
    if (mig) {
      g = getRecord({ operatorId: mig.setterId }, mig.recordId);
      if (g.ok) assertEq_(g.data.canEdit, false, '移行データは本人でも直せない');
    }
    // 管理者
    g = getRecord(admin, id);
    assertEq_([g.data.canEdit, g.data.canDelete, g.data.canRestore, g.data.canChangeSetter], [true, true, false, true], '管理者の権限');
    // 削除済み
    resetExecutionCache_();
    updateRow_('RECORDS', findRowIndex_('RECORDS', 'recordId', id), { deleted: true });
    g = getRecord(ctx, id);
    assertEq_([g.ok, g.error && g.error.code], [false, 'NOT_FOUND'], '削除済みは設定者には見えない');
    g = getRecord(admin, id);
    assertEq_([g.ok, g.data.canEdit, g.data.canRestore], [true, false, true], '削除済みは管理者には見え、元に戻せる');
    assertEq_(getRecord(ctx, 'BP-00000000-999').error.code, 'NOT_FOUND', '無い記録');
  } finally {
    dropTestToken_(admin);
    if (created.ok) removeRecordsByIds_([created.data.recordId]);
  }
}

// ---------------------------------------------------------------------
// TC-AU 管理者の認証（暗証番号はテストの中で設定し、終わったら元に戻す）
// ---------------------------------------------------------------------

/** テスト用の暗証番号を設定して fn を実行し、設定・失敗回数・ロックを元に戻す */
function withTestPin_(pin, fn) {
  const keepSalt = getSetting_('ADMIN_PIN_SALT'), keepHash = getSetting_('ADMIN_PIN_HASH');
  const cache = CacheService.getScriptCache();
  try {
    cache.remove('pinfail'); cache.remove('pinlock');
    setAdminPin_(pin);
    resetExecutionCache_();
    return fn();
  } finally {
    cache.remove('pinfail'); cache.remove('pinlock');
    setSetting_('ADMIN_PIN_SALT', keepSalt);
    setSetting_('ADMIN_PIN_HASH', keepHash);
    resetExecutionCache_();
  }
}

function lastLog_() { resetExecutionCache_(); return readAll_('LOGS').slice(-1)[0]; }

function test_AU01_() {
  const ctx = testCtx_();
  withTestPin_('2468', function () {
    const res = authenticateAdmin(ctx.operatorId, '2468');
    assertTrue_(res.ok, JSON.stringify(res.error));
    assertTrue_(res.data.token && res.data.expiresAt > new Date().getTime(), 'token と expiresAt');
    const minutes = getSettingNumber_('AUTH_TOKEN_MINUTES');
    assertTrue_(Math.abs(res.data.expiresAt - new Date().getTime() - minutes * 60000) < 60000, '有効時間は ' + minutes + ' 分');
    assertEq_([lastLog_().action, lastLog_().role], ['管理者認証', '管理者'], '操作ログ');
    const c = checkAdmin({ operatorId: ctx.operatorId, token: res.data.token });
    assertEq_([c.data.admin, c.data.expiresAt], [true, res.data.expiresAt], 'checkAdmin');
    assertEq_(checkAdmin(ctx).data.admin, false, 'トークンなし');
    logoutAdmin({ operatorId: ctx.operatorId, token: res.data.token });
  });
}

function test_AU02_() {
  const ctx = testCtx_();
  withTestPin_('2468', function () {
    const res = authenticateAdmin(ctx.operatorId, '1357');
    assertEq_([res.ok, res.error.code], [false, 'AUTH_FAILED']);
    assertEq_(lastLog_().action, '管理者認証の失敗', '操作ログ');
    assertEq_(authenticateAdmin('U99', '2468').error.code, 'AUTH_REQUIRED', '無効な操作者');
  });
}

function test_AU03_() {
  const ctx = testCtx_();
  withTestPin_('2468', function () {
    const max = getSettingNumber_('PIN_MAX_FAILS');
    let res;
    for (let i = 1; i <= max; i++) {
      res = authenticateAdmin(ctx.operatorId, '0000');
      assertEq_(res.error.code, i < max ? 'AUTH_FAILED' : 'AUTH_LOCKED', i + '回目');
    }
    assertEq_(res.error.detail.minutes, getSettingNumber_('PIN_LOCK_MINUTES'), 'ロックの分数');
    assertEq_(lastLog_().action, '管理者認証のロック', '操作ログ');
    res = authenticateAdmin(ctx.operatorId, '2468');
    assertEq_(res.error.code, 'AUTH_LOCKED', 'ロック中は正しい番号でも入れない');
  });
}

function test_AU04_() {
  const ctx = testCtx_();
  const token = 'test-expired-' + uuid_();
  CacheService.getScriptCache().put('auth:' + token, JSON.stringify({ operatorId: ctx.operatorId, expiresAt: new Date().getTime() - 1000 }), 60);
  try {
    const target = expectedRows_()[0];
    if (!target) throw skip_('記録がありません');
    const res = deleteRecord({ operatorId: ctx.operatorId, token: token }, target.recordId, target.version);
    assertEq_([res.ok, res.error.code, res.error.detail && res.error.detail.need], [false, 'AUTH_REQUIRED', 'admin']);
  } finally {
    CacheService.getScriptCache().remove('auth:' + token);
  }
}

function test_AU05_() {
  const admin = adminCtxForTest_();
  try {
    const other = getOperators_().filter(function (o) { return o.active && o.operatorId !== admin.operatorId; })[0];
    if (!other) throw skip_('有効な入力者が2人以上いません');
    const target = expectedRows_()[0];
    const res = deleteRecord({ operatorId: other.operatorId, token: admin.token }, target.recordId, target.version);
    assertEq_([res.ok, res.error.code], [false, 'AUTH_REQUIRED']);
    assertEq_(checkAdmin({ operatorId: other.operatorId, token: admin.token }).data.admin, false, 'checkAdmin');
  } finally {
    dropTestToken_(admin);
  }
}

function test_AU06_() {
  const admin = adminCtxForTest_();
  assertEq_(checkAdmin(admin).data.admin, true, 'ログアウト前');
  assertTrue_(logoutAdmin(admin).ok);
  assertEq_(checkAdmin(admin).data.admin, false, 'ログアウト後');
  const target = expectedRows_()[0];
  assertEq_(deleteRecord(admin, target.recordId, target.version).error.code, 'AUTH_REQUIRED', 'ログアウト後の削除');
}

// ---------------------------------------------------------------------
// TC-ED 修正・削除 / TC-LK 版数 / TC-LG 操作ログ（登録したテスト用の記録は、終わったら物理的に消す）
// ---------------------------------------------------------------------

/** テスト用に記録を1件登録して fn(記録ID, ctx) を実行し、最後に消す */
function withTestRecord_(ctx, over, fn) {
  const res = createRecord(ctx, validPayload_(ctx, over || {}));
  assertTrue_(res.ok, '準備の登録に失敗: ' + JSON.stringify(res.error));
  try { return fn(res.data.recordId); }
  finally { removeRecordsByIds_([res.data.recordId]); }
}

function recordById_(id) { resetExecutionCache_(); return readAll_('RECORDS').filter(function (r) { return r.recordId === id; })[0]; }

function test_ED01_() {
  const ctx = testCtx_();
  withTestRecord_(ctx, {}, function (id) {
    const res = updateRecord(ctx, id, { note: '修正後の備考', time: '10:30' }, 1);
    assertTrue_(res.ok, JSON.stringify(res.error));
    assertEq_([res.data.version, res.data.unchanged], [2, false]);
    const r = recordById_(id);
    assertEq_([r.note, r.time, formatDateTime_(r.changedAt), r.version, r.updatedBy], ['修正後の備考', '10:30', '2031/03/01 10:30', 2, ctx.operatorId], 'シートの値');
    const log = lastLog_();
    assertEq_([log.action, log.recordId, log.role], ['修正', id, '設定者'], '操作ログ');
    assertEq_(JSON.parse(log.detail).changes, { time: ['09:15', '10:30'], note: ['テスト登録', '修正後の備考'] }, '変更前後');
  });
}

function test_ED02_() {
  const ctx = testCtx_();
  withTestRecord_(ctx, {}, function (id) {
    const old = new Date(new Date().getTime() - 30 * 86400000);
    updateRow_('RECORDS', findRowIndex_('RECORDS', 'recordId', id), { createdAt: old, updatedAt: old });
    const res = updateRecord(ctx, id, { note: '30日後の修正' }, 1);
    assertTrue_(res.ok, JSON.stringify(res.error));
  });
}

function test_ED03_() {
  const ctx = testCtx_();
  const other = getOperators_().filter(function (o) { return o.active && o.operatorId !== ctx.operatorId; })[0];
  if (!other) throw skip_('有効な入力者が2人以上いません');
  withTestRecord_(ctx, {}, function (id) {
    const res = updateRecord({ operatorId: other.operatorId, token: null }, id, { note: '他人の修正' }, 1);
    assertEq_([res.ok, res.error.code], [false, 'FORBIDDEN']);
    assertEq_(recordById_(id).note, 'テスト登録', '変わっていない');
  });
}

function test_ED04_() {
  const ctx = testCtx_();
  withTestRecord_(ctx, {}, function (id) {
    updateRow_('RECORDS', findRowIndex_('RECORDS', 'recordId', id), { source: SOURCES.MIGRATION });
    const res = updateRecord(ctx, id, { note: '移行データの修正' }, 1);
    assertEq_([res.ok, res.error.code], [false, 'FORBIDDEN']);
  });
}

function test_ED05_() {
  const ctx = testCtx_();
  const other = getOperators_().filter(function (o) { return o.active && o.operatorId !== ctx.operatorId; })[0];
  if (!other) throw skip_('有効な入力者が2人以上いません');
  withTestRecord_(ctx, {}, function (id) {
    const res = updateRecord(ctx, id, { setterId: other.operatorId }, 1);
    assertEq_([res.ok, res.error.code], [false, 'FORBIDDEN']);
  });
}

function test_ED06_() {
  const ctx = testCtx_();
  const admin = adminCtxForTest_();
  const other = getOperators_().filter(function (o) { return o.active && o.operatorId !== ctx.operatorId; })[0];
  try {
    withTestRecord_(ctx, {}, function (id) {
      updateRow_('RECORDS', findRowIndex_('RECORDS', 'recordId', id), { source: SOURCES.MIGRATION });
      const payload = { note: '管理者の修正' };
      if (other) payload.setterId = other.operatorId;
      const res = updateRecord(admin, id, payload, 1);
      assertTrue_(res.ok, JSON.stringify(res.error));
      const r = recordById_(id);
      assertEq_(r.note, '管理者の修正');
      if (other) assertEq_([r.setterId, r.setterName], [other.operatorId, other.shortName], '設定者を変えた');
      assertEq_(lastLog_().role, '管理者', 'ログの役割');
    });
  } finally {
    dropTestToken_(admin);
  }
}

function test_ED07_() {
  const ctx = testCtx_();
  const admin = adminCtxForTest_();
  try {
    withTestRecord_(ctx, {}, function (id) {
      const res = deleteRecord(admin, id, 1);
      assertTrue_(res.ok, JSON.stringify(res.error));
      const r = recordById_(id);
      assertEq_([r.deleted, r.deletedBy, r.version, !!r.deletedAt], [true, admin.operatorId, 2, true], '論理削除');
      assertEq_([lastLog_().action, lastLog_().recordId], ['削除', id], '操作ログ');
      assertTrue_(listRecords(ctx, {}, 0).data.items.every(function (x) { return x.recordId !== id; }), '一覧から消える');
      assertEq_(getRecord(ctx, id).error.code, 'NOT_FOUND', '設定者には見えない');
      assertEq_(deleteRecord(admin, id, 2).error.code, 'NOT_FOUND', '削除済みをもう一度削除');
      assertEq_(updateRecord(admin, id, { note: 'x' }, 2).error.code, 'NOT_FOUND', '削除済みは修正できない');
    });
  } finally {
    dropTestToken_(admin);
  }
}

function test_ED08_() {
  const ctx = testCtx_();
  const admin = adminCtxForTest_();
  try {
    withTestRecord_(ctx, {}, function (id) {
      assertTrue_(deleteRecord(admin, id, 1).ok, '削除');
      const res = restoreRecord(admin, id, 2);
      assertTrue_(res.ok, JSON.stringify(res.error));
      const r = recordById_(id);
      assertEq_([r.deleted, r.deletedBy, r.deletedAt, r.version], [false, '', null, 3], '元に戻した');
      assertEq_(lastLog_().action, '削除の取り消し', '操作ログ');
      assertEq_(restoreRecord(admin, id, 3).error.code, 'CONFLICT', '削除されていない記録を元に戻す');
    });
  } finally {
    dropTestToken_(admin);
  }
}

function test_ED09_() {
  const ctx = testCtx_();
  withTestRecord_(ctx, {}, function (id) {
    const res = deleteRecord(ctx, id, 1);
    assertEq_([res.ok, res.error.code, res.error.detail && res.error.detail.need], [false, 'AUTH_REQUIRED', 'admin']);
    assertEq_(restoreRecord(ctx, id, 1).error.code, 'AUTH_REQUIRED', '元に戻す');
    assertEq_(recordById_(id).deleted, false, '削除されていない');
  });
}

function test_ED10_() {
  const ctx = testCtx_();
  const p2 = findPattern_(2);
  if (!p2) throw skip_('パターン2がありません');
  withTestRecord_(ctx, { pattern: 2, pressure: p2.mainPressure }, function (id) {
    let res = updateRecord(ctx, id, { pressure: round2_(p2.mainPressure - 0.01) }, 1);
    assertEq_([res.ok, res.data.masterDiff], [true, true], '基準と違う圧力に');
    res = updateRecord(ctx, id, { pressure: p2.mainPressure }, 2);
    assertEq_(res.data.masterDiff, false, '基準に戻す');
    const logs = readAll_('LOGS').length;
    res = updateRecord(ctx, id, { note: 'テスト登録', date: '2031/03/01' }, 3);
    assertEq_([res.ok, res.data.unchanged, res.data.version], [true, true, 3], '変わっていなければ書き込まない');
    resetExecutionCache_();
    assertEq_(readAll_('LOGS').length, logs, 'ログも書かない');
    expectValidation_(updateRecord(ctx, id, { pressure: '0.99' }, 3), ['pressure'], '修正でも入力チェック');
  });
}

function test_LK01_() {
  const ctx = testCtx_();
  const admin = adminCtxForTest_();
  try {
    withTestRecord_(ctx, {}, function (id) {
      assertTrue_(updateRecord(ctx, id, { note: '1回目' }, 1).ok, '1回目の修正');
      const res = updateRecord(ctx, id, { note: '古い版での修正' }, 1);
      assertEq_([res.ok, res.error.code], [false, 'CONFLICT']);
      assertEq_([recordById_(id).note, recordById_(id).version], ['1回目', 2], 'シートは変わらない');
      assertEq_(deleteRecord(admin, id, 1).error.code, 'CONFLICT', '古い版での削除');
    });
  } finally {
    dropTestToken_(admin);
  }
}

function test_LG01_() {
  const ctx = testCtx_();
  assertEq_(listOperationLogs(ctx, 0).error.code, 'AUTH_REQUIRED', '設定者は見られない');
  const admin = adminCtxForTest_();
  try {
    writeLog_(admin, ROLES.ADMIN, 'BACKUP', '', { test: true });
    const res = listOperationLogs(admin, 0);
    assertTrue_(res.ok, JSON.stringify(res.error));
    assertEq_(res.data.items[0].action, 'バックアップ', '新しい順の先頭');
    assertTrue_(res.data.items.length <= getSettingNumber_('PAGE_SIZE'), '件数');
    assertTrue_(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(res.data.items[0].loggedAt), '日時の形');
  } finally {
    dropTestToken_(admin);
  }
}

// ---------------------------------------------------------------------
// TC-BK バックアップ（ドライブとトリガーはローカル（フェイク）でだけ確かめる。GAS 上では実際に作られるので SKIP）
// ---------------------------------------------------------------------

function withBackupFolder_(fn) {
  if (!hasFakes_()) throw skip_('ドライブへの複製・トリガーはローカル（フェイク）で確かめる。GAS 上はメニュー「今すぐバックアップ」で確かめる');
  const keep = getSetting_('BACKUP_FOLDER_ID');
  try {
    const folderId = __FAKES__.addFolder('バックアップテスト');
    setSetting_('BACKUP_FOLDER_ID', folderId);
    resetExecutionCache_();
    return fn(folderId);
  } finally {
    setSetting_('BACKUP_FOLDER_ID', keep);
    resetExecutionCache_();
  }
}

function filesIn_(folderId) {
  const out = [];
  const it = DriveApp.getFolderById(folderId).getFiles();
  while (it.hasNext()) { const f = it.next(); out.push({ name: f.getName(), trashed: f.isTrashed() }); }
  return out;
}

function test_BK01_() {
  withBackupFolder_(function (folderId) {
    const r = menuBackupNow();
    assertTrue_(r.ok, r.message);
    const name = BACKUP_PREFIX + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
    assertEq_(r.fileName, name, 'ファイル名');
    assertEq_(filesIn_(folderId).filter(function (f) { return f.name === name && !f.trashed; }).length, 1, 'フォルダに複製がある');
    assertEq_([lastLog_().action, lastLog_().role], ['バックアップ', 'システム'], '操作ログ');
    setSetting_('BACKUP_FOLDER_ID', '');
    resetExecutionCache_();
    const none = runMonthlyBackup();
    assertEq_(none.ok, false, 'フォルダ ID が空');
  });
}

function test_BK02_() {
  withBackupFolder_(function (folderId) {
    const day = 86400000, now = new Date().getTime();
    __FAKES__.addFile(folderId, BACKUP_PREFIX + 'old', 'x', 'application/octet-stream', now - 400 * day);   // 13か月以上前
    __FAKES__.addFile(folderId, BACKUP_PREFIX + 'recent', 'x', 'application/octet-stream', now - 300 * day); // 10か月前
    __FAKES__.addFile(folderId, '別のファイル', 'x', 'application/octet-stream', now - 900 * day);          // 名前が違うものは消さない
    const r = runMonthlyBackup();
    assertEq_([r.ok, r.removed], [true, 1], '消した件数');
    const files = filesIn_(folderId);
    const st = function (n) { return files.filter(function (f) { return f.name === n; })[0].trashed; };
    assertEq_([st(BACKUP_PREFIX + 'old'), st(BACKUP_PREFIX + 'recent'), st('別のファイル')], [true, false, false], 'ゴミ箱へ移ったもの');
  });
}

function test_BK03_() {
  if (!hasFakes_()) throw skip_('トリガーはローカル（フェイク）で確かめる（GAS 上で実行すると本当にトリガーができるため）');
  menuSetupBackupTrigger();
  menuSetupBackupTrigger();
  const ts = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'runMonthlyBackup'; });
  assertEq_(ts.length, 1, 'トリガーの数');
}

// ---------------------------------------------------------------------
// TC-ST スプレッドシートの見た目
// ---------------------------------------------------------------------

function test_ST01_() {
  const info = headerInfo_('RECORDS');
  const visible = ['date', 'time', 'pattern', 'fuel', 'pressure', 'setterName', 'product', 'note', 'masterDiff'];
  assertEq_(visible.map(function (k) { return info.cols[k]; }), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'A〜I 列');
  const sh = getSheet_('RECORDS');
  for (let c = 10; c <= info.width; c++) assertEq_(sh.getColumnGroupDepth(c), 1, columnLetter_(c) + ' 列のグループ');
}

function test_ST02_() {
  if (!hasFakes_()) throw skip_('条件付き書式の中身はローカル（フェイク）で確かめる（GAS 上はシートを開いて目で確かめる）');
  const rules = getSheet_('RECORDS').getConditionalFormatRules();
  const del = rules.filter(function (r) { return r.formula === '=$T2=TRUE'; })[0];
  const diff = rules.filter(function (r) { return r.formula === '=$I2=TRUE'; })[0];
  assertTrue_(del && del.strikethrough && del.fontColor === '#94a3b8', '削除済みの書式: ' + JSON.stringify(del));
  assertTrue_(diff && diff.background === '#fef3c7', 'マスタとの差異の書式: ' + JSON.stringify(diff));
  assertEq_([del.ranges[0].c, del.ranges[0].nc, diff.ranges[0].c, diff.ranges[0].nc], [1, 22, 9, 1], '範囲');
}

function test_ST03_() {
  Object.keys(SHEETS).forEach(function (k) {
    assertEq_(getSheet_(k).getProtections(SpreadsheetApp.ProtectionType.SHEET).length, 1, SHEETS[k] + ' の保護');
  });
}

// ---------------------------------------------------------------------
// 開発用データ（架空。実在の人物ではない）
// ---------------------------------------------------------------------

const DEV_OPERATORS_ = [
  { operatorId: 'U01', shortName: 'A', fullName: '架空 一郎', sortOrder: 1, active: true, note: '' },
  { operatorId: 'U02', shortName: 'B', fullName: '架空 二郎', sortOrder: 2, active: true, note: '' },
  { operatorId: 'U03', shortName: 'C', fullName: '架空 三郎', sortOrder: 3, active: true, note: '' },
  { operatorId: 'U04', shortName: 'D', fullName: '架空 四郎', sortOrder: 4, active: true, note: '' },
  { operatorId: 'U05', shortName: 'E', fullName: '架空 五郎', sortOrder: 5, active: true, note: '' },
  { operatorId: 'U06', shortName: 'F', fullName: '架空 六郎', sortOrder: 6, active: false, note: '退職' }
];

/** 基準パターンの初期データ（docs/03 §3.1。本番は移行データから入れる） */
const DEV_PATTERNS_ = [
  { pattern: 1, mainPressure: 0.66, subPressure: 0.64, products: '小型(0.35〜1.0L)', note: '2024.7.19時点', sortOrder: 1, active: true },
  { pattern: 2, mainPressure: 0.67, subPressure: 0.65, products: '1.5L(お茶)、2L(水、スポーツ)、2L(麦茶なし)', note: '2024.11.22時点更新', sortOrder: 2, active: true },
  { pattern: 3, mainPressure: 0.68, subPressure: 0.66, products: '2L(麦茶あり)', note: '2024.11.22時点更新', sortOrder: 3, active: true },
  { pattern: 4, mainPressure: 0.69, subPressure: 0.67, products: '', note: '', sortOrder: 4, active: true },
  { pattern: 5, mainPressure: 0.65, subPressure: 0.63, products: '小型(0.35〜1.0L)', note: '2025.1.29新設（メイン0.70→0.65に変更）', sortOrder: 5, active: true }
];

/**
 * 開発用のサンプルデータを入れる（K-48 相当。plan/07 T1-8）。
 * 入力者・パターンは空のときだけ入れる。記録は1件もないときだけ30件入れる
 * （古い10件はデータ区分「移行」、1件は削除済み、3件はマスタとの差異あり）
 */
function seedDevData() {
  resetExecutionCache_();
  return withLock_(function () {
    const msgs = [];
    if (!readAll_('OPERATORS').length) { appendRows_('OPERATORS', DEV_OPERATORS_); msgs.push('入力者 ' + DEV_OPERATORS_.length + '名'); }
    if (!readAll_('PATTERNS').length) { appendRows_('PATTERNS', DEV_PATTERNS_); msgs.push('パターン ' + DEV_PATTERNS_.length + '件'); }
    if (readAll_('RECORDS').length) {
      msgs.push('記録はすでにあるため追加しない');
    } else {
      const patternSeq = [2, 5, 3, 2, 5, 1];
      const productsByPattern = { 1: '小型(0.35〜1.0L)', 2: '2L(水、スポーツ)', 3: '2L(麦茶あり)', 5: '小型(水、スポーツ)' };
      const today = new Date();
      const now = new Date();
      const recs = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (29 - i) * 2 - 1); // 最新でも昨日（今より先の時刻にしない）
        const time = pad2_(6 + (i * 5) % 14) + ':' + pad2_((i * 17) % 60);
        const pat = findPattern_(patternSeq[i % patternSeq.length]);
        const pressure = i % 10 === 7 ? round2_(pat.mainPressure - 0.02) : pat.mainPressure;
        const op = findOperator_('U0' + ((i % 5) + 1));
        const isMigration = i < 10;
        const changedAt = combineDateTime_(d, time);
        recs.push({
          date: d, time: time, pattern: pat.pattern, fuel: i % 5 === 0 ? '重油' : 'ガス', pressure: pressure,
          setterName: op.shortName, product: i % 7 === 6 ? '' : productsByPattern[pat.pattern], note: i % 4 === 0 ? '' : 'サンプル備考 ' + (i + 1),
          masterDiff: calcMasterDiff_(pressure, pat), recordId: nextRecordId_(changedAt), changedAt: changedAt, setterId: op.operatorId,
          source: isMigration ? SOURCES.MIGRATION : SOURCES.APP, sourceRow: isMigration ? i + 2 : null,
          createdAt: isMigration ? now : changedAt, createdBy: isMigration ? SYSTEM_ID : op.operatorId,
          updatedAt: isMigration ? now : changedAt, updatedBy: isMigration ? SYSTEM_ID : op.operatorId,
          version: 1, deleted: i === 12, deletedAt: i === 12 ? now : null, deletedBy: i === 12 ? 'U01' : ''
        });
      }
      appendRows_('RECORDS', recs);
      msgs.push('記録 ' + recs.length + '件');
    }
    return '開発用データ: ' + msgs.join('、');
  });
}

function menuSeedDevData() { alert_(seedDevData()); }

/** ローカルプレビュー用に管理者暗証番号を設定する（tools/preview_mock.js から呼ぶ） */
function setAdminPinForPreview_(pin) { setAdminPin_(pin); return 'ok'; }
