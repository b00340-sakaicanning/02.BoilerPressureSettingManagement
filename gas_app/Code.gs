/**
 * ボイラ圧力設定管理 — サーバー側（Code.gs）
 * 版: v1.2（2026/11/15。フェーズ8: 履歴のページ分け・品種の集約と並び）
 *
 * 仕様の正: docs/03_データ設計.md、docs/04_実装仕様.md（計画: plan/02 §2.1）
 * 反映: このファイルの中身を、GAS エディタの Code.gs に丸ごと貼り替える（clasp は使わない）
 *
 * セクションの目次
 *   1 【Api】        doGet、include、handle_、AppError、画面から呼ぶ公開関数
 *   2 【Config】     定数（シート名、COLUMNS、FUELS、データ区分）、getSettings_
 *   3 【Utils】      日時の整形、"HH:mm" の正規化、数値の丸め、ハッシュ、uuid
 *   4 【Repository】 withLock_、readAll_、findRowIndex_、appendRow_、updateRow_
 *   5 【Masters】    パターン・入力者・品種の取得と検索
 *   6 【Auth】       管理者暗証番号の照合、トークンの発行と確認
 *   7 【Validator】  入力チェック
 *   8 【Records】    登録・修正・削除・元に戻す、採番、マスタとの差異
 *   9 【Query】      今の設定、直近の記録、履歴の検索
 *  10 【Log】        操作ログ
 *  11 【Migration】  移行 CSV の取込と照合
 *  12 【Backup】     バックアップ
 *  13 【Menu】       カスタムメニュー
 *
 * 内部用の関数は名前の末尾に _ を付ける（画面から呼べないようにする）。
 * Tests.gs（開発環境だけに貼る）は、このファイルの関数を呼ぶだけ。このファイルから Tests.gs は呼ばない。
 */

// =====================================================
// 【Api】 doGet、include、handle_、AppError、画面から呼ぶ公開関数
// =====================================================

/**
 * 想定したエラー（docs/04 第2部 §1.3 のエラーコード）。throw AppError(...) で使う。
 * fields は入力チェックのエラーのとき { キー: 文言 }、detail は追加の情報（AUTH_REQUIRED の need など）
 */
function AppError(code, message, fields, detail) {
  const e = new Error(message || code);
  e.isAppError = true;
  e.code = code;
  e.fields = fields || null;
  e.detail = detail || null;
  return e;
}

/** ウェブアプリの入口（docs/04 第2部 §7） */
function doGet(e) {
  resetExecutionCache_();
  let title = 'ボイラ圧力設定管理';
  try { title = getSetting_('APP_TITLE') || title; } catch (err) { /* シートが無くても画面は出す */ }
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** index.html から css.html・js.html を埋め込む */
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/**
 * 公開関数の共通の包み（docs/04 第2部 §1.2）。{ ok: true, data } か { ok: false, error: { code, message, fields, detail } }。
 * 想定外の例外は SYSTEM にして、詳しい内容は console.error に出す
 */
function handle_(fn) {
  resetExecutionCache_();
  try {
    const data = fn();
    return { ok: true, data: JSON.parse(JSON.stringify(data === undefined ? null : data)) };
  } catch (e) {
    if (e && e.isAppError) return { ok: false, error: { code: e.code, message: e.message, fields: e.fields || null, detail: e.detail || null } };
    console.error(e && e.stack ? e.stack : e);
    return { ok: false, error: { code: 'SYSTEM', message: 'エラーが起きました。時間をおいてもう一度お試しください。続くときは管理者に連絡してください', fields: null, detail: null } };
  }
}

/**
 * 起動時にまとめて返す（docs/04 第2部 §3）。操作者が未選択・無効でもエラーにしない（operatorValid で知らせる）
 */
function getInitialData(ctx) {
  return handle_(function () {
    const op = ctx && ctx.operatorId ? findOperator_(ctx.operatorId) : null;
    const operatorValid = !!(op && op.active);
    const opsById = operatorsById_();
    const active = activeRecordsSorted_();
    return {
      settings: publicSettings_(),
      fuels: FUELS.slice(),
      patterns: getPatterns_().map(function (p) {
        return { pattern: p.pattern, mainPressure: p.mainPressure, subPressure: p.subPressure, products: p.products, note: p.note,
          revisedAt: formatDate_(p.revisedAt), sortOrder: p.sortOrder, active: p.active };
      }),
      operators: getOperators_().map(function (o) { return { operatorId: o.operatorId, shortName: o.shortName, fullName: o.fullName, sortOrder: o.sortOrder, active: o.active }; }),
      products: getProducts_().map(function (p) { return { name: p.name, sortOrder: p.sortOrder, active: p.active }; }),
      operatorValid: operatorValid,
      isAdmin: operatorValid ? verifyAdmin_(ctx) : false,
      current: active.length ? toClientRecord_(active[0], opsById) : null,
      recent: operatorValid ? active.slice(0, getSettingNumber_('RECENT_COUNT')).map(function (r) { return toClientRecord_(r, opsById); }) : []
    };
  });
}

/** ホームの今の設定と直近の記録（docs/04 第2部 §3） */
function getHome(ctx) {
  return handle_(function () {
    verifyOperator_(ctx);
    const opsById = operatorsById_();
    const active = activeRecordsSorted_();
    return {
      current: active.length ? toClientRecord_(active[0], opsById) : null,
      recent: active.slice(0, getSettingNumber_('RECENT_COUNT')).map(function (r) { return toClientRecord_(r, opsById); })
    };
  });
}

// =====================================================
// 【Config】 定数、getSettings_
// =====================================================

const TZ = 'Asia/Tokyo';

/** シート名（docs/03 §1.1） */
const SHEETS = {
  RECORDS: '圧力設定変更履歴',
  PATTERNS: '基準パターンマスタ',
  OPERATORS: '入力者マスタ',
  PRODUCTS: '品種マスタ',
  SETTINGS: '設定',
  LOGS: '操作ログ'
};

/**
 * 列の定義 [見出し, キー, 型]（docs/03 §2・§3）。列は見出し名で探すので、シート上の順番は問わない。
 * 型: T=テキスト / HM=時刻の文字列 "HH:mm" / D=日付 / DT=日時 / N=整数 / N2=小数2桁 / B=真偽値
 */
const COLUMNS = {
  RECORDS: [
    ['日付', 'date', 'D'], ['時刻', 'time', 'HM'], ['設定パターン', 'pattern', 'N'], ['メインボイラ', 'fuel', 'T'],
    ['設定圧力(MPa)', 'pressure', 'N2'], ['設定者', 'setterName', 'T'], ['生産品種', 'product', 'T'], ['備考', 'note', 'T'],
    ['マスタとの差異', 'masterDiff', 'B'], ['記録ID', 'recordId', 'T'], ['変更日時', 'changedAt', 'DT'], ['設定者ID', 'setterId', 'T'],
    ['データ区分', 'source', 'T'], ['移行元行', 'sourceRow', 'N'], ['登録日時', 'createdAt', 'DT'], ['登録者ID', 'createdBy', 'T'],
    ['更新日時', 'updatedAt', 'DT'], ['更新者ID', 'updatedBy', 'T'], ['版数', 'version', 'N'], ['削除フラグ', 'deleted', 'B'],
    ['削除日時', 'deletedAt', 'DT'], ['削除者ID', 'deletedBy', 'T']
  ],
  PATTERNS: [
    ['パターン', 'pattern', 'N'], ['メイン圧力(MPa)', 'mainPressure', 'N2'], ['サブ圧力(MPa)', 'subPressure', 'N2'], ['主要品種', 'products', 'T'],
    ['注記', 'note', 'T'], ['改定日', 'revisedAt', 'D'], ['表示順', 'sortOrder', 'N'], ['有効', 'active', 'B']
  ],
  OPERATORS: [
    ['入力者ID', 'operatorId', 'T'], ['記入称', 'shortName', 'T'], ['氏名', 'fullName', 'T'], ['表示順', 'sortOrder', 'N'],
    ['有効', 'active', 'B'], ['備考', 'note', 'T']
  ],
  PRODUCTS: [
    ['品種名', 'name', 'T'], ['表示順', 'sortOrder', 'N'], ['有効', 'active', 'B']
  ],
  SETTINGS: [
    ['キー', 'key', 'T'], ['値', 'value', 'T'], ['説明', 'description', 'T']
  ],
  LOGS: [
    ['ログID', 'logId', 'T'], ['日時', 'loggedAt', 'DT'], ['操作者ID', 'operatorId', 'T'], ['操作者', 'operatorName', 'T'],
    ['役割', 'role', 'T'], ['記録ID', 'recordId', 'T'], ['操作', 'action', 'T'], ['内容', 'detail', 'T']
  ]
};

/** 型ごとのセルの書式 */
const NUMBER_FORMATS = { T: '@', HM: '@', D: 'yyyy/mm/dd', DT: 'yyyy/mm/dd hh:mm:ss', N: '0', N2: '0.00', B: 'General' };

/** 履歴シートで人が見る列（A〜I）の最後の見出し。これより右の列は列のグループで折りたたむ（K-13） */
const RECORDS_LAST_VISIBLE_HEADER = 'マスタとの差異';

/** 燃料の選択肢（K-06） */
const FUELS = ['ガス', '重油'];

/** データ区分 */
const SOURCES = { MIGRATION: '移行', APP: 'アプリ' };

/** 役割（操作ログ用） */
const ROLES = { SETTER: '設定者', ADMIN: '管理者', SYSTEM: 'システム' };

/** システムが行った操作の操作者ID（K-18） */
const SYSTEM_ID = 'SYSTEM';

/** 設定シートの初期値 [キー, 値, 説明]（docs/03 §3.4）。値はすべて文字列で持つ */
const SETTING_DEFAULTS = [
  ['APP_TITLE', 'ボイラ圧力設定管理', '画面のタイトル'],
  ['ENV', '開発', '開発 / 本番（開発のときはヘッダに「開発」バッジを出す）'],
  ['RECORD_ID_PREFIX', 'BP', '記録ID の頭の文字'],
  ['PRESSURE_MIN', '0.50', '設定圧力の下限（MPa）'],
  ['PRESSURE_MAX', '0.80', '設定圧力の上限（MPa）'],
  ['NOTE_MAX_LENGTH', '200', '備考の最大文字数'],
  ['PAGE_SIZE', '50', '操作ログを1回に読む件数'],
  ['HISTORY_PAGE_SIZE', '20', '履歴の1ページの件数（5〜100。範囲外は20）'],
  ['RECENT_COUNT', '5', 'ホームに出す直近の件数'],
  ['FUTURE_WARN_MINUTES', '10', 'これより先の日時は確認ダイアログで注意する（分）'],
  ['AUTH_TOKEN_MINUTES', '30', '管理者トークンの有効時間（分）'],
  ['PIN_MAX_FAILS', '5', '暗証番号を続けて間違えてよい回数'],
  ['PIN_LOCK_MINUTES', '15', '間違えすぎたときのロック時間（分）'],
  ['ADMIN_PIN_SALT', '', '管理者暗証番号の salt（メニュー「管理者暗証番号を設定」で作る。直接編集しない）'],
  ['ADMIN_PIN_HASH', '', '管理者暗証番号のハッシュ（メニュー「管理者暗証番号を設定」で作る。直接編集しない）'],
  ['MIGRATION_FOLDER_ID', '', '移行 CSV を置くフォルダの ID'],
  ['BACKUP_FOLDER_ID', '', 'バックアップの保存先フォルダの ID'],
  ['BACKUP_KEEP_MONTHS', '12', 'バックアップを残す月数']
];

/** 画面に返してよい設定キー（docs/03 §3.4） */
const PUBLIC_SETTING_KEYS = ['APP_TITLE', 'ENV', 'PRESSURE_MIN', 'PRESSURE_MAX', 'NOTE_MAX_LENGTH', 'PAGE_SIZE', 'FUTURE_WARN_MINUTES'];

/** 品種マスタの初期データ（D-20） */
const PRODUCTS_INITIAL = ['小型(0.35〜1.0L)', '小型(水、スポーツ)', '1.5L(お茶)', '1.5L(水、スポーツ)', '2L(麦茶あり)', '2L(麦茶なし)', '2L(水、スポーツ)', 'その他'];

/** 設定シートを読み、{キー: 値（文字列）} にする。1回の実行の中では使い回す */
function getSettings_() {
  if (EXEC_.settings) return EXEC_.settings;
  const map = {};
  SETTING_DEFAULTS.forEach(function (d) { map[d[0]] = d[1]; });
  const sh = getSpreadsheet_().getSheetByName(SHEETS.SETTINGS);
  if (sh && sh.getLastRow() >= 2) {
    readAll_('SETTINGS').forEach(function (r) { if (r.key) map[r.key] = r.value; });
  }
  EXEC_.settings = map;
  return map;
}

/** 設定値（文字列） */
function getSetting_(key) {
  const v = getSettings_()[key];
  return v === undefined || v === null ? '' : String(v);
}

/** 設定値（数値）。数値にできなければ初期値を使う */
function getSettingNumber_(key) {
  const n = Number(getSetting_(key));
  if (getSetting_(key) !== '' && isFinite(n)) return n;
  const d = SETTING_DEFAULTS.filter(function (x) { return x[0] === key; })[0];
  return d ? Number(d[1]) : NaN;
}

/** 設定値を書き込む（行がなければ足す） */
function setSetting_(key, value) {
  withLock_(function () {
    const rows = readAll_('SETTINGS');
    const hit = rows.filter(function (r) { return r.key === key; })[0];
    if (hit) updateRow_('SETTINGS', hit._row, { value: String(value) });
    else {
      const d = SETTING_DEFAULTS.filter(function (x) { return x[0] === key; })[0];
      appendRow_('SETTINGS', { key: key, value: String(value), description: d ? d[2] : '' });
    }
    delete EXEC_.settings;
  });
}

// =====================================================
// 【Utils】 日時の整形、"HH:mm" の正規化、数値の丸め、ハッシュ、uuid
// =====================================================

/** 1回の実行の中だけで使い回す値（設定、見出し、行、採番、ロックの深さ）。公開関数の入口で消す */
let EXEC_ = {};
function resetExecutionCache_() { EXEC_ = {}; }

/** スプレッドシートの画面があればダイアログ、なければログに出す（メニュー・テスト用） */
function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(String(msg)); } catch (e) { console.log(String(msg)); }
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** Date かどうか（instanceof は実行環境が違う Date で外れるため、型の名前で判定する） */
function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

/** Date → 'yyyy/MM/dd'（Asia/Tokyo） */
function formatDate_(d) { return d ? Utilities.formatDate(d, TZ, 'yyyy/MM/dd') : ''; }

/** Date → 'yyyy/MM/dd HH:mm'（Asia/Tokyo） */
function formatDateTime_(d) { return d ? Utilities.formatDate(d, TZ, 'yyyy/MM/dd HH:mm') : ''; }

/** Date → 'yyyyMMdd'（記録ID 用） */
function formatYmd_(d) { return Utilities.formatDate(d, TZ, 'yyyyMMdd'); }

/**
 * 日付を Date（その日の0時）にする。Date、'yyyy/MM/dd'、'yyyy-MM-dd'（M・d は1桁でもよい）を受け付ける。
 * 実在しない日付や形が違うものは null
 */
function parseDate_(v) {
  if (isDate_(v)) return isNaN(v.getTime()) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
  const m = String(v === undefined || v === null ? '' : v).trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

/**
 * シートから読んだ日付・日時の値を Date にする。
 * Date はそのまま。文字列は 'yyyy/MM/dd[ HH:mm[:ss]]' か ISO 形式（ローカルプレビューの保存データ）を読む。空や読めないものは null
 */
function toDate_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (isDate_(v)) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * 時刻を "HH:mm" にそろえる（K-01）。不正な値は null。
 *  - 文字列: 全角を半角にし（NFKC）、'H:m'、'H:mm'、'HH:mm' を受け付ける
 *  - 数値: 1日の割合（Excel の時刻の値。0 は "00:00"）
 *  - Date: Asia/Tokyo の時:分
 */
function normalizeTime_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (isDate_(v)) return isNaN(v.getTime()) ? null : Utilities.formatDate(v, TZ, 'HH:mm');
  if (typeof v === 'number') {
    if (!isFinite(v) || v < 0 || v >= 1) return null;
    const total = Math.round(v * 1440);
    if (total >= 1440) return null;
    return pad2_(Math.floor(total / 60)) + ':' + pad2_(total % 60);
  }
  const s = String(v).normalize('NFKC').trim();
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return pad2_(h) + ':' + pad2_(mi);
}

/** 日付（Date）と "HH:mm" から日時を作る */
function combineDateTime_(date, hhmm) {
  const p = String(hhmm).split(':');
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), Number(p[0]), Number(p[1]), 0);
}

/** 小数2桁に丸める */
function round2_(n) { return Math.round(Number(n) * 100) / 100; }

/** 小数2桁の比較用に100倍の整数にする（浮動小数の誤差を避ける） */
function toHundredths_(n) { return Math.round(Number(n) * 100); }

/** 真偽値にする（true / 'TRUE' / 'true' / 1 を真とする） */
function toBool_(v) { return v === true || v === 1 || String(v).toUpperCase() === 'TRUE'; }

/** SHA-256 の16進文字列 */
function sha256Hex_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { const v = (b + 256) % 256; return (v < 16 ? '0' : '') + v.toString(16); }).join('');
}

function uuid_() { return Utilities.getUuid(); }

/** 列番号 → 列の英字（1 → A） */
function columnLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// =====================================================
// 【Repository】 withLock_、readAll_、findRowIndex_、appendRow_、updateRow_
// =====================================================

function getSpreadsheet_() { return SpreadsheetApp.getActiveSpreadsheet(); }

/** シートを返す。なければ SYSTEM エラー（初期設定を促す） */
function getSheet_(key) {
  const sh = getSpreadsheet_().getSheetByName(SHEETS[key]);
  if (!sh) throw AppError('SYSTEM', 'シート「' + SHEETS[key] + '」がありません。メニュー「初期設定（シートの作成）」を実行してください');
  return sh;
}

/**
 * 書き込みを順番に処理する（docs/04 第1部 §11）。入れ子で呼ばれたときはロックを取り直さない。
 * ロックが取れなければ BUSY
 */
function withLock_(fn) {
  if (EXEC_.lockDepth) {
    EXEC_.lockDepth++;
    try { return fn(); } finally { EXEC_.lockDepth--; }
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw AppError('BUSY', '混み合っています。少し待ってからもう一度お試しください');
  EXEC_.lockDepth = 1;
  try {
    return fn();
  } finally {
    EXEC_.lockDepth = 0;
    lock.releaseLock();
  }
}

/** 見出し行を読み、{ cols: {キー: 列番号(1〜)}, width } を返す。COLUMNS の見出しが足りなければ SYSTEM */
function headerInfo_(key) {
  EXEC_.headers = EXEC_.headers || {};
  if (EXEC_.headers[key]) return EXEC_.headers[key];
  const sh = getSheet_(key);
  const width = sh.getLastColumn();
  const header = width ? sh.getRange(1, 1, 1, width).getValues()[0] : [];
  const cols = {};
  const missing = [];
  COLUMNS[key].forEach(function (c) {
    const i = header.indexOf(c[0]);
    if (i < 0) missing.push(c[0]); else cols[c[1]] = i + 1;
  });
  if (missing.length) throw AppError('SYSTEM', 'シート「' + SHEETS[key] + '」に見出しがありません: ' + missing.join('、') + '（メニュー「初期設定（シートの作成）」を実行してください）');
  const info = { cols: cols, width: width };
  EXEC_.headers[key] = info;
  return info;
}

function columnType_(key, name) {
  const c = COLUMNS[key].filter(function (x) { return x[1] === name; })[0];
  return c ? c[2] : 'T';
}

/** セルの値 → 型に合わせた値 */
function fromCell_(type, v) {
  switch (type) {
    case 'HM': { const t = normalizeTime_(v); return t !== null ? t : (v === '' || v === null || v === undefined ? '' : String(v)); }
    case 'N': case 'N2': return v === '' || v === null || v === undefined ? null : Number(v);
    case 'B': return toBool_(v);
    case 'D': case 'DT': return toDate_(v);
    default: return v === null || v === undefined ? '' : String(v);
  }
}

/** 型に合わせた値 → セルに書く値 */
function toCell_(type, v) {
  if (v === null || v === undefined) return '';
  switch (type) {
    case 'HM': case 'T': return String(v);
    case 'N': case 'N2': return v === '' ? '' : Number(v);
    case 'B': return v === true || toBool_(v);
    case 'D': case 'DT': { const d = isDate_(v) ? v : toDate_(v); return d || ''; }
    default: return v;
  }
}

/**
 * シートの全行を、COLUMNS のキーを持つオブジェクトの配列で返す（各要素に行番号 _row を付ける）。
 * すべての列が空の行は読み飛ばす。1回の実行の中では使い回す（書き込むと消える）
 */
function readAll_(key) {
  EXEC_.rows = EXEC_.rows || {};
  if (EXEC_.rows[key]) return EXEC_.rows[key];
  const sh = getSheet_(key);
  const info = headerInfo_(key);
  const last = sh.getLastRow();
  const out = [];
  if (last >= 2) {
    const values = sh.getRange(2, 1, last - 1, info.width).getValues();
    values.forEach(function (row, i) {
      if (row.every(function (v) { return v === '' || v === null; })) return;
      const obj = { _row: i + 2 };
      COLUMNS[key].forEach(function (c) { obj[c[1]] = fromCell_(c[2], row[info.cols[c[1]] - 1]); });
      out.push(obj);
    });
  }
  EXEC_.rows[key] = out;
  return out;
}

/** キー名と値で行を探し、行番号を返す。なければ -1 */
function findRowIndex_(key, keyName, value) {
  const hit = readAll_(key).filter(function (r) { return r[keyName] === value; })[0];
  return hit ? hit._row : -1;
}

/** オブジェクト → 1行分のセルの値（base があれば、その上に obj のキーだけを上書きする） */
function objectToRow_(key, obj, base) {
  const info = headerInfo_(key);
  const row = base ? base.slice() : new Array(info.width).fill('');
  COLUMNS[key].forEach(function (c) {
    if (Object.prototype.hasOwnProperty.call(obj, c[1])) row[info.cols[c[1]] - 1] = toCell_(c[2], obj[c[1]]);
  });
  return row;
}

/** 1行分の書式（COLUMNS にない列は既存のまま 'General'） */
function rowFormats_(key) {
  const info = headerInfo_(key);
  const f = new Array(info.width).fill('General');
  COLUMNS[key].forEach(function (c) { f[info.cols[c[1]] - 1] = NUMBER_FORMATS[c[2]]; });
  return f;
}

/** 複数行を末尾に足す。書式を先に設定してから値を書く（"08:05" が時刻に変わらないようにする） */
function appendRows_(key, objs) {
  if (!objs.length) return;
  withLock_(function () {
    const sh = getSheet_(key);
    const info = headerInfo_(key);
    const start = sh.getLastRow() + 1;
    const need = start + objs.length - 1;
    if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
    const range = sh.getRange(start, 1, objs.length, info.width);
    const fmt = rowFormats_(key);
    range.setNumberFormats(objs.map(function () { return fmt; }));
    range.setValues(objs.map(function (o) { return objectToRow_(key, o, null); }));
    if (EXEC_.rows) delete EXEC_.rows[key];
  });
}

function appendRow_(key, obj) { appendRows_(key, [obj]); }

/** 指定した行の、obj に含まれるキーの列だけを書き換える */
function updateRow_(key, row, obj) {
  withLock_(function () {
    const sh = getSheet_(key);
    const info = headerInfo_(key);
    const range = sh.getRange(row, 1, 1, info.width);
    const base = range.getValues()[0];
    range.setNumberFormats([rowFormats_(key)]);
    range.setValues([objectToRow_(key, obj, base)]);
    if (EXEC_.rows) delete EXEC_.rows[key];
  });
}

/** データ行（2行目以降）をすべて objs に置き換える（マスタの取込・開発用データ用） */
function replaceAllRows_(key, objs) {
  withLock_(function () {
    const sh = getSheet_(key);
    const info = headerInfo_(key);
    const last = sh.getLastRow();
    if (last >= 2) sh.getRange(2, 1, last - 1, info.width).clearContent();
    if (EXEC_.rows) delete EXEC_.rows[key];
    appendRows_(key, objs);
  });
}

// =====================================================
// 【Masters】 パターン・入力者・品種の取得と検索
// =====================================================

function bySortOrder_(a, b) { return (a.sortOrder === null ? 9999 : a.sortOrder) - (b.sortOrder === null ? 9999 : b.sortOrder); }

/** 基準パターン（表示順。無効も含む） */
function getPatterns_() { return readAll_('PATTERNS').slice().sort(bySortOrder_); }

/** 入力者（表示順。無効も含む） */
function getOperators_() { return readAll_('OPERATORS').slice().sort(bySortOrder_); }

/** 品種（表示順。無効も含む） */
function getProducts_() { return readAll_('PRODUCTS').slice().sort(bySortOrder_); }

function findPattern_(no) {
  const n = Number(no);
  return getPatterns_().filter(function (p) { return p.pattern === n; })[0] || null;
}

function findOperator_(operatorId) {
  return getOperators_().filter(function (o) { return o.operatorId === String(operatorId); })[0] || null;
}

function findOperatorByShortName_(shortName) {
  return getOperators_().filter(function (o) { return o.shortName === String(shortName); })[0] || null;
}

function findProduct_(name) {
  return getProducts_().filter(function (p) { return p.name === String(name); })[0] || null;
}

/** 入力者ID → 入力者 の対応表 */
function operatorsById_() {
  const map = {};
  getOperators_().forEach(function (o) { map[o.operatorId] = o; });
  return map;
}

// =====================================================
// 【Auth】 管理者暗証番号の照合、トークンの発行と確認
// =====================================================

/** 管理者暗証番号を設定する（docs/04 第1部 §3.1）。4〜8桁の数字。salt とハッシュだけを保存する */
function setAdminPin_(pin) {
  if (!/^\d{4,8}$/.test(String(pin))) throw AppError('VALIDATION', '暗証番号は4〜8桁の数字にしてください');
  withLock_(function () {
    const salt = uuid_();
    setSetting_('ADMIN_PIN_SALT', salt);
    setSetting_('ADMIN_PIN_HASH', sha256Hex_(salt + ':' + pin));
  });
}

/**
 * 操作者を確かめる（docs/04 第1部 §2.1）。入力者マスタの有効な人でなければ AUTH_REQUIRED（need=operator）。
 * 有効な入力者を返す
 */
function verifyOperator_(ctx) {
  const op = ctx && ctx.operatorId ? findOperator_(ctx.operatorId) : null;
  if (!op || !op.active) throw AppError('AUTH_REQUIRED', 'はじめに、あなたの名前を選んでください', null, { need: 'operator' });
  return op;
}

/**
 * 管理者のトークンが有効か（docs/04 第1部 §3.3）。キャッシュにあり、発行した人と ctx.operatorId が同じで、期限内のとき true
 */
function verifyAdmin_(ctx) {
  if (!ctx || !ctx.token || !ctx.operatorId) return false;
  const raw = CacheService.getScriptCache().get('auth:' + ctx.token);
  if (!raw) return false;
  let t;
  try { t = JSON.parse(raw); } catch (e) { return false; }
  return t.operatorId === String(ctx.operatorId) && Number(t.expiresAt) > new Date().getTime();
}

/** 役割（ROLES.ADMIN か ROLES.SETTER）。操作者が無効なら AUTH_REQUIRED */
function roleOf_(ctx) {
  verifyOperator_(ctx);
  return verifyAdmin_(ctx) ? ROLES.ADMIN : ROLES.SETTER;
}

/** 管理者の権限が要る操作の入口。トークンが無い・切れているときは AUTH_REQUIRED（need=admin） */
function requireAdmin_(ctx) {
  verifyOperator_(ctx);
  if (!verifyAdmin_(ctx)) throw AppError('AUTH_REQUIRED', '管理者の暗証番号を入れてください', null, { need: 'admin' });
}

/** トークンの中身（{ operatorId, expiresAt }）。無効なら null */
function adminTokenInfo_(ctx) {
  if (!verifyAdmin_(ctx)) return null;
  try { return JSON.parse(CacheService.getScriptCache().get('auth:' + ctx.token)); } catch (e) { return null; }
}

/**
 * 管理者の認証（docs/04 第1部 §3.2）。成功したらトークンを発行する（AUTH_TOKEN_MINUTES 分有効。延長しない）。
 * 失敗はアプリ全体で数え、PIN_MAX_FAILS 回続けて間違えたら PIN_LOCK_MINUTES 分ロックする（K-20）。
 * 戻り値 data: { token, expiresAt（ミリ秒） }
 */
function authenticateAdmin(operatorId, pin) {
  return handle_(function () {
    const ctx = { operatorId: String(operatorId || ''), token: null };
    verifyOperator_(ctx);
    const cache = CacheService.getScriptCache();
    const now = new Date().getTime();
    const lockedUntil = Number(cache.get('pinlock') || 0);
    if (lockedUntil > now) {
      const minutes = Math.ceil((lockedUntil - now) / 60000);
      throw AppError('AUTH_LOCKED', '続けて間違えたため、' + minutes + '分間は入れません', null, { minutes: minutes });
    }
    const salt = getSetting_('ADMIN_PIN_SALT'), hash = getSetting_('ADMIN_PIN_HASH');
    if (!salt || !hash) throw AppError('AUTH_FAILED', '管理者暗証番号がまだ設定されていません（スプレッドシートのメニューで設定してください）');
    const lockMinutes = getSettingNumber_('PIN_LOCK_MINUTES');
    if (sha256Hex_(salt + ':' + String(pin === undefined || pin === null ? '' : pin).trim()) !== hash) {
      const fails = Number(cache.get('pinfail') || 0) + 1;
      if (fails >= getSettingNumber_('PIN_MAX_FAILS')) {
        cache.put('pinlock', String(now + lockMinutes * 60000), lockMinutes * 60);
        cache.remove('pinfail');
        writeLog_(ctx, ROLES.SETTER, 'AUTH_LOCK', '', { minutes: lockMinutes });
        throw AppError('AUTH_LOCKED', '続けて間違えたため、' + lockMinutes + '分間は入れません', null, { minutes: lockMinutes });
      }
      cache.put('pinfail', String(fails), lockMinutes * 60);
      writeLog_(ctx, ROLES.SETTER, 'AUTH_FAIL', '', { fails: fails });
      throw AppError('AUTH_FAILED', '暗証番号が違います');
    }
    cache.remove('pinfail');
    const minutes = getSettingNumber_('AUTH_TOKEN_MINUTES');
    const token = uuid_();
    const expiresAt = now + minutes * 60000;
    cache.put('auth:' + token, JSON.stringify({ operatorId: ctx.operatorId, expiresAt: expiresAt }), minutes * 60);
    writeLog_(ctx, ROLES.ADMIN, 'AUTH_OK', '', {});
    return { token: token, expiresAt: expiresAt };
  });
}

/** 管理者のトークンが今も使えるか（画面を開き直したとき）。data: { admin, expiresAt } */
function checkAdmin(ctx) {
  return handle_(function () {
    verifyOperator_(ctx);
    const t = adminTokenInfo_(ctx);
    return { admin: !!t, expiresAt: t ? Number(t.expiresAt) : null };
  });
}

/** 管理者モードを終える（トークンを消す） */
function logoutAdmin(ctx) {
  return handle_(function () {
    if (ctx && ctx.token && adminTokenInfo_(ctx)) CacheService.getScriptCache().remove('auth:' + ctx.token);
    return {};
  });
}

// =====================================================
// 【Validator】 入力チェック
// =====================================================

/** payload から受け取ってよい項目（システムの項目は受け取らない。docs/04 第1部 §4） */
const RECORD_INPUT_KEYS = ['date', 'time', 'pattern', 'fuel', 'pressure', 'setterId', 'product', 'note'];

/** payload から入力項目だけを取り出す（送られてこなかった項目は含めない） */
function pickRecordInput_(payload) {
  const out = {};
  payload = payload || {};
  RECORD_INPUT_KEYS.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(payload, k)) out[k] = payload[k]; });
  return out;
}

/**
 * 入力チェック（docs/04 第1部 §4）。エラーがあれば VALIDATION（fields に項目ごとの文言）。
 * mode: 'create' / 'update'。update では before（もとの記録）の値を引き継ぎ、
 * マスタで無効になった値（パターン・品種・設定者）も、変えていなければ認める。
 * 戻り値: 正規化した値 { date(Date), time('HH:mm'), pattern(数値), fuel, pressure(数値), setterId, product, note, patternObj, operatorObj }
 */
function validateRecord_(input, mode, before) {
  const fields = {};
  const src = {};
  RECORD_INPUT_KEYS.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(input, k)) src[k] = input[k];
    else if (before) src[k] = k === 'date' ? formatDate_(before.date) : before[k];
    else src[k] = '';
  });
  const isKept = function (k) { return !!before && String(src[k]) === String(before[k] === null || before[k] === undefined ? '' : before[k]); };

  const date = parseDate_(src.date);
  if (!date) fields.date = '日付を正しく入れてください';

  const time = normalizeTime_(src.time);
  if (!time) fields.time = '時刻を正しく入れてください';

  const patternNo = Number(src.pattern);
  const patternObj = src.pattern === '' || src.pattern === null ? null : findPattern_(patternNo);
  if (!patternObj || (!patternObj.active && !isKept('pattern'))) fields.pattern = 'パターンを選んでください';

  const fuel = String(src.fuel === null || src.fuel === undefined ? '' : src.fuel);
  if (FUELS.indexOf(fuel) < 0) fields.fuel = 'メインボイラを選んでください';

  const min = getSettingNumber_('PRESSURE_MIN'), max = getSettingNumber_('PRESSURE_MAX');
  const pStr = String(src.pressure === null || src.pressure === undefined ? '' : src.pressure).normalize('NFKC').trim();
  const pressure = Number(pStr);
  if (pStr === '' || !/^\d+(\.\d+)?$/.test(pStr) || !isTwoDecimals_(pressure) || toHundredths_(pressure) < toHundredths_(min) || toHundredths_(pressure) > toHundredths_(max)) {
    fields.pressure = min.toFixed(2) + '〜' + max.toFixed(2) + ' の範囲で、小数2桁までで入れてください';
  }

  const setterId = String(src.setterId === null || src.setterId === undefined ? '' : src.setterId);
  const operatorObj = setterId ? findOperator_(setterId) : null;
  if (mode === 'create' || setterId !== String(before && before.setterId || '')) {
    if (!operatorObj || !operatorObj.active) fields.setterId = '設定者を選んでください';
  }

  const product = String(src.product === null || src.product === undefined ? '' : src.product).trim();
  if (product) {
    const p = findProduct_(product);
    if (!p || (!p.active && !isKept('product'))) fields.product = '品種を選び直してください';
  }

  const note = String(src.note === null || src.note === undefined ? '' : src.note).trim();
  const noteMax = getSettingNumber_('NOTE_MAX_LENGTH');
  if (note.length > noteMax) fields.note = '備考は' + noteMax + '文字までにしてください';

  if (Object.keys(fields).length) throw AppError('VALIDATION', '入力を確かめてください', fields);
  return { date: date, time: time, pattern: patternNo, fuel: fuel, pressure: round2_(pressure), setterId: setterId, product: product, note: note, patternObj: patternObj, operatorObj: operatorObj };
}

// =====================================================
// 【Records】 登録・修正・削除・元に戻す、採番、マスタとの差異
// =====================================================

/** 記録ID を組み立てる（K-05）。連番は3桁ゼロ埋め、1000以上はそのまま */
function formatRecordId_(prefix, ymd, seq) {
  return prefix + '-' + ymd + '-' + (seq < 1000 ? ('00' + seq).slice(-3) : String(seq));
}

/** 同じ接頭辞（'BP-yyyyMMdd-'）を持つ ID の連番の最大値＋1 */
function nextSeqFromIds_(ids, head) {
  let max = 0;
  ids.forEach(function (id) {
    if (String(id).indexOf(head) !== 0) return;
    const n = Number(String(id).substring(head.length));
    if (isFinite(n) && n > max) max = n;
  });
  return max + 1;
}

/**
 * 次の記録ID（docs/04 第1部 §10）。日付は変更日時の日付。削除済みも数える。
 * 1回の実行の中で続けて呼んでも重ならないよう、払い出した最大値を覚えておく（ロックの中で呼ぶこと）
 */
function nextRecordId_(changedAt) {
  const prefix = getSetting_('RECORD_ID_PREFIX') || 'BP';
  const ymd = formatYmd_(changedAt);
  const head = prefix + '-' + ymd + '-';
  EXEC_.idSeq = EXEC_.idSeq || {};
  if (!EXEC_.idSeq[head]) {
    EXEC_.idSeq[head] = nextSeqFromIds_(readAll_('RECORDS').map(function (r) { return r.recordId; }), head) - 1;
  }
  EXEC_.idSeq[head]++;
  return formatRecordId_(prefix, ymd, EXEC_.idSeq[head]);
}

/** マスタとの差異（docs/04 第1部 §5）。パターンが見つからなければ false */
function calcMasterDiff_(pressure, pattern) {
  if (!pattern || pattern.mainPressure === null || pattern.mainPressure === undefined) return false;
  return toHundredths_(pressure) !== toHundredths_(pattern.mainPressure);
}

/**
 * 記録を登録する（docs/04 第1部 §6.1、第2部 §4）。
 * 設定者は自分の名前でだけ登録できる（setterId を省略すると自分）。管理者は誰の名前でも登録できる。
 * 戻り値 data: { recordId, version, masterDiff }
 */
function createRecord(ctx, payload) {
  return handle_(function () {
    return withLock_(function () {
      const role = roleOf_(ctx);
      const input = pickRecordInput_(payload);
      if (!input.setterId) input.setterId = ctx.operatorId;
      if (role !== ROLES.ADMIN && String(input.setterId) !== String(ctx.operatorId)) {
        throw AppError('FORBIDDEN', 'ほかの人の名前では登録できません');
      }
      const v = validateRecord_(input, 'create', null);
      const changedAt = combineDateTime_(v.date, v.time);
      const now = new Date();
      const rec = {
        date: v.date, time: v.time, pattern: v.pattern, fuel: v.fuel, pressure: v.pressure,
        setterName: v.operatorObj.shortName, product: v.product, note: v.note,
        masterDiff: calcMasterDiff_(v.pressure, v.patternObj), recordId: nextRecordId_(changedAt), changedAt: changedAt,
        setterId: v.setterId, source: SOURCES.APP, sourceRow: null,
        createdAt: now, createdBy: String(ctx.operatorId), updatedAt: now, updatedBy: String(ctx.operatorId),
        version: 1, deleted: false, deletedAt: null, deletedBy: ''
      };
      appendRow_('RECORDS', rec);
      writeLog_(ctx, role, 'CREATE', rec.recordId, { pattern: rec.pattern, fuel: rec.fuel, pressure: rec.pressure, masterDiff: rec.masterDiff });
      return { recordId: rec.recordId, version: rec.version, masterDiff: rec.masterDiff };
    });
  });
}

/** 記録を ID で探す（ロックの中で読み直す）。無ければ NOT_FOUND */
function findRecordForWrite_(recordId) {
  if (EXEC_.rows) delete EXEC_.rows.RECORDS;
  const r = readAll_('RECORDS').filter(function (x) { return x.recordId && x.recordId === String(recordId); })[0];
  if (!r) throw AppError('NOT_FOUND', 'この記録は見つかりません（削除された可能性があります）');
  return r;
}

/** 版数を比べる（楽観ロック。docs/04 第1部 §11）。違えば CONFLICT */
function checkVersion_(r, version) {
  if (Number(version) !== Number(r.version)) throw AppError('CONFLICT', 'ほかの人が先に更新しました。画面を読み直してから、もう一度操作してください');
}

/** 権限が足りないとき: トークンを持っていた（期限切れ）なら AUTH_REQUIRED（need=admin）、そうでなければ FORBIDDEN */
function denyEdit_(ctx) {
  if (ctx && ctx.token) throw AppError('AUTH_REQUIRED', '管理者の暗証番号を入れてください', null, { need: 'admin' });
  throw AppError('FORBIDDEN', 'この記録を修正できるのは、アプリで登録した本人と管理者です');
}

/**
 * 記録を修正する（docs/04 第1部 §6.2、第2部 §4）。送った項目だけを反映する。
 * 本人はアプリで登録した自分の記録だけ（期限なし。D-09）。設定者は変えられない。管理者は全件（移行データも。D-11）。
 * 変わった項目が無ければ書き込まない。戻り値 data: { recordId, version, masterDiff, unchanged }
 */
function updateRecord(ctx, recordId, payload, version) {
  return handle_(function () {
    return withLock_(function () {
      const role = roleOf_(ctx);
      const isAdmin = role === ROLES.ADMIN;
      const r = findRecordForWrite_(recordId);
      if (r.deleted) throw AppError('NOT_FOUND', 'この記録は見つかりません（削除された可能性があります）');
      checkVersion_(r, version);
      if (!recordPermissions_(r, ctx, isAdmin).canEdit) denyEdit_(ctx);
      const input = pickRecordInput_(payload);
      if (Object.prototype.hasOwnProperty.call(input, 'setterId') && String(input.setterId || '') === '' && !r.setterId) delete input.setterId;
      if (!isAdmin && Object.prototype.hasOwnProperty.call(input, 'setterId') && String(input.setterId) !== String(r.setterId)) denyEdit_(ctx);
      const v = validateRecord_(input, 'update', r);

      const before = { date: formatDate_(r.date), time: r.time, pattern: r.pattern, fuel: r.fuel, pressure: r.pressure, setterId: r.setterId, product: r.product, note: r.note };
      const after = { date: formatDate_(v.date), time: v.time, pattern: v.pattern, fuel: v.fuel, pressure: v.pressure, setterId: v.setterId, product: v.product, note: v.note };
      const changes = {};
      Object.keys(before).forEach(function (k) { if (String(before[k] === null ? '' : before[k]) !== String(after[k] === null ? '' : after[k])) changes[k] = [before[k], after[k]]; });
      if (!Object.keys(changes).length) return { recordId: r.recordId, version: r.version, masterDiff: r.masterDiff, unchanged: true };

      const now = new Date();
      const upd = {
        date: v.date, time: v.time, changedAt: combineDateTime_(v.date, v.time), pattern: v.pattern, fuel: v.fuel, pressure: v.pressure,
        setterId: v.setterId, setterName: changes.setterId ? (v.operatorObj ? v.operatorObj.shortName : '') : r.setterName,
        product: v.product, note: v.note,
        masterDiff: (changes.pattern || changes.pressure) ? calcMasterDiff_(v.pressure, v.patternObj) : r.masterDiff,
        updatedAt: now, updatedBy: String(ctx.operatorId), version: Number(r.version) + 1
      };
      updateRow_('RECORDS', r._row, upd);
      writeLog_(ctx, role, 'UPDATE', r.recordId, { changes: changes });
      return { recordId: r.recordId, version: upd.version, masterDiff: upd.masterDiff, unchanged: false };
    });
  });
}

/** 削除（論理削除。管理者だけ。docs/04 第1部 §6.3）。戻り値 data: { recordId, version } */
function deleteRecord(ctx, recordId, version) {
  return handle_(function () {
    return withLock_(function () {
      requireAdmin_(ctx);
      const r = findRecordForWrite_(recordId);
      if (r.deleted) throw AppError('NOT_FOUND', 'この記録はすでに削除されています');
      checkVersion_(r, version);
      const now = new Date();
      const upd = { deleted: true, deletedAt: now, deletedBy: String(ctx.operatorId), updatedAt: now, updatedBy: String(ctx.operatorId), version: Number(r.version) + 1 };
      updateRow_('RECORDS', r._row, upd);
      writeLog_(ctx, ROLES.ADMIN, 'DELETE', r.recordId, {});
      return { recordId: r.recordId, version: upd.version };
    });
  });
}

/** 削除の取り消し（管理者だけ。docs/04 第1部 §6.3）。戻り値 data: { recordId, version } */
function restoreRecord(ctx, recordId, version) {
  return handle_(function () {
    return withLock_(function () {
      requireAdmin_(ctx);
      const r = findRecordForWrite_(recordId);
      checkVersion_(r, version);
      if (!r.deleted) throw AppError('CONFLICT', 'この記録は削除されていません。画面を読み直してください');
      const now = new Date();
      const upd = { deleted: false, deletedAt: null, deletedBy: '', updatedAt: now, updatedBy: String(ctx.operatorId), version: Number(r.version) + 1 };
      updateRow_('RECORDS', r._row, upd);
      writeLog_(ctx, ROLES.ADMIN, 'RESTORE', r.recordId, {});
      return { recordId: r.recordId, version: upd.version };
    });
  });
}

// =====================================================
// 【Query】 今の設定、直近の記録、履歴の検索
// =====================================================

/** 画面に返してよい設定（数値のキーは数値にする） */
function publicSettings_() {
  const out = {};
  PUBLIC_SETTING_KEYS.forEach(function (k) {
    out[k] = ['APP_TITLE', 'ENV'].indexOf(k) >= 0 ? getSetting_(k) : getSettingNumber_(k);
  });
  return out;
}

/** 並べ替えに使う変更日時のミリ秒（無ければ日付と時刻から作る） */
function changedAtMs_(r) {
  if (r.changedAt) return r.changedAt.getTime();
  if (r.date && r.time) return combineDateTime_(r.date, r.time).getTime();
  return r.date ? r.date.getTime() : 0;
}

/** 新しい順（変更日時、同じなら登録日時、さらに同じなら行の下の方）に並べる（docs/04 第1部 §7） */
function sortRecords_(rows) {
  return rows.slice().sort(function (a, b) {
    return changedAtMs_(b) - changedAtMs_(a) ||
      (b.createdAt ? b.createdAt.getTime() : 0) - (a.createdAt ? a.createdAt.getTime() : 0) ||
      b._row - a._row;
  });
}

/** 削除されていない記録を新しい順に */
function activeRecordsSorted_() {
  return sortRecords_(readAll_('RECORDS').filter(function (r) { return !r.deleted && r.recordId; }));
}

/** 操作者ID → 表示名（記入称。SYSTEM は「システム」） */
function operatorName_(id, opsById) {
  if (!id) return '';
  if (id === SYSTEM_ID) return 'システム';
  const o = opsById[id];
  return o ? o.shortName : id;
}

/** シートの行 → 画面に返す記録の形（docs/04 第2部 §1.4） */
function toClientRecord_(r, opsById) {
  return {
    recordId: r.recordId, date: formatDate_(r.date), time: r.time, changedAt: formatDateTime_(r.changedAt || (r.date && r.time ? combineDateTime_(r.date, r.time) : null)),
    pattern: r.pattern, fuel: r.fuel, pressure: r.pressure, setterId: r.setterId, setterName: r.setterName,
    product: r.product, note: r.note, masterDiff: r.masterDiff, source: r.source, sourceRow: r.sourceRow,
    createdAt: formatDateTime_(r.createdAt), createdByName: operatorName_(r.createdBy, opsById),
    updatedAt: formatDateTime_(r.updatedAt), updatedByName: operatorName_(r.updatedBy, opsById),
    version: r.version, deleted: r.deleted
  };
}

/** 履歴の1ページの件数（設定 HISTORY_PAGE_SIZE。5〜100 の整数でなければ 20。K-11） */
function historyPageSize_() {
  const n = getSettingNumber_('HISTORY_PAGE_SIZE');
  return (n === Math.floor(n) && n >= 5 && n <= 100) ? n : 20;
}

/** 生産品種の絞り込みで「品種が空の記録」を表す値（docs/04 第1部 §8） */
const PRODUCT_UNSET = '（未設定）';

/**
 * 履歴の検索（docs/04 第1部 §8、第2部 §3）。
 * filter: { dateFrom, dateTo（yyyy-MM-dd か yyyy/MM/dd）, pattern, fuel, setterId, product, includeDeleted }（すべて任意。AND）
 * 削除済みは管理者が includeDeleted=true にしたときだけ含める。新しい順に page ページ目（1から。HISTORY_PAGE_SIZE 件ずつ）。
 * page がページ数を超えたら最後のページを返す（修正・削除で件数が減ったとき）。
 * 戻り値 data: { items: [記録], total, page, pageCount, pageSize, offset, hasMore }
 */
function listRecords(ctx, filter, page) {
  return handle_(function () {
    const role = roleOf_(ctx);
    const f = filter || {};
    const fields = {};
    const from = f.dateFrom ? parseDate_(f.dateFrom) : null;
    const to = f.dateTo ? parseDate_(f.dateTo) : null;
    if (f.dateFrom && !from) fields.dateFrom = '日付を正しく入れてください';
    if (f.dateTo && !to) fields.dateTo = '日付を正しく入れてください';
    if (Object.keys(fields).length) throw AppError('VALIDATION', '絞り込みの条件を確かめてください', fields);
    const includeDeleted = role === ROLES.ADMIN && toBool_(f.includeDeleted);
    const pattern = f.pattern === undefined || f.pattern === null || f.pattern === '' ? null : Number(f.pattern);
    const rows = sortRecords_(readAll_('RECORDS').filter(function (r) {
      if (!r.recordId) return false;
      if (r.deleted && !includeDeleted) return false;
      if (from && (!r.date || r.date.getTime() < from.getTime())) return false;
      if (to && (!r.date || r.date.getTime() > to.getTime())) return false;
      if (pattern !== null && r.pattern !== pattern) return false;
      if (f.fuel && r.fuel !== String(f.fuel)) return false;
      if (f.setterId && r.setterId !== String(f.setterId)) return false;
      if (f.product === PRODUCT_UNSET) { if (r.product) return false; }
      else if (f.product && r.product !== String(f.product)) return false;
      return true;
    }));
    const size = historyPageSize_();
    const pageCount = Math.max(1, Math.ceil(rows.length / size));
    const p = Math.min(pageCount, Math.max(1, Math.floor(Number(page) || 1)));
    const start = (p - 1) * size;
    const opsById = operatorsById_();
    return {
      items: rows.slice(start, start + size).map(function (r) { return toClientRecord_(r, opsById); }),
      total: rows.length, page: p, pageCount: pageCount, pageSize: size, offset: start, hasMore: p < pageCount
    };
  });
}

/**
 * 記録の権限（docs/04 第1部 §2.2）。本人 = 設定者ID が自分・データ区分「アプリ」・削除されていない（K-04、D-11）
 */
function recordPermissions_(r, ctx, isAdmin) {
  const isOwner = r.setterId === String(ctx.operatorId) && r.source === SOURCES.APP && !r.deleted;
  return {
    canEdit: !r.deleted && (isAdmin || isOwner),
    canDelete: isAdmin && !r.deleted,
    canRestore: isAdmin && r.deleted,
    canChangeSetter: isAdmin && !r.deleted
  };
}

/** 記録の詳細と、できる操作（docs/04 第2部 §3）。無い記録・削除済み（管理者以外）は NOT_FOUND */
function getRecord(ctx, recordId) {
  return handle_(function () {
    const isAdmin = roleOf_(ctx) === ROLES.ADMIN;
    const r = readAll_('RECORDS').filter(function (x) { return x.recordId && x.recordId === String(recordId); })[0];
    if (!r || (r.deleted && !isAdmin)) throw AppError('NOT_FOUND', 'この記録は見つかりません（削除された可能性があります）');
    const p = recordPermissions_(r, ctx, isAdmin);
    return { record: toClientRecord_(r, operatorsById_()), canEdit: p.canEdit, canDelete: p.canDelete, canRestore: p.canRestore, canChangeSetter: p.canChangeSetter };
  });
}

// =====================================================
// 【Log】 操作ログ
// =====================================================

/** action キー → 操作名（docs/04 第1部 §12） */
const LOG_ACTIONS = {
  CREATE: '登録', UPDATE: '修正', DELETE: '削除', RESTORE: '削除の取り消し',
  AUTH_OK: '管理者認証', AUTH_FAIL: '管理者認証の失敗', AUTH_LOCK: '管理者認証のロック',
  ADMIN_PIN_SET: '管理者暗証番号の設定', MIGRATE: '移行データ取込', BACKUP: 'バックアップ', SETUP: '初期設定'
};

/**
 * 操作ログを1行足す。ctx が無いとき（メニュー・トリガー）は SYSTEM / システム。
 * 書き込みに失敗しても、本体の処理は失敗させない
 */
function writeLog_(ctx, role, action, recordId, detail) {
  try {
    const operatorId = ctx && ctx.operatorId ? String(ctx.operatorId) : SYSTEM_ID;
    let operatorName = 'システム';
    if (operatorId !== SYSTEM_ID) {
      const op = findOperator_(operatorId);
      operatorName = op ? op.shortName : operatorId;
    }
    appendRow_('LOGS', {
      logId: uuid_(), loggedAt: new Date(), operatorId: operatorId, operatorName: operatorName,
      role: operatorId === SYSTEM_ID ? ROLES.SYSTEM : (role || ROLES.SETTER),
      recordId: recordId || '', action: LOG_ACTIONS[action] || action, detail: JSON.stringify(detail || {})
    });
  } catch (e) {
    console.error('操作ログを書けませんでした: ' + (e && e.message ? e.message : e));
  }
}

/** 操作ログを新しい順に返す（offset から limit 件）。{ items, total, hasMore } */
function readLogs_(offset, limit) {
  const all = readAll_('LOGS').slice().sort(function (a, b) {
    return (b.loggedAt ? b.loggedAt.getTime() : 0) - (a.loggedAt ? a.loggedAt.getTime() : 0) || b._row - a._row;
  });
  offset = Math.max(0, Number(offset) || 0);
  limit = Math.max(1, Number(limit) || getSettingNumber_('PAGE_SIZE'));
  return { items: all.slice(offset, offset + limit), total: all.length, hasMore: offset + limit < all.length };
}

/** 操作ログの一覧（管理者だけ。docs/04 第2部 §5）。新しい順に PAGE_SIZE 件。data: { items, total, hasMore } */
function listOperationLogs(ctx, offset) {
  return handle_(function () {
    requireAdmin_(ctx);
    const res = readLogs_(offset, getSettingNumber_('PAGE_SIZE'));
    return {
      items: res.items.map(function (l) {
        return { loggedAt: formatDateTime_(l.loggedAt), operatorName: l.operatorName, role: l.role, action: l.action, recordId: l.recordId };
      }),
      total: res.total, hasMore: res.hasMore
    };
  });
}

// =====================================================
// 【Migration】 移行 CSV の取込と照合
// =====================================================

/** 移行 CSV のファイル名と列（docs/03 §4） */
const MIGRATION_FILES = {
  records: { name: 'records.csv', cols: ['sourceRow', 'date', 'time', 'pattern', 'fuel', 'pressure', 'setterName', 'product', 'note'] },
  patterns: { name: 'patterns.csv', cols: ['pattern', 'mainPressure', 'subPressure', 'products', 'note', 'sortOrder', 'active'] },
  operators: { name: 'operators.csv', cols: ['operatorId', 'shortName', 'fullName', 'sortOrder', 'active', 'note'] },
  products: { name: 'products.csv', cols: ['name', 'sortOrder', 'active'] }
};

/** CSV の文字列 → オブジェクトの配列（各要素に CSV の行番号 _line）。見出しが足りなければ errors に足す */
function csvToObjects_(text, kind, errors) {
  const def = MIGRATION_FILES[kind];
  const rows = Utilities.parseCsv(String(text || '').replace(/^﻿/, ''))
    .filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); });
  if (!rows.length) { errors.push(def.name + ': 中身がありません'); return []; }
  const header = rows[0].map(function (h) { return String(h).trim(); });
  const missing = def.cols.filter(function (c) { return header.indexOf(c) < 0; });
  if (missing.length) { errors.push(def.name + ': 見出しがありません: ' + missing.join('、')); return []; }
  return rows.slice(1).map(function (r, i) {
    const o = { _line: i + 2 };
    def.cols.forEach(function (c) { const v = r[header.indexOf(c)]; o[c] = v === undefined ? '' : String(v).trim(); });
    return o;
  });
}

/** 移行用フォルダから4つの CSV を読む。{ texts, errors } */
function readMigrationFiles_() {
  const errors = [];
  const texts = {};
  const folderId = getSetting_('MIGRATION_FOLDER_ID');
  if (!folderId) return { texts: texts, errors: ['設定シートの MIGRATION_FOLDER_ID が空です'] };
  let folder;
  try { folder = DriveApp.getFolderById(folderId); } catch (e) { return { texts: texts, errors: ['移行用フォルダを開けません（MIGRATION_FOLDER_ID を確かめてください）'] }; }
  Object.keys(MIGRATION_FILES).forEach(function (kind) {
    const name = MIGRATION_FILES[kind].name;
    const it = folder.getFilesByName(name);
    const files = [];
    while (it.hasNext()) { const f = it.next(); if (!f.isTrashed()) files.push(f); }
    if (!files.length) errors.push(name + ' が移行用フォルダにありません');
    else if (files.length > 1) errors.push(name + ' が移行用フォルダに ' + files.length + ' 個あります（1つにしてください）');
    else texts[kind] = files[0].getBlob().getDataAsString('UTF-8');
  });
  return { texts: texts, errors: errors };
}

/** 小数2桁までの数値か */
function isTwoDecimals_(n) { return isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6; }

/**
 * 移行 CSV の文字列から、書き込む行を作る（docs/04 第1部 §13.4 の 2〜6）。シートには書かない。
 * { errors, operators, patterns, products, records, check }。records は変更日時の古い順で、記録ID を振ってある
 */
function buildMigration_(texts) {
  const errors = [];
  const csv = {};
  Object.keys(MIGRATION_FILES).forEach(function (kind) {
    if (texts[kind] === undefined) errors.push(MIGRATION_FILES[kind].name + ' がありません');
    else csv[kind] = csvToObjects_(texts[kind], kind, errors);
  });
  if (errors.length) return { errors: errors };

  // ---- マスタ ----
  const operators = [], opByShort = {}, opIds = {};
  csv.operators.forEach(function (o) {
    const where = 'operators.csv ' + o._line + '行目';
    if (!/^U\d{2,}$/.test(o.operatorId)) errors.push(where + ': 入力者ID の形が違います（' + o.operatorId + '）');
    if (opIds[o.operatorId]) errors.push(where + ': 入力者ID が重複しています（' + o.operatorId + '）');
    if (!o.shortName) errors.push(where + ': 記入称が空です');
    else if (opByShort[o.shortName]) errors.push(where + ': 記入称が重複しています（' + o.shortName + '）');
    const op = { operatorId: o.operatorId, shortName: o.shortName, fullName: o.fullName, sortOrder: Number(o.sortOrder) || operators.length + 1, active: toBool_(o.active), note: o.note };
    operators.push(op); opIds[o.operatorId] = true; if (o.shortName) opByShort[o.shortName] = op;
  });
  const patterns = [], patternMap = {};
  csv.patterns.forEach(function (p) {
    const where = 'patterns.csv ' + p._line + '行目';
    const no = Number(p.pattern), main = Number(p.mainPressure), sub = Number(p.subPressure);
    if (!/^\d+$/.test(p.pattern)) errors.push(where + ': パターンが整数ではありません（' + p.pattern + '）');
    else if (patternMap[no]) errors.push(where + ': パターンが重複しています（' + no + '）');
    if (!isTwoDecimals_(main) || p.mainPressure === '') errors.push(where + ': メイン圧力が数値ではありません');
    if (!isTwoDecimals_(sub) || p.subPressure === '') errors.push(where + ': サブ圧力が数値ではありません');
    const pat = { pattern: no, mainPressure: round2_(main), subPressure: round2_(sub), products: p.products, note: p.note, revisedAt: null, sortOrder: Number(p.sortOrder) || no, active: toBool_(p.active) };
    patterns.push(pat); patternMap[no] = pat;
  });
  const products = [], productNames = {};
  csv.products.forEach(function (p) {
    const where = 'products.csv ' + p._line + '行目';
    if (!p.name) errors.push(where + ': 品種名が空です');
    else if (productNames[p.name]) errors.push(where + ': 品種名が重複しています（' + p.name + '）');
    products.push({ name: p.name, sortOrder: Number(p.sortOrder) || products.length + 1, active: toBool_(p.active) });
    productNames[p.name] = true;
  });

  // ---- 記録（範囲・マスタの有効フラグ・設定者の有効フラグは確かめない） ----
  const noteMax = getSettingNumber_('NOTE_MAX_LENGTH');
  const rows = [];
  csv.records.forEach(function (r) {
    const where = 'records.csv ' + r._line + '行目（移行元行 ' + r.sourceRow + '）';
    const date = parseDate_(r.date);
    const time = normalizeTime_(r.time);
    const pattern = Number(r.pattern);
    const pressure = Number(r.pressure);
    if (!/^\d+$/.test(r.sourceRow)) errors.push(where + ': 移行元行が整数ではありません');
    if (!date) errors.push(where + ': 日付が正しくありません（' + r.date + '）');
    if (!time) errors.push(where + ': 時刻が正しくありません（' + r.time + '）');
    if (!patternMap[pattern]) errors.push(where + ': パターン ' + r.pattern + ' が patterns.csv にありません');
    if (FUELS.indexOf(r.fuel) < 0) errors.push(where + ': メインボイラが「ガス」「重油」ではありません（' + r.fuel + '）');
    if (r.pressure === '' || !isTwoDecimals_(pressure)) errors.push(where + ': 設定圧力が小数2桁までの数値ではありません（' + r.pressure + '）');
    if (r.setterName && !opByShort[r.setterName]) errors.push(where + ': 設定者「' + r.setterName + '」が operators.csv にありません');
    if (r.product && !productNames[r.product]) errors.push(where + ': 品種「' + r.product + '」が products.csv にありません');
    if (r.note.length > noteMax) errors.push(where + ': 備考が ' + noteMax + ' 文字を超えています');
    if (date && time) rows.push({ src: r, date: date, time: time, pattern: pattern, pressure: round2_(pressure), changedAt: combineDateTime_(date, time) });
  });
  if (errors.length) return { errors: errors };

  rows.sort(function (a, b) { return a.changedAt.getTime() - b.changedAt.getTime() || Number(a.src.sourceRow) - Number(b.src.sourceRow); });
  const now = new Date();
  const records = rows.map(function (x) {
    const op = x.src.setterName ? opByShort[x.src.setterName] : null;
    return {
      date: x.date, time: x.time, pattern: x.pattern, fuel: x.src.fuel, pressure: x.pressure,
      setterName: x.src.setterName, product: x.src.product, note: x.src.note,
      masterDiff: calcMasterDiff_(x.pressure, patternMap[x.pattern]), recordId: nextRecordId_(x.changedAt), changedAt: x.changedAt,
      setterId: op ? op.operatorId : '', source: SOURCES.MIGRATION, sourceRow: Number(x.src.sourceRow),
      createdAt: now, createdBy: SYSTEM_ID, updatedAt: now, updatedBy: SYSTEM_ID, version: 1, deleted: false, deletedAt: null, deletedBy: ''
    };
  });
  return { errors: [], operators: operators, patterns: patterns, products: products, records: records, check: migrationCheck_(records) };
}

/** 照合用の集計（docs/04 第1部 §13.5） */
function migrationCheck_(records) {
  const byPattern = {}, byFuel = {};
  records.forEach(function (r) {
    byPattern[r.pattern] = (byPattern[r.pattern] || 0) + 1;
    byFuel[r.fuel] = (byFuel[r.fuel] || 0) + 1;
  });
  const srcRows = function (list) { return list.map(function (r) { return r.sourceRow; }).sort(function (a, b) { return a - b; }); };
  return {
    count: records.length,
    byPattern: byPattern,
    byFuel: byFuel,
    diffRows: srcRows(records.filter(function (r) { return r.masterDiff; })),
    blankSetterRows: srcRows(records.filter(function (r) { return !r.setterName; })),
    from: records.length ? formatDate_(records[0].date) : '',
    to: records.length ? formatDate_(records.reduce(function (m, r) { return r.date > m ? r.date : m; }, records[0].date)) : ''
  };
}

/** 照合用の集計を、ダイアログ用の文字列にする */
function formatMigrationCheck_(c) {
  return [
    '件数: ' + c.count + '件',
    'パターン別: ' + Object.keys(c.byPattern).sort(function (a, b) { return a - b; }).map(function (k) { return 'パターン' + k + ' ' + c.byPattern[k] + '件'; }).join(' / '),
    '燃料別: ' + FUELS.map(function (f) { return f + ' ' + (c.byFuel[f] || 0) + '件'; }).join(' / '),
    'マスタとの差異: ' + c.diffRows.length + '件（移行元行 ' + c.diffRows.join('、') + '）',
    '期間: ' + c.from + '〜' + c.to,
    '設定者が空: ' + c.blankSetterRows.length + '件（移行元行 ' + c.blankSetterRows.join('、') + '）'
  ].join('\n');
}

/**
 * 移行データを取り込む（docs/04 第1部 §13.4）。
 * options.texts: CSV の文字列 {records, patterns, operators, products}（省略時は移行用フォルダから読む）
 * options.dryRun: true なら確かめるだけで書き込まない（すでに移行データがあっても確かめられる）
 * 戻り値: { ok, errors, check, counts }。エラーが1件でもあれば何も書き込まない
 */
function importMigration_(options) {
  options = options || {};
  return withLock_(function () {
    if (!options.dryRun) {
      const existing = readAll_('RECORDS').filter(function (r) { return r.source === SOURCES.MIGRATION; }).length;
      if (existing) return { ok: false, errors: ['すでに移行データが ' + existing + ' 件あります。取込は移行データが1件もないときだけ実行できます（やり直すときはスプレッドシートを作り直してください）'] };
    }
    let texts = options.texts;
    if (!texts) {
      const f = readMigrationFiles_();
      if (f.errors.length) return { ok: false, errors: f.errors };
      texts = f.texts;
    }
    const b = buildMigration_(texts);
    if (b.errors.length) return { ok: false, errors: b.errors };
    const counts = { records: b.records.length, operators: b.operators.length, patterns: b.patterns.length, products: b.products.length };
    if (options.dryRun) return { ok: true, dryRun: true, errors: [], check: b.check, counts: counts, records: b.records };
    replaceAllRows_('OPERATORS', b.operators);
    replaceAllRows_('PATTERNS', b.patterns);
    replaceAllRows_('PRODUCTS', b.products);
    appendRows_('RECORDS', b.records);
    writeLog_(null, ROLES.SYSTEM, 'MIGRATE', '', counts);
    return { ok: true, errors: [], check: b.check, counts: counts };
  });
}

/** メニュー「移行データ取込」 */
function menuImportMigration() {
  resetExecutionCache_();
  let r;
  try { r = importMigration_({}); } catch (e) { r = { ok: false, errors: [e && e.message ? e.message : String(e)] }; }
  if (!r.ok) {
    alert_('移行データを取り込めませんでした（何も書き込んでいません）。\n\n' + r.errors.slice(0, 30).join('\n') + (r.errors.length > 30 ? '\n…ほか ' + (r.errors.length - 30) + '件' : ''));
  } else {
    alert_('移行データを取り込みました。Excel の値（変換レポート report.md）と照合してください。\n\n' + formatMigrationCheck_(r.check) +
      '\n\n入力者 ' + r.counts.operators + '名 / パターン ' + r.counts.patterns + '件 / 品種 ' + r.counts.products + '件');
  }
  return r;
}

// =====================================================
// 【Backup】 バックアップ
// =====================================================

/** バックアップのファイル名の頭（docs/04 第1部 §14） */
const BACKUP_PREFIX = 'ボイラ圧力設定DB_backup_';

/**
 * スプレッドシートを丸ごと複製して BACKUP_FOLDER_ID のフォルダに保存し、BACKUP_KEEP_MONTHS か月より前に作ったものをゴミ箱へ移す。
 * BACKUP_FOLDER_ID が空・開けないときは何もせず、理由を返す（ログにも出す）。
 * 戻り値: { ok, fileName, removed, message }
 */
function backupNow_() {
  const folderId = getSetting_('BACKUP_FOLDER_ID');
  if (!folderId) {
    console.log('バックアップ: 設定シートの BACKUP_FOLDER_ID が空のため、何もしませんでした');
    return { ok: false, message: '設定シートの BACKUP_FOLDER_ID が空のため、バックアップしていません' };
  }
  let folder;
  try { folder = DriveApp.getFolderById(folderId); } catch (e) {
    console.error('バックアップ: フォルダを開けません: ' + (e && e.message ? e.message : e));
    return { ok: false, message: 'バックアップ用フォルダを開けません（BACKUP_FOLDER_ID を確かめてください）' };
  }
  const now = new Date();
  const fileName = BACKUP_PREFIX + Utilities.formatDate(now, TZ, 'yyyyMMdd');
  DriveApp.getFileById(getSpreadsheet_().getId()).makeCopy(fileName, folder);

  const keep = getSettingNumber_('BACKUP_KEEP_MONTHS');
  const cutoff = new Date(now.getFullYear(), now.getMonth() - keep, now.getDate()).getTime();
  let removed = 0;
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed() || String(f.getName()).indexOf(BACKUP_PREFIX) !== 0) continue;
    if (f.getDateCreated().getTime() < cutoff) { f.setTrashed(true); removed++; }
  }
  writeLog_(null, ROLES.SYSTEM, 'BACKUP', '', { fileName: fileName, removed: removed });
  return { ok: true, fileName: fileName, removed: removed, message: 'バックアップを作りました: ' + fileName + (removed ? '（古いバックアップ ' + removed + ' 件をゴミ箱へ移しました）' : '') };
}

/** トリガーから呼ぶ（毎月1日3時台） */
function runMonthlyBackup() {
  resetExecutionCache_();
  return backupNow_();
}

/** メニュー「今すぐバックアップ」 */
function menuBackupNow() {
  resetExecutionCache_();
  let r;
  try { r = backupNow_(); } catch (e) { r = { ok: false, message: 'バックアップに失敗しました: ' + (e && e.message ? e.message : e) }; }
  alert_(r.message);
  return r;
}

/** メニュー「バックアップのトリガーを設定」。runMonthlyBackup のトリガーを1つだけ作り直す（毎月1日3時台） */
function menuSetupBackupTrigger() {
  resetExecutionCache_();
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runMonthlyBackup') { ScriptApp.deleteTrigger(t); removed++; }
  });
  ScriptApp.newTrigger('runMonthlyBackup').timeBased().onMonthDay(1).atHour(3).create();
  const msg = 'バックアップのトリガーを設定しました（毎月1日 3時台）' + (removed ? '。前のトリガー ' + removed + ' 件は消しました' : '') +
    (getSetting_('BACKUP_FOLDER_ID') ? '' : '\n\n※ 設定シートの BACKUP_FOLDER_ID が空です。フォルダの ID を入れてください');
  alert_(msg);
  return msg;
}

// =====================================================
// 【Menu】 カスタムメニュー
// =====================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('ボイラ圧力設定')
    .addItem('初期設定（シートの作成）', 'menuSetup')
    .addItem('管理者暗証番号を設定', 'menuSetAdminPin')
    .addItem('移行データ取込', 'menuImportMigration')
    .addSeparator()
    .addItem('バックアップのトリガーを設定', 'menuSetupBackupTrigger')
    .addItem('今すぐバックアップ', 'menuBackupNow');
  // Tests.gs があるとき（開発環境）だけ出す
  if (typeof runAllTests === 'function') {
    menu.addSeparator()
      .addItem('開発: テストを実行', 'menuRunAllTests')
      .addItem('開発: サンプルデータ投入', 'menuSeedDevData');
  }
  menu.addToUi();
}

/**
 * 初期設定（docs/03 §1〜§3、docs/04 第2部 §6）。何度実行しても重複しない。
 *  - 6つのシートと見出し（足りない見出しは右端に足す）、見出しの書式、列の書式
 *  - 履歴シートの条件付き書式と、システム用の列のグループ
 *  - シートの保護（警告だけ）、設定の初期値（ない行だけ）、品種マスタの初期データ（空のときだけ）
 */
function menuSetup() {
  resetExecutionCache_();
  const summary = withLock_(function () {
    const ss = getSpreadsheet_();
    const created = [];
    const addedHeaders = [];
    Object.keys(SHEETS).forEach(function (key) {
      let sh = ss.getSheetByName(SHEETS[key]);
      if (!sh) { sh = ss.insertSheet(SHEETS[key]); created.push(SHEETS[key]); }
      const width = sh.getLastColumn();
      const header = width ? sh.getRange(1, 1, 1, width).getValues()[0] : [];
      const missing = COLUMNS[key].filter(function (c) { return header.indexOf(c[0]) < 0; }).map(function (c) { return c[0]; });
      if (missing.length) {
        const need = width + missing.length;
        if (need > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
        sh.getRange(1, width + 1, 1, missing.length).setValues([missing]);
        if (width) addedHeaders.push(SHEETS[key] + ': ' + missing.join('、'));
      }
      if (EXEC_.headers) delete EXEC_.headers[key];
      const info = headerInfo_(key);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, info.width).setFontWeight('bold').setBackground('#e0f2fe').setFontColor('#0f172a');
      if (sh.getMaxRows() >= 2) {
        COLUMNS[key].forEach(function (c) {
          if (c[2] === 'B') return;
          sh.getRange(2, info.cols[c[1]], sh.getMaxRows() - 1, 1).setNumberFormat(NUMBER_FORMATS[c[2]]);
        });
      }
      if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
        sh.protect().setDescription('アプリで更新するシートです。直接編集するときは注意してください').setWarningOnly(true);
      }
    });
    setupRecordsSheetView_();
    const settingsAdded = ensureSettings_();
    const productsAdded = ensureInitialProducts_();
    const detail = { created: created, addedHeaders: addedHeaders, settingsAdded: settingsAdded, productsAdded: productsAdded };
    writeLog_(null, ROLES.SYSTEM, 'SETUP', '', detail);
    return '初期設定が終わりました。\n' +
      '作成したシート: ' + (created.length ? created.join('、') : 'なし') + '\n' +
      '追加した見出し: ' + (addedHeaders.length ? addedHeaders.join(' / ') : 'なし') + '\n' +
      '追加した設定: ' + settingsAdded + '件、追加した品種: ' + productsAdded + '件';
  });
  alert_(summary);
  return summary;
}

/** 履歴シートの見た目（K-13）: 条件付き書式、システム用の列のグループ */
function setupRecordsSheetView_() {
  const sh = getSheet_('RECORDS');
  const info = headerInfo_('RECORDS');
  const maxRows = sh.getMaxRows();
  const lastCol = info.width;
  const delCol = columnLetter_(info.cols.deleted);
  const diffCol = info.cols.masterDiff;
  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + delCol + '2=TRUE')
      .setFontColor('#94a3b8').setStrikethrough(true)
      .setRanges([sh.getRange(2, 1, maxRows - 1, lastCol)]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$' + columnLetter_(diffCol) + '2=TRUE')
      .setBackground('#fef3c7')
      .setRanges([sh.getRange(2, diffCol, maxRows - 1, 1)]).build()
  ];
  sh.setConditionalFormatRules(rules);

  // 「マスタとの差異」より右の列を、列のグループにして折りたたむ
  const visibleLast = info.cols[COLUMNS.RECORDS.filter(function (c) { return c[0] === RECORDS_LAST_VISIBLE_HEADER; })[0][1]];
  const first = visibleLast + 1;
  if (first <= lastCol && sh.getColumnGroupDepth(first) === 0) {
    sh.getRange(1, first, 1, lastCol - first + 1).shiftColumnGroupDepth(1);
    const g = sh.getColumnGroup(first, 1);
    if (g) g.collapse();
  }
}

/** 設定シートに、ないキーだけを初期値で足す。足した件数を返す */
function ensureSettings_() {
  const have = {};
  readAll_('SETTINGS').forEach(function (r) { have[r.key] = true; });
  const add = SETTING_DEFAULTS.filter(function (d) { return !have[d[0]]; })
    .map(function (d) { return { key: d[0], value: d[1], description: d[2] }; });
  appendRows_('SETTINGS', add);
  delete EXEC_.settings;
  return add.length;
}

/** 品種マスタが空のときだけ、初期データを入れる。入れた件数を返す */
function ensureInitialProducts_() {
  if (readAll_('PRODUCTS').length) return 0;
  appendRows_('PRODUCTS', PRODUCTS_INITIAL.map(function (name, i) { return { name: name, sortOrder: i + 1, active: true }; }));
  return PRODUCTS_INITIAL.length;
}

/** メニュー「管理者暗証番号を設定」（docs/04 第1部 §3.1）。4〜8桁の数字を2回入れる */
function menuSetAdminPin() {
  resetExecutionCache_();
  const ui = SpreadsheetApp.getUi();
  const r1 = ui.prompt('管理者暗証番号の設定', '新しい暗証番号（4〜8桁の数字）を入れてください', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) { alert_('中止しました'); return '中止'; }
  const pin = String(r1.getResponseText()).trim();
  if (!/^\d{4,8}$/.test(pin)) { alert_('暗証番号は4〜8桁の数字にしてください。設定していません'); return '形式エラー'; }
  const r2 = ui.prompt('管理者暗証番号の設定', '確認のため、もう一度入れてください', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) { alert_('中止しました'); return '中止'; }
  if (String(r2.getResponseText()).trim() !== pin) { alert_('1回目と2回目が違います。設定していません'); return '不一致'; }
  setAdminPin_(pin);
  writeLog_(null, ROLES.SYSTEM, 'ADMIN_PIN_SET', '', {});
  alert_('管理者暗証番号を設定しました');
  return '設定';
}
