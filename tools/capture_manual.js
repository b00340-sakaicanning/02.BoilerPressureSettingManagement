#!/usr/bin/env node
/**
 * 操作マニュアル（docs/06_操作マニュアル.md）の画像を撮る（plan/05 §10、K-26）
 *
 *   node tools/capture_manual.js
 *
 * 事前に node tools/build_local_preview.js を実行しておくこと。
 * local_preview.html（架空のデータ）を幅375px（PC の場面は1280px）で開き、docs/images/ に PNG で保存する。実在の人物の名前は写らない。
 * 画面を変えたら撮り直す。場面を足すときは SCENES に足し、docs/06 にも画像を足す。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { launchBrowser } = require('./browserDriver.js');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'images');
let navSeq = 0;
const open = (b, hash) => b.goto('/local_preview.html?n=' + (++navSeq) + '#' + hash);
const clickText = (sel, text) => `(function(){ var el = Array.prototype.filter.call(document.querySelectorAll(${JSON.stringify(sel)}), function(x){ return x.textContent.trim() === ${JSON.stringify(text)}; })[0];
  if (!el) throw new Error('ボタンがありません: ' + ${JSON.stringify(text)}); el.click(); return true; })()`;
const findRecord = (cond) => `(function(){ var g = window.__GAS__.fns; g.resetExecutionCache_(); var r0 = g.readAll_('RECORDS').filter(function(r){ return ${cond}; })[0]; return r0 ? r0.recordId : ''; })()`;
/** プレビューのバナーを隠して、実際の画面と同じ見た目にする */
const HIDE_BANNER = `(function(){ var b = document.querySelector('.preview-banner'); if (b) b.style.display = 'none'; document.body.style.paddingTop = '0'; window.scrollTo(0, 0); })()`;

const SCENES = [
  ['01_operator.png', '設定者を選ぶ', async (b) => { await open(b, 'tab=home&op=none'); }],
  ['02_home.png', 'ホーム', async (b) => { await open(b, 'tab=home&op=U01'); }],
  ['03_input.png', '入力', async (b) => { await open(b, 'tab=input&op=U01'); await b.click('#seg-pattern [data-pattern="2"]'); }],
  ['04_input_warn.png', '基準と違う圧力の注意', async (b) => {
    await open(b, 'tab=input&op=U01'); await b.click('#seg-pattern [data-pattern="2"]'); await b.click('#btn-minus'); await b.click('#btn-minus');
  }],
  ['05_confirm.png', '登録の確認', async (b) => {
    await open(b, 'tab=input&op=U01'); await b.click('#seg-pattern [data-pattern="2"]'); await b.click('#btn-submit');
  }],
  ['06_history.png', '履歴', async (b) => { await open(b, 'tab=history&op=U01'); }],
  ['07_filter.png', '絞り込み', async (b) => { await open(b, 'tab=history&op=U01'); await b.click('#btn-filter-toggle'); }],
  ['08_detail.png', '記録の詳細', async (b) => {
    await open(b, 'tab=history&op=U01');
    const id = await b.evalJs(findRecord(`r.setterId === 'U01' && r.source === 'アプリ' && !r.deleted`));
    await b.evalJs(`openRecord(${JSON.stringify(id)})`);
  }],
  ['09_edit.png', '記録の修正', async (b) => {
    await open(b, 'tab=history&op=U01');
    const id = await b.evalJs(findRecord(`r.setterId === 'U01' && r.source === 'アプリ' && !r.deleted`));
    await b.evalJs(`openRecord(${JSON.stringify(id)})`); await b.settle();
    await b.evalJs(clickText('.modal[data-kind="record"] .btn', '修正する'));
  }],
  ['10_patterns.png', 'パターン表', async (b) => { await open(b, 'tab=patterns&op=U01'); }],
  ['11_pin.png', '管理者認証（パスワード）', async (b) => {
    await open(b, 'tab=home&op=U01'); await b.evalJs(`sessionStorage.removeItem('boilerPressure.adminToken')`); await open(b, 'tab=home&op=U01');
    await b.click('#admin-chip');
  }],
  ['12_admin_detail.png', '管理者の詳細（削除・修正）', async (b) => {
    await open(b, 'tab=history&op=U01&admin=1');
    const id = await b.evalJs(findRecord(`r.setterId === 'U02' && r.source === 'アプリ' && !r.deleted`));
    await b.evalJs(`openRecord(${JSON.stringify(id)})`);
  }],
  ['13_admin_history.png', '管理者の履歴（削除済みも表示・操作ログ）', async (b) => {
    await open(b, 'tab=history&op=U01&admin=1'); await b.click('#btn-include-deleted');
  }],
  ['14_logs.png', '操作ログ', async (b) => { await open(b, 'tab=history&op=U01&admin=1'); await b.click('#btn-logs'); }],
  ['15_pc_history.png', 'PC の履歴（表の形）', async (b) => {
    await open(b, 'tab=home&op=U01');
    await b.evalJs(`['boilerPressure.adminToken', 'boilerPressure.historyFilter', 'boilerPressure.historyPage'].forEach(function(k){ sessionStorage.removeItem(k); })`);
    await open(b, 'tab=history&op=U01');
  }, { width: 1280, height: 800 }]
];
const PHONE = { width: 375, height: 760 };

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'local_preview.html'))) { console.error('local_preview.html がありません。先に node tools/build_local_preview.js を実行してください'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launchBrowser({ siteDir: ROOT, viewport: { width: 375, height: 760 } });
  let ng = 0;
  try {
    for (const [file, name, run, size] of SCENES) {
      const vp = size || PHONE;
      try {
        if (size) await b.setViewport(vp.width, vp.height);
        await run(b);
        await b.settle();
        await b.evalJs(HIDE_BANNER); // 画面の一番上から撮る（スクロールすると固定のヘッダが画像の途中に写るため）
        await b.settle();
        await b.screenshot(path.join(OUT, file), { clip: { x: 0, y: 0, width: vp.width, height: vp.height } });
        console.log(' OK  ' + file + ' ' + name);
      } catch (e) {
        ng++;
        console.log(' NG  ' + file + ' ' + name + ' — ' + (e && e.message ? e.message : e));
      } finally {
        if (size) await b.setViewport(PHONE.width, PHONE.height);
      }
    }
  } finally {
    await b.close();
  }
  console.log('画像: ' + path.relative(ROOT, OUT));
  process.exit(ng ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
