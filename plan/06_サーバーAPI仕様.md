# 06 サーバーAPI仕様

- 版: v1.0（2026/11/14。初版）
- 元資料: 02 §5・§6、04 全体
- 役割: 画面から呼ぶ関数、戻り値、エラーコード、メニューの関数を決める

---

## 1. 共通の規約

### 1.1 ctx
```js
ctx = { operatorId: 'U01', token: 'uuid または null' }
```
- 画面から呼ぶ関数は、第1引数に必ず ctx を受け取る（`authenticateAdmin` を除く）。
- サーバーは毎回、operatorId が入力者マスタの有効な人かを確かめる（04 §2.1）。

### 1.2 戻り値
```js
{ ok: true,  data: { ... } }
{ ok: false, error: { code: 'VALIDATION', message: '入力を確かめてください', fields: { pressure: '0.50〜0.80 の範囲で…' } } }
```
- 公開関数の中身は `handle_(function () { ... })` で包む。
- 想定したエラーは `throw new AppError(code, message, fields)`。想定外の例外は `SYSTEM` にし、`console.error` に詳しい内容を出す。
- 戻り値に Date 型は入れない（文字列にする）。`handle_` の最後で `JSON.parse(JSON.stringify(data))` を通す。

### 1.3 エラーコード

| コード | 意味 |
|---|---|
| VALIDATION | 入力チェックのエラー（fields に項目ごとの文言） |
| AUTH_REQUIRED | 操作者が無効、または管理者の権限が要るのにトークンがない・切れている。`error.detail.need` に `operator` か `admin` を入れる |
| AUTH_FAILED | パスワードが違う・未設定 |
| AUTH_LOCKED | 間違えすぎてロック中（`error.detail.minutes` に残りの分数） |
| FORBIDDEN | 権限がない |
| CONFLICT | 版数が違う（ほかの人が先に更新した） |
| NOT_FOUND | 記録がない（削除済みを含む。ただし管理者が削除済みを開くときは除く） |
| BUSY | ロックが取れない |
| SYSTEM | 想定外のエラー |

### 1.4 記録の形（画面に返すもの）
```js
{
  recordId: 'BP-20261112-001', date: '2026/11/12', time: '10:40', changedAt: '2026/11/12 10:40',
  pattern: 2, fuel: 'ガス', pressure: 0.67, setterId: 'U01', setterName: 'h',
  product: '2L(水)', note: '', masterDiff: false, source: 'アプリ',
  createdAt: '...', createdByName: 'h', updatedAt: '...', updatedByName: 'h',
  version: 1, deleted: false
}
```
- `createdByName` / `updatedByName` は入力者マスタの記入称。`SYSTEM` は「システム」にする。

---

## 2. 認証

| 関数 | 引数 | 戻り値 data | 備考 |
|---|---|---|---|
| `authenticateAdmin(operatorId, password)` | 入力者ID、管理者パスワード | `{token, expiresAt}` | 04 §3.2。operatorId が有効な人でなければ AUTH_REQUIRED |
| `logoutAdmin(ctx)` | | `{}` | トークンをキャッシュから消す |
| `checkAdmin(ctx)` | | `{admin: true/false, expiresAt}` | 画面を開き直したとき、sessionStorage のトークンが使えるかを確かめる |

---

## 3. 初期化・参照

| 関数 | 引数 | 戻り値 data | 権限 |
|---|---|---|---|
| `getInitialData(ctx)` | | 下を参照 | 操作者を選ぶ前でも呼べる（operatorId が空や無効でもエラーにしない） |
| `getHome(ctx)` | | `{current, recent}` | 設定者 |
| `listRecords(ctx, filter, offset)` | filter は 04 §8、offset は 0〜 | `{items:[記録], total, hasMore}` | 設定者（削除済みは管理者のみ） |
| `getRecord(ctx, recordId)` | | `{record, canEdit, canDelete, canRestore, canChangeSetter}` | 設定者（削除済みは管理者のみ。他は NOT_FOUND） |

`getInitialData` の data:
```js
{
  settings: { APP_TITLE, ENV, PRESSURE_MIN, PRESSURE_MAX, NOTE_MAX_LENGTH, PAGE_SIZE, FUTURE_WARN_MINUTES },
  fuels: ['ガス', '重油'],
  patterns:  [{ pattern, mainPressure, subPressure, products, note, revisedAt, sortOrder, active }],
  operators: [{ operatorId, shortName, fullName, sortOrder, active }],   // 無効な人も含む（絞り込みと表示に使う）
  products:  [{ name, sortOrder, active }],
  operatorValid: true,     // ctx.operatorId が有効な人か
  current: 記録 or null,
  recent: [記録]           // operatorValid が false なら空
}
```

---

## 4. 登録・修正

| 関数 | 引数 | 戻り値 data | 権限 |
|---|---|---|---|
| `createRecord(ctx, payload)` | `{date, time, pattern, fuel, pressure, setterId, product, note}` | `{recordId, version, masterDiff}` | 設定者（setterId は ctx.operatorId と同じであること）、管理者（誰でも可） |
| `updateRecord(ctx, recordId, payload, version)` | payload は createRecord と同じ項目（送った項目だけ反映） | `{recordId, version, masterDiff}` | 04 §2.2 |

保存の流れは 04 §6.1・§6.2。

---

## 5. 管理者 API

| 関数 | 引数 | 戻り値 data | 備考 |
|---|---|---|---|
| `deleteRecord(ctx, recordId, version)` | | `{recordId, version}` | 04 §6.3 |
| `restoreRecord(ctx, recordId, version)` | | `{recordId, version}` | 04 §6.3 |
| `listOperationLogs(ctx, offset)` | | `{items:[{loggedAt, operatorName, role, action, recordId}], total, hasMore}` | 新しい順に PAGE_SIZE 件 |

---

## 6. メニュー（スプレッドシートのカスタムメニュー）

`onOpen` で「ボイラ圧力設定」のメニューを作る。実行するのはスプレッドシートの持ち主。

| メニューの項目 | 関数 | 内容 |
|---|---|---|
| 初期設定（シートの作成） | `menuSetup()` | 03 §1.1 のシートと見出し、書式、保護、設定の初期値、品種マスタの初期データを作る。何度実行しても重複しない |
| 移行データ取込 | `menuImportMigration()` | 04 §13.4。結果と照合の値（04 §13.5）をダイアログに出す |
| バックアップのトリガーを設定 | `menuSetupBackupTrigger()` | 04 §14 |
| 今すぐバックアップ | `menuBackupNow()` | 04 §14 |
| 開発: テストを実行 | `menuRunAllTests()` | Tests.gs があるときだけメニューに出す（`typeof runAllTests === 'function'` で判定） |

トリガーから呼ぶ関数: `runMonthlyBackup()`。

---

## 7. ウェブアプリの入口

| 関数 | 内容 |
|---|---|
| `doGet(e)` | `HtmlService.createTemplateFromFile('index').evaluate()` に、タイトル（APP_TITLE）、`addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')` を付けて返す |
| `include(name)` | `HtmlService.createHtmlOutputFromFile(name).getContent()` を返す |

---

## 8. 内部の主な関数（【Repository】【Masters】など）

| 関数 | セクション | 内容 |
|---|---|---|
| `getSettings_()` | Config | 設定シートを読み、キーと値のオブジェクトにする（1回の実行の中では使い回す） |
| `withLock_(fn)` | Repository | 04 §11 |
| `readAll_(sheetKey)` | Repository | 見出し名から `COLUMNS` のキーに直したオブジェクトの配列を返す（各要素に `_row` を付ける） |
| `findRowIndex_(sheetKey, keyName, value)` | Repository | 行番号を返す。なければ -1 |
| `appendRow_(sheetKey, obj)` / `updateRow_(sheetKey, row, obj)` | Repository | 見出しの順に並べて書く |
| `findPattern_(no)` / `findOperator_(id)` / `findOperatorByShortName_(name)` | Masters | |
| `verifyOperator_(ctx)` / `verifyAdmin_(ctx)` / `roleOf_(ctx)` | Auth | 04 §2.1・§3.3 |
| `validateRecord_(payload, mode, before)` | Validator | 04 §4。mode は `create` / `update` / `migrate` |
| `nextRecordId_(changedAt)` | Records | 04 §10 |
| `calcMasterDiff_(pressure, pattern)` | Records | 04 §5 |
| `toClientRecord_(row, operatorsById)` | Query | §1.4 の形に直す |
| `sortRecords_(rows)` | Query | 04 §7 の並び |
| `writeLog_(ctx, role, action, recordId, detail)` | Log | 04 §12 |
| `normalizeTime_(v)` / `formatDate_(d)` / `formatDateTime_(d)` / `round2_(n)` / `sha256Hex_(s)` | Utils | |

---

## 9. 画面側の関数（js.html）

| 関数 | 内容 |
|---|---|
| `api(name, ...args)` | `google.script.run` を Promise に包む。ctx を先頭に自動で足す（`authenticateAdmin` を除く）。ローディングの表示と、二度押しの防止も行う。`AUTH_REQUIRED`（need=admin）なら管理者認証のダイアログを出してやり直し、need=operator なら操作者を選ぶモーダルを出す |
| `state` | 画面の状態（settings、マスタ、今のタブ、操作者、トークン、履歴の条件と読み込んだ件数） |
| `renderHome()` / `renderInput()` / `renderHistory(append)` / `renderPatterns()` | 各タブの表示 |
| `openRecord(recordId)` | 詳細のモーダルを開く |
| `openOperatorPicker(force)` / `openPinDialog()` / `openConfirm(opts)` / `toast(msg)` | 共通の部品 |
| `MESSAGES` | 05 §8 の文言 |

- 画面側のチェック（必須、圧力の範囲、文字数）はサーバーと同じ規則で行う。ただし最終的な判定はサーバーに任せる。
