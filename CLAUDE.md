# 基本情報

上位フォルダの CLAUDE.md のルールに加えて、このプロジェクトでは次のルールに従う（GEMINI.md も同じ内容）。

## 作業ルール(追加)
- 作業を始める前に `plan/README.md` を読み、`plan/07_タスク一覧.md` で進み具合を確かめる
- **docs/ を正とする**。plan/ と docs/ が食い違ったら、ユーザーに報告する
- 確定事項（plan/01 の D-xx）は勝手に変えない。仮決め（K-xx）を変えたいときは理由を添えて提案し、承認後に plan/09 §3 のとおりに直す
- フェーズは順番に進める。各フェーズの終わりに、完了条件とテスト結果を報告し、確認を得てから次へ進む
- 終わったタスクは plan/07 で `[x]` にする。history には、フェーズ名、タスク、テスト結果の表（テストID と OK/NG）を書く
- 権限の判定と入力チェックは、必ずサーバー側でも行う（画面側のチェックは補助）
- 環境で変わる値（フォルダ ID、圧力の範囲など）は「設定」シートに置き、コードに直接書かない
- 本番環境への反映とデプロイは、ユーザーから明示的な指示があるまで行わない
- ユーザーの手作業（GAS エディタへの貼り付け、権限の承認、デプロイ、メニューの実行）は手順を示して依頼する。AI が代わりにやったとは報告しない
- **完了報告では「GAS エディタへの貼り替えが必要なファイル」を列挙する**（変更がなければ「なし」と書く）
- `reference/移行データ/` には個人名が入っている。計画書、docs、history、テストのコードに個人名を書き写さない

## 規約(追加)
- サーバー側は `gas_app/Code.gs` の1ファイル、画面側は `index.html`、`css.html`、`js.html` の3ファイルにする（開発環境だけ `Tests.gs` を足す）。ファイルは増やさない
- Code.gs は13のセクション（【Api】〜【Menu】）に分け、各セクションの先頭に見出しコメントを置く（docs/02 §2.2）
- 内部用の関数は名前の末尾に `_` を付ける。Tests.gs は Code.gs の関数を呼ぶだけにする
- 画面から呼ぶ関数は第1引数に `ctx = { operatorId, token }` を受け取り、`{ok, data, error}` を返す（docs/04 第2部 §1）
- 画面ではブラウザ標準の alert / confirm / prompt を使わない
- デザインは plan/05 §0 に従う。新しい部品が要るときは、先に参考アプリ（`../02.ロッカーキー貸出管理(Gemini)/gas_app/css.html`）で近いものを探す

## フォルダ構成(追加)
```
02.ボイラ圧力設定管理/
├── CLAUDE.md / GEMINI.md        # このファイル（同じ内容）
├── .gitignore                   # reference、screenshot などを除外
├── prompt/                      # 指示用のプロンプト
├── reference/                   # Git 管理外
│   ├── ボイラ圧力設定変更履歴.xlsx  # 移行元の Excel
│   └── 移行データ/              # 変換結果の CSV と report.md（個人名を含む）
├── plan_draft/                  # 要件定義・構築手順のドラフト
├── plan/                        # 詳しい実装計画（README から読む）
├── docs/                        # 正式な設計書（正）
│   └── images/                  # 操作マニュアルの画像
├── gas_app/                     # GAS の原本（貼り替え用）
│   ├── Code.gs
│   ├── index.html
│   ├── css.html
│   ├── js.html
│   ├── appsscript.json
│   └── Tests.gs                 # 開発環境だけに貼る
├── tools/                       # ローカル検証用（Node.js。GAS には貼らない）
│   ├── gas_fakes.js             # GAS サービスの代用品
│   ├── run_tests_node.js        # Node で Code.gs / Tests.gs を動かす
│   ├── build_local_preview.js   # local_preview.html を作る
│   ├── preview_mock.js          # プレビューで google.script.run を代用する
│   ├── mobile_frame.html        # 幅375pxで local_preview を表示する
│   ├── browserDriver.js         # ヘッドレス Chrome の操作部品
│   ├── screenshot.js            # local_preview を撮影する
│   ├── ui_checks.js             # 画面の確認（TC-UI）と撮影
│   ├── capture_manual.js        # 操作マニュアルの画像を docs/images/ に撮る
│   └── migrate/                 # Excel の変換スクリプト（フェーズ2）
├── local_preview.html           # 生成物（直接編集しない）
├── history/                     # 作業記録（YYYYMMDDhhmm_変更内容.md）
└── screenshot/                  # 画面確認の画像（Git 管理外）
```

## ドキュメント(追加)
| ファイル | 用途 |
|---|---|
| plan_draft/00_実装計画書(要件定義).md | 実装計画段階の要件定義（ドラフト） |
| plan_draft/00_実装計画書(構築手順).md | 実装計画段階の構築手順（ドラフト） |
| plan/README.md | 実装計画の入口。読む順番と作業ルール |
| plan/01_決定事項と仮決め一覧.md | 確定事項（D-xx）、仮決め（K-xx）、確認事項（Q-xx） |
| plan/02〜06 | システム構成、データ設計、業務ロジック、画面仕様、サーバーAPI（docs の元） |
| plan/07_タスク一覧.md | フェーズごとのタスクと完了条件（進み具合を管理する） |
| plan/08_テスト計画.md | テストの方法とテストケース（TC-xx） |
| plan/09_プロンプト修正ガイド.md | 実装を指示するプロンプト、変更したいときに直す場所 |
| plan/10_本番前の修正計画.md | 本番前の修正依頼（PC・タブレット表示、ページ分け、品種の集約など）の計画と実施の記録（フェーズ8） |
| docs/01_要件定義書.md | 目的と範囲、役割、機能要件・非機能要件 |
| docs/02_システム設計.md | 全体構成、ファイル構成、画面構成、処理の流れ、環境 |
| docs/03_データ設計.md | シートと列の定義、設定キー、初期データ、移行 CSV の形式 |
| docs/04_実装仕様.md | 第1部 業務ロジック（権限、入力チェック、採番、ロック、ログ、移行、バックアップ）／第2部 サーバーAPI |
| docs/05_セットアップ手順.md | 開発環境・本番環境の準備、貼り替え、運用、ローカルでの検証 |
| docs/06_操作マニュアル.md | 利用者向けの操作説明（画像は docs/images/。`node tools/capture_manual.js` で撮り直す） |

# 技術的情報

## 技術スタック
- **言語**: Google Apps Script（V8）、HTML、素の CSS と JavaScript（フレームワークなし）
- **スタイリング**: 参考アプリ（ロッカーキー貸出管理）の CSS 変数に合わせる。フォントはシステムフォント、アイコンはインライン SVG
- **外部API**: なし（SpreadsheetApp、CacheService、LockService、DriveApp、Utilities だけ）
- **データ**: スクリプトが紐づいたスプレッドシート（開発 `ボイラ圧力設定DB_開発` / 本番 `ボイラ圧力設定DB`）
- **設定管理**: 「設定」シートのキーと値。clasp は使わず、GAS エディタに貼り替えて反映する

## よく使うコマンド
- `node tools/run_tests_node.js` … フェイクの上でテストを動かす。`--pure` で pure テストだけ、`--verbose` でフェイクのログも出す
- `node tools/build_local_preview.js` … local_preview.html を作り直す（**画面を変えたら必ず実行**）
- `node tools/screenshot.js "tab=home&op=U01" screenshot/xxx.png [幅] [--full]` … local_preview を撮影する（`op=none` で操作者が未選択の状態）
- `node tools/ui_checks.js screenshot` … 画面の確認（TC-UI）を幅375pxでまとめて行い、画像を screenshot/ に撮る（**画面を変えたら実行**。数分かかる）
- `node tools/capture_manual.js` … 操作マニュアルの画像を docs/images/ に撮り直す（画面を変えたら実行）
- `node tools/migrate/convert_excel.js "reference/ボイラ圧力設定変更履歴.xlsx" "reference/移行データ"` … Excel を移行 CSV に変換する（フェーズ2で作る）

## アーキテクチャ方針
- 記録は末尾に足し、物理削除しない（論理削除）。行は記録ID で探す
- 書き込みは `withLock_` で順番に処理し、修正は版数で楽観ロックする
- 時刻は "HH:mm" のテキスト、並べ替えは「変更日時」の列で行う（K-01）
- 記録には圧力の値そのものと、保存した時点の「マスタとの差異」を保存する（あとでマスタを改定しても変えない）

## プロジェクト固有のルール
- デザイン、表示内容が更新される変更を加えた場合、local_preview.html も更新する
- 画面を確認したら、幅375pxで撮った画像を screenshot/ に置き、完了報告の前に `screenshot/YYYYMMDDhhmm_変更内容/` へ移す

# Compact Instructions
- 変更履歴は「機能 → 不具合 → デザイン」の優先順で残す
- 要約するときは、plan/07 の進み具合（どのフェーズのどのタスクまで終わったか）と、ユーザーの確認待ちの事項を必ず残す

# プロジェクト情報
- **概要**: ボイラの圧力設定を変えたときにスマホから記録する GAS のウェブアプリ。Excel の履歴154件を移し、アプリとスプレッドシートで閲覧する
- **重要な制約・決定事項**: plan/01_決定事項と仮決め一覧.md（D-01〜D-29、K-01〜K-29）
- **現在の状態**: フェーズ0〜7（T7-6 を除く）完了。開発環境での確認（T2-7・T3-6・T4-4・T6-5）も済み。フェーズ8（本番前の修正: PC・タブレット表示、履歴のページ分け、表示の手直し、品種の8つへの集約）完了（2026/11/15、T8-6 もユーザーが確認済み）。T7-6（本番デプロイ）完了（2026/11/15。ユーザーが docs/05 §3 の手順で実施。移行データは 2026/11/14 時点の Excel 154件）。本番で運用中。開発環境は修正の確認用に残す。本番で「開発」バッジが消えない不具合は css.html v0.8 で修正し、本番へ反映済み（2026/11/15 ユーザーが確認）
