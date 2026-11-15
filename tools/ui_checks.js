#!/usr/bin/env node
/**
 * 画面の確認（plan/08 TC-UI）を local_preview.html でまとめて行い、確認用の画像を撮る
 *
 *   node tools/ui_checks.js [出力フォルダ=screenshot] [--only TC-UI-06,TC-UI-07]
 *   （--only で、指定した ID の確認だけを行う。1件ごとに90秒で打ち切り、NG にする）
 *
 * 事前に node tools/build_local_preview.js を実行しておくこと。幅375pxのヘッドレス Chrome で確かめる。
 * 画面を足したら、CHECKS に確認を足す。NG があれば終了コード1。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { launchBrowser } = require('./browserDriver.js');

const ROOT = path.resolve(__dirname, '..');
const ARGS = process.argv.slice(2);
const ONLY = (function () { const i = ARGS.indexOf('--only'); return i >= 0 && ARGS[i + 1] ? ARGS[i + 1].split(',') : null; })();
const OUT = path.resolve(ROOT, ARGS.filter((a, i) => a !== '--only' && ARGS[i - 1] !== '--only')[0] || 'screenshot');
const CHECK_TIMEOUT_MS = 90000;
const WIDTH = 375;
let navSeq = 0;

/** sel に当てはまる要素のうち、文字が text と同じものを押す式 */
function clickText(sel, text) {
  return `(function(){ var el = Array.prototype.filter.call(document.querySelectorAll(${JSON.stringify(sel)}), function(x){ return x.textContent.trim() === ${JSON.stringify(text)}; })[0];
    if (!el) throw new Error('ボタンがありません: ' + ${JSON.stringify(text)}); el.click(); return true; })()`;
}

/** プレビューのデータから、条件に合う記録の ID を1つ返す式（cond は r を使う式） */
function findRecordJs(cond) {
  return `(function(){ var g = window.__GAS__.fns; g.resetExecutionCache_(); var r0 = g.readAll_('RECORDS').filter(function(r){ return ${cond}; })[0]; return r0 ? r0.recordId : ''; })()`;
}

/** ハッシュだけが違う URL ではページが読み直されないので、毎回クエリを変える */
async function open(b, hash) { await b.goto('/local_preview.html?n=' + (++navSeq) + '#' + hash); }

/** 幅375pxで横にはみ出していないか、タップできる部品が44px以上か */
const LAYOUT_JS = `(function(){
  var over = document.documentElement.scrollWidth > window.innerWidth + 1;
  var small = [];
  document.querySelectorAll('.app-header button, .app-main button, .tabbar button, .modal button').forEach(function(el){
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.height < 44 || r.width < 44) small.push((el.id || el.className) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  return { over: over, scrollWidth: document.documentElement.scrollWidth, small: small };
})()`;

const CHECKS = [
  {
    id: 'TC-UI-01', name: '初めて開くと操作者を選ぶモーダルが出て、閉じられない',
    run: async (b, t) => {
      await open(b, 'tab=home&op=none');
      const s = await b.evalJs(`(function(){ var m = document.querySelector('.modal[data-kind="operator"]');
        return { modal: !!m, close: !!(m && m.querySelector('[data-close]')), buttons: m ? m.querySelectorAll('.operator-btn').length : 0 }; })()`);
      t.ok(s.modal, 'モーダルが出ていない');
      t.ok(!s.close, '閉じるボタンがある');
      t.ok(s.buttons > 0, '選択肢が無い');
      await b.evalJs(`document.querySelector('.modal[data-kind="operator"]').click()`); // 覆いを押しても閉じない
      t.ok(await b.evalJs(`!!document.querySelector('.modal[data-kind="operator"]')`), '覆いを押すと閉じてしまう');
      await b.screenshot(path.join(OUT, 'ui01_operator_picker.png'));
    }
  },
  {
    id: 'TC-UI-02', name: '操作者を選ぶと閉じ、開き直してもモーダルが出ない',
    run: async (b, t) => {
      await open(b, 'tab=home&op=none');
      await b.click('.modal[data-kind="operator"] .operator-btn');
      await b.settle();
      t.ok(!(await b.evalJs(`!!document.querySelector('.modal')`)), 'モーダルが閉じない');
      const chip = await b.evalJs(`document.getElementById('operator-chip').innerText.trim()`);
      t.ok(/^[A-Z]\(架空 .+?\)$/.test(chip), 'ヘッダの操作者が「記入称(氏名)」でない: ' + chip);
      await open(b, 'tab=home');
      t.ok(!(await b.evalJs(`!!document.querySelector('.modal')`)), '開き直すとモーダルが出る');
    }
  },
  {
    id: 'TC-UI-03', name: '幅375pxで全タブが横にはみ出さず、タップできる部品が44px以上',
    run: async (b, t) => {
      for (const tab of ['home', 'input', 'history', 'patterns']) {
        await open(b, 'tab=' + tab + '&op=U01');
        const s = await b.evalJs(LAYOUT_JS);
        t.ok(!s.over, tab + ' が横にはみ出す（幅 ' + s.scrollWidth + 'px）');
        t.ok(!s.small.length, tab + ' に44px未満の部品: ' + s.small.join(', '));
      }
      await open(b, 'tab=home&op=U01');
      await b.click('#operator-chip');
      const s = await b.evalJs(LAYOUT_JS);
      t.ok(!s.small.length, '操作者を選ぶモーダルに44px未満の部品: ' + s.small.join(', '));
    }
  },
  {
    id: 'TC-UI-04', name: 'ENV=開発 のときヘッダに「開発」バッジが出て、ENV=本番 のときは出ない。名前を選ぶ前は鍵のボタンが出ない',
    run: async (b, t) => {
      const SHOWN = `(function(){ var e = document.getElementById('env-badge'); return !!e && e.offsetWidth > 0; })()`;
      const SET_ENV = (v) => `(function(){ var g = window.__GAS__; g.fns.resetExecutionCache_(); g.fns.setSetting_('ENV', '${v}'); localStorage.setItem('boilerMock_v1', g.fakes.helpers.exportState()); return true; })()`;
      await open(b, 'tab=home&op=U01');
      t.ok(await b.evalJs(SHOWN), 'ENV=開発 で「開発」バッジが見えない');
      try {
        await b.evalJs(SET_ENV('本番'));
        await open(b, 'tab=home&op=U01');
        t.ok(!(await b.evalJs(SHOWN)), 'ENV=本番 で「開発」バッジが見える');
        await b.screenshot(path.join(OUT, 'ui04_env_production.png'));
      } finally {
        await b.evalJs(SET_ENV('開発'));
      }
      await open(b, 'tab=home&op=none');
      t.ok(await b.evalJs(`document.getElementById('admin-chip').offsetWidth === 0`), '名前を選ぶ前に鍵のボタンが見える');
    }
  },
  {
    id: 'TC-UI-H1', name: 'ホームに今の設定と直近の記録が出る（フェーズ3）',
    run: async (b, t) => {
      await open(b, 'tab=home&op=U01');
      const s = await b.evalJs(`({ current: !!document.getElementById('current-card'), pressure: (document.querySelector('.current-pressure')||{}).innerText || '',
        recent: document.querySelectorAll('#panel-home .record-card').length })`);
      t.ok(s.current, '今の設定のカードが無い');
      t.ok(/\d\.\d{2}/.test(s.pressure), '圧力の表示: ' + s.pressure);
      t.ok(s.recent >= 1 && s.recent <= 5, '直近の件数: ' + s.recent);
      await b.screenshot(path.join(OUT, 'ui_home.png'));
      await b.screenshot(path.join(OUT, 'ui_home_full.png'), { fullPage: true });
    }
  },
  {
    id: 'TC-UI-P1', name: 'パターン表に有効なパターンが出て、今の設定のパターンに印が付く（フェーズ3）',
    run: async (b, t) => {
      await open(b, 'tab=patterns&op=U01');
      const s = await b.evalJs(`({ cards: document.querySelectorAll('#panel-patterns .pattern-card').length, current: document.querySelectorAll('#panel-patterns .pattern-card.is-current').length })`);
      t.ok(s.cards >= 1, 'パターンが無い');
      t.ok(s.current === 1, '今の設定の印の数: ' + s.current);
      await b.screenshot(path.join(OUT, 'ui_patterns_full.png'), { fullPage: true });
    }
  },
  {
    id: 'TC-IN-02', name: '入力: パターン2を押すと圧力の欄に基準（0.67）が入り、手で変えても選び直せば戻る',
    run: async (b, t) => {
      await open(b, 'tab=input&op=U01');
      await b.screenshot(path.join(OUT, 'in_input.png'));
      await b.screenshot(path.join(OUT, 'in_input_full.png'), { fullPage: true });
      await b.click('#seg-pattern [data-pattern="2"]');
      t.ok((await b.evalJs(`document.getElementById('in-pressure').value`)) === '0.67', 'パターン2の圧力');
      t.ok(await b.evalJs(`document.querySelector('#seg-pattern [data-pattern="2"]').classList.contains('is-selected')`), 'パターン2が選ばれた表示');
      await b.click('#btn-minus');
      t.ok((await b.evalJs(`document.getElementById('in-pressure').value`)) === '0.66', '−ボタン');
      await b.click('#seg-pattern [data-pattern="2"]');
      t.ok((await b.evalJs(`document.getElementById('in-pressure').value`)) === '0.67', '選び直すと基準に戻る');
      const s = await b.evalJs(LAYOUT_JS);
      t.ok(!s.over, '横にはみ出す'); t.ok(!s.small.length, '44px未満の部品: ' + s.small.join(', '));
    }
  },
  {
    id: 'TC-IN-03', name: '入力: 基準と違う圧力で注意が出て、登録すると今の設定になり「基準と違う」が付く（TC-IN-01 の画面版）',
    run: async (b, t) => {
      await open(b, 'tab=input&op=U01');
      const before = await b.evalJs(`(window.__GAS__.fns.resetExecutionCache_(), window.__GAS__.fns.readAll_('RECORDS').length)`);
      await b.click('#seg-pattern [data-pattern="2"]');
      await b.click('#seg-fuel [data-fuel="重油"]');
      await b.click('#btn-minus'); await b.click('#btn-minus');
      t.ok(await b.evalJs(`!document.getElementById('pressure-warn').hidden && document.getElementById('pressure-warn').innerText.indexOf('基準') >= 0`), '注意が出ない');
      await b.evalJs(`(function(){ var s = document.getElementById('in-product'); s.value = s.options[1].value; s.dispatchEvent(new Event('change')); var n = document.getElementById('in-note'); n.value = '画面からの登録テスト'; n.dispatchEvent(new Event('input')); })()`);
      await b.click('#btn-submit');
      t.ok(await b.evalJs(`!!document.querySelector('.modal .summary') && document.querySelector('.modal').innerText.indexOf('基準') >= 0`), '確認ダイアログに注意が無い');
      await b.screenshot(path.join(OUT, 'in_confirm.png'));
      await b.evalJs(`(function(){ var btn = Array.prototype.filter.call(document.querySelectorAll('.modal .btn'), function(x){ return x.textContent === '登録する'; })[0]; btn.click(); btn.click(); })()`); // TC-IN-11: 二度押し
      await b.settle();
      const after = await b.evalJs(`(window.__GAS__.fns.resetExecutionCache_(), window.__GAS__.fns.readAll_('RECORDS').length)`);
      t.ok(after === before + 1, 'TC-IN-11 二度押しで1件だけ登録されるはず: ' + before + ' → ' + after);
      const s = await b.evalJs(`({ tab: document.querySelector('.tab-btn.is-active').getAttribute('data-tab'), pressure: document.querySelector('.current-pressure').innerText,
        diff: !!document.querySelector('#current-card .badge-diff'), toasts: window.__toasts.slice() })`);
      t.ok(s.tab === 'home', '登録後はホーム: ' + s.tab);
      t.ok(/^0\.65/.test(s.pressure), '今の設定の圧力: ' + s.pressure);
      t.ok(s.diff, '「基準と違う」バッジが無い');
      t.ok(s.toasts.indexOf('記録しました') >= 0, 'トースト: ' + s.toasts.join(','));
      await b.screenshot(path.join(OUT, 'in_after_home.png'));
    }
  },
  {
    id: 'TC-IN-09', name: '入力: 未来の日時は確認ダイアログで注意し、「戻る」で入力に戻る',
    run: async (b, t) => {
      await open(b, 'tab=input&op=U01');
      await b.evalJs(`(function(){ var d = new Date(Date.now() + 86400000); var v = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
        var e = document.getElementById('in-date'); e.value = v; e.dispatchEvent(new Event('input')); })()`);
      await b.click('#seg-pattern [data-pattern="2"]');
      await b.click('#btn-submit');
      t.ok(await b.evalJs(`document.querySelector('.modal').innerText.indexOf('未来の日時') >= 0`), '未来の日時の注意が無い');
      await b.evalJs(`Array.prototype.filter.call(document.querySelectorAll('.modal .btn'), function(x){ return x.textContent === '戻る'; })[0].click()`);
      t.ok(!(await b.evalJs(`!!document.querySelector('.modal')`)), '「戻る」で閉じない');
      t.ok(await b.evalJs(`document.querySelector('.tab-btn.is-active').getAttribute('data-tab') === 'input'`), '入力に戻らない');
    }
  },
  {
    id: 'TC-IN-05', name: '入力: 圧力が空・範囲外なら欄の下にエラーが出て、確認ダイアログは出ない',
    run: async (b, t) => {
      await open(b, 'tab=input&op=U01');
      await b.evalJs(`(function(){ var e = document.getElementById('in-pressure'); e.value = '0.95'; e.dispatchEvent(new Event('input')); })()`);
      await b.click('#btn-submit');
      t.ok(!(await b.evalJs(`!!document.querySelector('.modal')`)), '確認ダイアログが出てしまう');
      const err = await b.evalJs(`document.querySelector('.field-error[data-error="pressure"]').innerText`);
      t.ok(/0\.50〜0\.80/.test(err), '圧力のエラー: ' + err);
      t.ok(await b.evalJs(`document.querySelector('.field[data-field="pressure"]').classList.contains('has-error')`), 'エラーの枠');
      await b.evalJs('window.scrollTo(0, 0)');
      await b.screenshot(path.join(OUT, 'in_error.png'));
    }
  },
  {
    id: 'TC-LS-U1', name: '履歴: ページ分け（HISTORY_PAGE_SIZE=5 で確認）。「次へ」・ページを選ぶ・開き直しても同じページ・絞り込みで1ページ目',
    run: async (b, t) => {
      const SET = (v) => `(function(){ var g = window.__GAS__; g.fns.resetExecutionCache_(); g.fns.setSetting_('HISTORY_PAGE_SIZE', '${v}');
        localStorage.setItem('boilerMock_v1', g.fakes.helpers.exportState()); sessionStorage.removeItem('boilerPressure.historyPage'); sessionStorage.removeItem('boilerPressure.historyFilter'); })()`;
      const STATE = `({ cards: document.querySelectorAll('#history-list .record-card').length, count: document.getElementById('history-count').innerText,
        sel: (document.getElementById('pager-select') || {}).value, prevOff: !!(document.querySelector('.pager-prev') || {}).disabled, nextOff: !!(document.querySelector('.pager-next') || {}).disabled,
        dates: Array.prototype.map.call(document.querySelectorAll('#history-list .record-when'), function(e){ return e.innerText; }) })`;
      await open(b, 'tab=home&op=U01');
      await b.evalJs(SET(5));
      try {
        await open(b, 'tab=history&op=U01');
        let s = await b.evalJs(STATE);
        t.ok(s.cards === 5, '1ページ目の件数: ' + s.cards);
        const total = Number((s.count.match(/全 (\d+) 件$/) || [])[1]);
        const pages = Math.ceil(total / 5), lastFrom = (pages - 1) * 5 + 1;
        t.ok(/^1〜5件目 ／ 全 \d+ 件$/.test(s.count) && total > 10, '件数の表示: ' + s.count);
        t.ok(s.sel === '1' && s.prevOff && !s.nextOff, '1ページ目のページ送り: ' + JSON.stringify([s.sel, s.prevOff, s.nextOff]));
        const lay = await b.evalJs(LAYOUT_JS);
        t.ok(!lay.over && !lay.small.length, 'はみ出し・44px: ' + lay.small.join(', '));
        await b.screenshot(path.join(OUT, 'ls_history.png'), { fullPage: true });
        const first = s.dates;
        await b.click('.pager-next');
        await b.settle();
        s = await b.evalJs(STATE);
        t.ok(s.cards === 5 && /^6〜10件目/.test(s.count) && s.sel === '2', '「次へ」のあと: ' + s.count + ' / ' + s.sel);
        t.ok(s.dates.every((d) => first.indexOf(d) < 0), '2ページ目に1ページ目の記録が混ざる');
        t.ok(await b.evalJs(`window.scrollY === 0`), 'ページを変えても一覧の先頭に戻らない');
        await b.select('pager-select', String(pages));
        await b.settle();
        s = await b.evalJs(STATE);
        t.ok(s.cards === total - lastFrom + 1 && s.count.indexOf(lastFrom + '〜' + total + '件目') === 0 && s.nextOff && !s.prevOff, '最後のページ: ' + s.count + ' / 次へ無効 ' + s.nextOff);
        await open(b, 'tab=home&op=U01');
        await open(b, 'tab=history&op=U01');
        s = await b.evalJs(STATE);
        t.ok(s.sel === String(pages) && s.count.indexOf(lastFrom + '〜') === 0, '開き直すとページが戻る: ' + s.count);
        await b.click('#btn-filter-toggle');
        await b.select('f-fuel', 'ガス');
        await b.click('#btn-filter-apply');
        await b.settle();
        s = await b.evalJs(STATE);
        t.ok(s.sel === '1' && /^1〜5件目/.test(s.count), '絞り込むと1ページ目に戻らない: ' + s.count);
        await b.click('#btn-filter-clear');
        await b.settle();
      } finally {
        await b.evalJs(SET(20));
      }
    }
  },
  {
    id: 'TC-LS-U2', name: '履歴: 絞り込み（パターン5）で「パターン5」だけになり、無効の設定者も選べ、「条件をクリア」で戻る',
    run: async (b, t) => {
      await open(b, 'tab=history&op=U01');
      await b.click('#btn-filter-toggle');
      t.ok(await b.evalJs(`!document.getElementById('filter-card').hidden`), '絞り込みの欄が開かない');
      t.ok(await b.evalJs(`Array.prototype.some.call(document.querySelectorAll('#f-setter option'), function(o){ return o.text.indexOf('（無効）') >= 0; })`), '無効の設定者が選択肢に無い');
      const lay = await b.evalJs(LAYOUT_JS);
      t.ok(!lay.over && !lay.small.length, '絞り込みの欄のはみ出し・44px: ' + lay.small.join(', '));
      await b.screenshot(path.join(OUT, 'ls_filter.png'));
      await b.select('f-pattern', '5');
      await b.click('#btn-filter-apply');
      await b.settle();
      const s = await b.evalJs(`({ badges: Array.prototype.map.call(document.querySelectorAll('#history-list .badge-pattern'), function(e){ return e.innerText; }),
        n: (document.querySelector('.filter-count') || {}).innerText, hidden: document.getElementById('filter-card').hidden })`);
      t.ok(s.badges.length > 0 && s.badges.every((x) => x === 'パターン5'), 'パターン5 以外が出る: ' + s.badges.join(','));
      t.ok(s.n === '1', '条件の数の表示: ' + s.n);
      t.ok(s.hidden, '「この条件で表示」で欄が閉じない');
      await b.screenshot(path.join(OUT, 'ls_filtered.png'));
      await open(b, 'tab=home&op=U01');
      await open(b, 'tab=history&op=U01');
      t.ok((await b.evalJs(`(document.querySelector('.filter-count') || {}).innerText`)) === '1', '開き直すと条件が消える');
      await b.click('#btn-filter-clear');
      await b.settle();
      const after = await b.evalJs(`({ n: !!document.querySelector('.filter-count'), kinds: Array.from(new Set(Array.prototype.map.call(document.querySelectorAll('#history-list .badge-pattern'), function(e){ return e.innerText; }))).length })`);
      t.ok(!after.n && after.kinds > 1, '「条件をクリア」で戻らない');
    }
  },
  {
    id: 'TC-LS-U3', name: '詳細: 履歴とホームの記録を押すと、下から詳細が出て、閉じられる',
    run: async (b, t) => {
      await open(b, 'tab=history&op=U01');
      const id = await b.evalJs(`document.querySelector('#history-list .record-card').getAttribute('data-record')`);
      await b.click('#history-list .record-card');
      await b.settle();
      const s = await b.evalJs(`(function(){ var m = document.querySelector('.modal[data-kind="record"]'); return { modal: !!m, sheet: !!(m && m.classList.contains('is-sheet')), text: m ? m.innerText : '' }; })()`);
      t.ok(s.modal && s.sheet, '詳細が下から出ない');
      t.ok(s.text.indexOf(id) >= 0 && s.text.indexOf('データ区分') >= 0, '詳細の中身: ' + s.text.slice(0, 80));
      const lay = await b.evalJs(LAYOUT_JS);
      t.ok(!lay.over && !lay.small.length, '詳細のはみ出し・44px: ' + lay.small.join(', '));
      await b.screenshot(path.join(OUT, 'ls_detail.png'));
      await b.evalJs(`Array.prototype.filter.call(document.querySelectorAll('.modal .btn'), function(x){ return x.textContent === '閉じる'; })[0].click()`);
      t.ok(!(await b.evalJs(`!!document.querySelector('.modal')`)), '「閉じる」で閉じない');
      await open(b, 'tab=home&op=U01');
      await b.click('#panel-home .record-card');
      await b.settle();
      t.ok(await b.evalJs(`!!document.querySelector('.modal[data-kind="record"]')`), 'ホームの直近から詳細が開かない');
      await b.evalJs(`(function(){ var g = window.__GAS__; g.fns.resetExecutionCache_(); g.fns.setSetting_('HISTORY_PAGE_SIZE', '20'); localStorage.setItem('boilerMock_v1', g.fakes.helpers.exportState()); })()`);
    }
  },
  {
    id: 'TC-AU-U1', name: '管理者: 鍵のボタンで暗証番号のダイアログ。違う番号はダイアログ内にエラー、正しい番号で管理者モード',
    run: async (b, t) => {
      await open(b, 'tab=home&op=U01');
      await b.evalJs(`sessionStorage.removeItem('boilerPressure.adminToken')`);
      await open(b, 'tab=home&op=U01');
      await b.click('#admin-chip');
      t.ok(await b.evalJs(`!!document.querySelector('.modal[data-kind="pin"]')`), 'ダイアログが出ない');
      await b.evalJs(`document.getElementById('pin-input').value = '0000'`);
      await b.evalJs(clickText('.modal[data-kind="pin"] .btn', '入る'));
      await b.settle();
      const err = await b.evalJs(`(document.getElementById('pin-error') || {}).innerText || ''`);
      t.ok(err.indexOf('暗証番号が違います') >= 0, 'エラーの表示: ' + err);
      await b.screenshot(path.join(OUT, 'au_pin_error.png'));
      await b.evalJs(`document.getElementById('pin-input').value = '123456'`);
      await b.evalJs(clickText('.modal[data-kind="pin"] .btn', '入る'));
      await b.settle();
      const s = await b.evalJs(`({ modal: !!document.querySelector('.modal'), chip: document.getElementById('admin-chip').innerText, on: document.getElementById('admin-chip').classList.contains('is-admin'), toasts: window.__toasts.slice() })`);
      t.ok(!s.modal, 'ダイアログが閉じない');
      t.ok(s.on && /^\d+分$/.test(s.chip.trim()), 'ヘッダの表示（スマホは「n分」だけ）: ' + s.chip);
      const hdr = await b.evalJs(`(function(){ var a = document.getElementById('admin-chip').getBoundingClientRect(), o = document.getElementById('operator-chip').getBoundingClientRect();
        return { inside: a.right <= window.innerWidth + 0.5, name: document.getElementById('operator-chip').innerText.trim(), fit: document.querySelector('#operator-chip > span').scrollWidth <= document.querySelector('#operator-chip > span').clientWidth + 1 }; })()`);
      t.ok(hdr.inside, '管理者のボタンが画面の右にはみ出す');
      t.ok(/^[A-Z]\(架空 .+?\)$/.test(hdr.name) && hdr.fit, '管理者モードでも名前が「記入称(氏名)」で全部見える: ' + hdr.name);
      t.ok(s.toasts.some((x) => x.indexOf('管理者モードにしました') >= 0), 'トースト: ' + s.toasts.join(','));
      const lay = await b.evalJs(LAYOUT_JS);
      t.ok(!lay.over && !lay.small.length, 'はみ出し・44px: ' + lay.small.join(', '));
      await b.screenshot(path.join(OUT, 'au_admin_header.png'));
    }
  },
  {
    id: 'TC-UI-05', name: '管理者モードの時間が切れると、管理者の表示が消えて「時間が切れました」が出る',
    run: async (b, t) => {
      await open(b, 'tab=home&op=U01&admin=1');
      t.ok(await b.evalJs(`document.getElementById('admin-chip').classList.contains('is-admin')`), '管理者モードになっていない');
      await b.evalJs(`state.adminExpiresAt = Date.now() - 1000; tickAdmin();`);
      const s = await b.evalJs(`({ on: document.getElementById('admin-chip').classList.contains('is-admin'), toasts: window.__toasts.slice(), token: sessionStorage.getItem('boilerPressure.adminToken') })`);
      t.ok(!s.on, '管理者の表示が消えない');
      t.ok(s.toasts.some((x) => x.indexOf('時間が切れました') >= 0), 'トースト: ' + s.toasts.join(','));
      t.ok(!s.token, 'トークンが残っている');
    }
  },
  {
    id: 'TC-ED-U1', name: '修正: 本人はアプリの自分の記録を修正でき（削除ボタンは無い）、保存すると「修正しました」',
    run: async (b, t) => {
      await open(b, 'tab=history&op=U01');
      await b.evalJs(`sessionStorage.removeItem('boilerPressure.adminToken')`);
      await open(b, 'tab=history&op=U01');
      const id = await b.evalJs(findRecordJs(`r.setterId === 'U01' && r.source === 'アプリ' && !r.deleted`));
      t.ok(id, '本人のアプリの記録が無い');
      await b.evalJs(`openRecord(${JSON.stringify(id)})`);
      await b.settle();
      const btns = await b.evalJs(`Array.prototype.map.call(document.querySelectorAll('.modal[data-kind="record"] .modal-actions .btn'), function(x){ return x.textContent; })`);
      t.ok(btns.indexOf('修正する') >= 0 && btns.indexOf('削除する') < 0, 'ボタン: ' + btns.join(','));
      await b.evalJs(clickText('.modal[data-kind="record"] .btn', '修正する'));
      t.ok(await b.evalJs(`!!document.querySelector('.modal[data-kind="record-edit"]')`), '修正フォームが出ない');
      t.ok(!(await b.evalJs(`!!document.querySelector('.modal[data-kind="record-edit"] [data-ed="setter"]')`)), '本人なのに設定者を選べる');
      const lay = await b.evalJs(LAYOUT_JS);
      t.ok(!lay.over && !lay.small.length, '修正フォームのはみ出し・44px: ' + lay.small.join(', '));
      await b.screenshot(path.join(OUT, 'ed_editor.png'));
      await b.evalJs(`(function(){ var n = document.querySelector('[data-ed="note"]'); n.value = '画面から修正'; n.dispatchEvent(new Event('input')); })()`);
      await b.evalJs(clickText('.modal[data-kind="record-edit"] .btn', '保存する'));
      await b.settle();
      const s = await b.evalJs(`(function(){ var g = window.__GAS__.fns; g.resetExecutionCache_(); var r = g.readAll_('RECORDS').filter(function(x){ return x.recordId === ${JSON.stringify(id)}; })[0];
        return { note: r.note, version: r.version, toasts: window.__toasts.slice(), modal: !!document.querySelector('.modal') }; })()`);
      t.ok(s.note === '画面から修正' && s.version === 2, 'シートの値: ' + s.note + ' / v' + s.version);
      t.ok(s.toasts.indexOf('修正しました') >= 0, 'トースト: ' + s.toasts.join(','));
      t.ok(!s.modal, 'モーダルが閉じない');
    }
  },
  {
    id: 'TC-ED-U2', name: '修正: 本人でも移行データは修正できず、案内（M-24）が出る',
    run: async (b, t) => {
      await open(b, 'tab=history&op=U01');
      const id = await b.evalJs(findRecordJs(`r.setterId === 'U01' && r.source === '移行' && !r.deleted`));
      t.ok(id, '本人の移行データが無い');
      await b.evalJs(`openRecord(${JSON.stringify(id)})`);
      await b.settle();
      const s = await b.evalJs(`(function(){ var m = document.querySelector('.modal[data-kind="record"]');
        return { btns: Array.prototype.map.call(m.querySelectorAll('.modal-actions .btn'), function(x){ return x.textContent; }), info: (m.querySelector('.notice-info') || {}).innerText || '' }; })()`);
      t.ok(s.btns.join(',') === '閉じる', 'ボタン: ' + s.btns.join(','));
      t.ok(s.info.indexOf('本人と管理者') >= 0, '案内: ' + s.info);
      await b.screenshot(path.join(OUT, 'ed_migrated.png'));
    }
  },
  {
    id: 'TC-ED-U3', name: '削除・元に戻す: 管理者は他人の記録を削除でき、「削除済みも表示」で見え、元に戻せる',
    run: async (b, t) => {
      await open(b, 'tab=history&op=U01&admin=1');
      const id = await b.evalJs(findRecordJs(`r.setterId === 'U02' && r.source === 'アプリ' && !r.deleted`));
      t.ok(id, '他人の記録が無い');
      await b.evalJs(`openRecord(${JSON.stringify(id)})`);
      await b.settle();
      const btns = await b.evalJs(`Array.prototype.map.call(document.querySelectorAll('.modal[data-kind="record"] .modal-actions .btn'), function(x){ return x.textContent; })`);
      t.ok(btns.join(',') === '閉じる,削除する,修正する', '管理者のボタン: ' + btns.join(','));
      await b.screenshot(path.join(OUT, 'ed_admin_detail.png'));
      await b.evalJs(clickText('.modal[data-kind="record"] .btn', '削除する'));
      t.ok(await b.evalJs(`document.querySelector('.modal').innerText.indexOf('削除しますか') >= 0`), '削除の確認が出ない');
      await b.evalJs(clickText('.modal .btn', '削除する'));
      await b.settle();
      t.ok((await b.evalJs(`window.__toasts.slice()`)).indexOf('削除しました') >= 0, '「削除しました」が出ない');
      t.ok(!(await b.evalJs(`!!document.querySelector('#history-list .record-card[data-record=${JSON.stringify(id)}]')`)), '一覧に残っている');
      await b.click('#btn-include-deleted');
      await b.settle();
      t.ok(await b.evalJs(`!!document.querySelector('#history-list .record-card.is-deleted[data-record=${JSON.stringify(id)}]')`), '「削除済みも表示」で出ない');
      await b.screenshot(path.join(OUT, 'ed_include_deleted.png'));
      await b.click(`#history-list .record-card[data-record=${JSON.stringify(id)}]`);
      await b.settle();
      await b.evalJs(clickText('.modal[data-kind="record"] .btn', '元に戻す'));
      await b.settle();
      const s = await b.evalJs(`(function(){ var g = window.__GAS__.fns; g.resetExecutionCache_(); var r = g.readAll_('RECORDS').filter(function(x){ return x.recordId === ${JSON.stringify(id)}; })[0];
        return { deleted: r.deleted, toasts: window.__toasts.slice() }; })()`);
      t.ok(!s.deleted && s.toasts.indexOf('元に戻しました') >= 0, '元に戻らない: ' + JSON.stringify(s));
      await b.click('#btn-include-deleted'); // 元の表示に戻す
      await b.settle();
    }
  },
  {
    id: 'TC-AU-U2', name: '管理者: サーバー側でトークンが切れていたら、削除のときに暗証番号のダイアログが出て、入れると削除が続く',
    run: async (b, t) => {
      await open(b, 'tab=history&op=U01&admin=1');
      const id = await b.evalJs(findRecordJs(`r.setterId === 'U03' && r.source === 'アプリ' && !r.deleted`));
      t.ok(id, '他人の記録が無い');
      await b.evalJs(`openRecord(${JSON.stringify(id)})`);
      await b.settle();
      // 詳細を開いたあとで、サーバー側だけトークンの期限が切れた状態にする
      await b.evalJs(`window.__GAS__.fakes.CacheService.getScriptCache().remove('auth:' + state.token)`);
      await b.evalJs(clickText('.modal[data-kind="record"] .btn', '削除する'));
      await b.evalJs(clickText('.modal .btn', '削除する'));
      await b.settle();
      t.ok(await b.evalJs(`!!document.querySelector('.modal[data-kind="pin"]')`), '暗証番号のダイアログが出ない');
      await b.evalJs(`document.getElementById('pin-input').value = '123456'`);
      await b.evalJs(clickText('.modal[data-kind="pin"] .btn', '入る'));
      await b.settle();
      const s = await b.evalJs(`(function(){ var g = window.__GAS__.fns; g.resetExecutionCache_(); var r = g.readAll_('RECORDS').filter(function(x){ return x.recordId === ${JSON.stringify(id)}; })[0];
        return { deleted: r.deleted, toasts: window.__toasts.slice(), admin: document.getElementById('admin-chip').classList.contains('is-admin') }; })()`);
      t.ok(s.deleted, '削除が続かない');
      t.ok(s.toasts.indexOf('削除しました') >= 0 && s.admin, 'トースト・管理者の表示: ' + JSON.stringify(s));
    }
  },
  {
    id: 'TC-LG-U1', name: '操作ログ: 管理者は履歴の「操作ログ」から、新しい順の一覧を見られる',
    run: async (b, t) => {
      await open(b, 'tab=home&op=U01');
      await b.evalJs(`sessionStorage.removeItem('boilerPressure.adminToken')`);
      await open(b, 'tab=history&op=U01&admin=1');
      await b.click('#btn-logs');
      await b.settle();
      const s = await b.evalJs(`(function(){ var m = document.querySelector('.modal[data-kind="logs"]'); return { modal: !!m, rows: m ? m.querySelectorAll('.log-row').length : 0, first: m && m.querySelector('.log-row') ? m.querySelector('.log-row').innerText : '' }; })()`);
      t.ok(s.modal && s.rows > 0, '操作ログが出ない');
      t.ok(/元に戻す|削除の取り消し|削除|修正|登録|管理者認証/.test(s.first), '先頭: ' + s.first);
      const lay = await b.evalJs(LAYOUT_JS);
      t.ok(!lay.over, 'はみ出し');
      await b.screenshot(path.join(OUT, 'lg_logs.png'));
    }
  },
  {
    id: 'TC-UI-06', name: '通信できないとき: 登録すると「通信できませんでした」が出て、入力した内容は消えない',
    run: async (b, t) => {
      await open(b, 'tab=input&op=U01');
      await b.click('#seg-pattern [data-pattern="2"]');
      await b.evalJs(`(function(){ var n = document.getElementById('in-note'); n.value = '通信テスト'; n.dispatchEvent(new Event('input')); })()`);
      // google.script.run を、必ず失敗する代わりのものにする
      await b.evalJs(`window.google.script.run = (function mk(onS, onF) { return new Proxy({}, { get: function (_, p) {
        if (p === 'withSuccessHandler') return function (fn) { return mk(fn, onF); };
        if (p === 'withFailureHandler') return function (fn) { return mk(onS, fn); };
        if (p === 'withUserObject') return function () { return mk(onS, onF); };
        return function () { setTimeout(function () { if (onF) onF(new Error('network')); }, 50); };
      } }); })(null, null); true`); // 最後に true を返す（代わりのもの自体を返すと、結果の変換が終わらなくなる）
      await b.click('#btn-submit');
      await b.evalJs(clickText('.modal .btn', '登録する'));
      await b.settle();
      const s = await b.evalJs(`({ msg: (document.querySelector('.modal') || {}).innerText || '', note: document.getElementById('in-note').value,
        tab: document.querySelector('.tab-btn.is-active').getAttribute('data-tab'), loading: document.getElementById('loading-overlay').classList.contains('is-visible') })`);
      t.ok(s.msg.indexOf('通信できませんでした') >= 0, 'エラーの表示: ' + s.msg.slice(0, 60));
      t.ok(s.note === '通信テスト' && s.tab === 'input', '入力が消えた: ' + JSON.stringify(s));
      t.ok(!s.loading, 'ローディングが消えない');
      await b.screenshot(path.join(OUT, 'ui06_network.png'));
    }
  },
  {
    id: 'TC-UI-07', name: 'iPhone で画面が勝手に拡大しないよう、入力欄の文字が16px以上（入力・履歴の絞り込み・修正・暗証番号）',
    run: async (b, t) => {
      const FONT_JS = `Array.prototype.filter.call(document.querySelectorAll('input, select, textarea'), function(el){ if (el.closest('.preview-banner')) return false; // プレビュー専用のバナーは除く
        var r = el.getBoundingClientRect(); return r.width > 0 && parseFloat(getComputedStyle(el).fontSize) < 16; }).map(function(el){ return (el.id || el.getAttribute('data-ed') || el.className) + ' ' + getComputedStyle(el).fontSize; })`;
      await open(b, 'tab=input&op=U01');
      let small = await b.evalJs(FONT_JS);
      t.ok(!small.length, '入力: ' + small.join(', '));
      await open(b, 'tab=history&op=U01');
      await b.click('#btn-filter-toggle');
      small = await b.evalJs(FONT_JS);
      t.ok(!small.length, '絞り込み: ' + small.join(', '));
      const id = await b.evalJs(findRecordJs(`r.setterId === 'U01' && r.source === 'アプリ' && !r.deleted`));
      await b.evalJs(`openRecord(${JSON.stringify(id)})`);
      await b.settle();
      await b.evalJs(clickText('.modal[data-kind="record"] .btn', '修正する'));
      small = await b.evalJs(FONT_JS);
      t.ok(!small.length, '修正フォーム: ' + small.join(', '));
      await open(b, 'tab=home&op=U01');
      await b.evalJs(`sessionStorage.removeItem('boilerPressure.adminToken')`);
      await open(b, 'tab=home&op=U01');
      await b.click('#admin-chip');
      small = await b.evalJs(FONT_JS);
      t.ok(!small.length, '暗証番号: ' + small.join(', '));
    }
  },
  {
    id: 'TC-UI-09', name: '表示: パターンは「パターンN」、設定者は「記入称(氏名)」（ホーム・履歴・詳細・入力・絞り込み）',
    run: async (b, t) => {
      await open(b, 'tab=home&op=U01');
      const home = await b.evalJs(`({ meta: document.querySelector('#current-card .meta').innerText,
        badges: Array.prototype.map.call(document.querySelectorAll('#panel-home .badge-pattern'), function(e){ return e.innerText; }),
        setters: Array.prototype.map.call(document.querySelectorAll('#panel-home .record-setter'), function(e){ return e.innerText; }) })`);
      t.ok(/設定者 [A-Z]\(架空 .+?\)/.test(home.meta), 'ホームの今の設定の設定者: ' + home.meta);
      t.ok(home.badges.length && home.badges.every((x) => /^パターン\d$/.test(x)), 'ホームのパターン: ' + home.badges.join(','));
      t.ok(home.setters.length && home.setters.every((x) => /^[A-Z]\(架空 .+?\)$/.test(x)), 'ホームの設定者: ' + home.setters.join(','));
      await open(b, 'tab=history&op=U01');
      const hist = await b.evalJs(`({ badges: Array.prototype.map.call(document.querySelectorAll('#history-list .badge-pattern'), function(e){ return e.innerText; }),
        setters: Array.prototype.map.call(document.querySelectorAll('#history-list .record-setter'), function(e){ return e.innerText; }),
        opts: Array.prototype.map.call(document.querySelectorAll('#f-setter option'), function(o){ return o.text; }).slice(1) })`);
      t.ok(hist.badges.every((x) => /^パターン\d$/.test(x)), '履歴のパターン: ' + hist.badges.slice(0, 3).join(','));
      t.ok(hist.setters.every((x) => /^[A-Z]\(架空 .+?\)$/.test(x)), '履歴の設定者: ' + hist.setters.slice(0, 3).join(','));
      t.ok(hist.opts.every((x) => /^[A-Z]\(架空 .+?\)(（無効）)?$/.test(x)), '絞り込みの設定者: ' + hist.opts.join(','));
      await b.click('#history-list .record-card');
      await b.settle();
      const det = await b.evalJs(`document.querySelector('.modal[data-kind="record"]').innerText`);
      t.ok(/パターン\d/.test(det) && /[A-Z]\(架空 .+?\)/.test(det), '詳細の表示: ' + det.slice(0, 80).replace(/\n/g, ' '));
      await b.screenshot(path.join(OUT, 'ui09_detail.png'));
      await open(b, 'tab=input&op=U01');
      const box = await b.evalJs(`document.querySelector('.setter-box').innerText.trim()`);
      t.ok(box === 'A(架空 一郎)', '入力の設定者: ' + box);
    }
  },
  {
    id: 'TC-UI-10', name: 'タブレット（幅768px）: はみ出さず44px以上。ホームは左右2列、履歴のカードは2列、ページ送りは番号、タブは下',
    run: async (b, t) => {
      await b.setViewport(768, 1024);
      try {
        for (const tab of ['home', 'input', 'history', 'patterns']) {
          await open(b, 'tab=' + tab + '&op=U01');
          const s = await b.evalJs(LAYOUT_JS);
          t.ok(!s.over, tab + ' が横にはみ出す: ' + s.scrollWidth);
          t.ok(!s.small.length, tab + ' に44px未満の部品: ' + s.small.join(', '));
          await b.screenshot(path.join(OUT, 'tab768_' + tab + '.png'), { fullPage: true });
        }
        await open(b, 'tab=home&op=U01');
        const home = await b.evalJs(`(function(){ var a = document.querySelector('.home-main').getBoundingClientRect(), c = document.querySelector('.home-side').getBoundingClientRect(); return { sameRow: Math.abs(a.top - c.top) < 2, leftRight: a.right <= c.left }; })()`);
        t.ok(home.sameRow && home.leftRight, 'ホームが左右2列にならない: ' + JSON.stringify(home));
        await open(b, 'tab=history&op=U01');
        const h = await b.evalJs(`(function(){ var c = document.querySelectorAll('#history-list .record-card'); var a = c[0].getBoundingClientRect(), d = c[1].getBoundingClientRect();
          var bar = document.getElementById('tabbar').getBoundingClientRect();
          return { twoCols: Math.abs(a.top - d.top) < 2 && a.right < d.left, nums: getComputedStyle(document.querySelector('.pager-nums')).display !== 'none',
            select: getComputedStyle(document.getElementById('pager-select')).display !== 'none', tabBottom: bar.bottom >= window.innerHeight - 1 }; })()`);
        t.ok(h.twoCols, '履歴のカードが2列にならない');
        t.ok(h.nums && !h.select, 'ページ送りが番号にならない');
        t.ok(h.tabBottom, 'タブが画面の下に無い');
      } finally {
        await b.setViewport(WIDTH, 812);
      }
    }
  },
  {
    id: 'TC-UI-11', name: 'PC（幅1280px）: はみ出さない。タブはヘッダの中、履歴は表（見出しと列がそろう）、絞り込みは常に表示、入力は左右2列、詳細は中央',
    run: async (b, t) => {
      await b.setViewport(1280, 800);
      try {
        for (const tab of ['home', 'input', 'history', 'patterns']) {
          await open(b, 'tab=' + tab + '&op=U01');
          const s = await b.evalJs(LAYOUT_JS);
          t.ok(!s.over, tab + ' が横にはみ出す: ' + s.scrollWidth);
          t.ok(!s.small.length, tab + ' に44px未満の部品: ' + s.small.join(', '));
          await b.screenshot(path.join(OUT, 'pc1280_' + tab + '.png'));
        }
        await open(b, 'tab=history&op=U01');
        const h = await b.evalJs(`(function(){
          var head = document.querySelector('#history-list .record-head'), row = document.querySelector('#history-list .record-card');
          var hx = Array.prototype.map.call(head.children, function(e){ return Math.round(e.getBoundingClientRect().left); });
          var cells = [row.querySelector('.record-when'), row.querySelector('.record-badges'), row.querySelector('.record-pressure'), row.querySelector('.record-setter'), row.querySelector('.record-product'), row.querySelector('.record-note')];
          var rx = cells.map(function(e){ return Math.round(e.getBoundingClientRect().left); });
          var bar = document.getElementById('tabbar').getBoundingClientRect(), hdr = document.querySelector('.app-header').getBoundingClientRect();
          return { headShown: getComputedStyle(head).display !== 'none', hx: hx, rx: rx, inHeader: bar.top >= hdr.top - 1 && bar.bottom <= hdr.bottom + 1,
            filter: !document.getElementById('filter-card').hidden || getComputedStyle(document.getElementById('filter-card')).display !== 'none',
            toggle: getComputedStyle(document.getElementById('btn-filter-toggle')).display !== 'none' };
        })()`);
        t.ok(h.headShown, '表の見出しが出ない');
        t.ok(JSON.stringify(h.hx) === JSON.stringify(h.rx), '見出しと列がそろわない: ' + h.hx + ' / ' + h.rx);
        t.ok(h.inHeader, 'タブがヘッダの中に無い');
        t.ok(h.filter && !h.toggle, '絞り込みが常に表示されていない');
        await b.click('#history-list .record-card');
        await b.settle();
        const m = await b.evalJs(`(function(){ var r = document.querySelector('.modal[data-kind="record"] .modal-box').getBoundingClientRect(); return { mid: Math.abs((r.top + r.bottom) / 2 - window.innerHeight / 2) < 4, w: Math.round(r.width) }; })()`);
        t.ok(m.mid && m.w <= 560, '詳細が中央に出ない: ' + JSON.stringify(m));
        await b.screenshot(path.join(OUT, 'pc1280_detail.png'));
        await open(b, 'tab=input&op=U01');
        const inp = await b.evalJs(`(function(){ var a = document.querySelector('.input-card [data-field="pattern"]').getBoundingClientRect(), c = document.querySelector('.input-card [data-field="date"]').getBoundingClientRect(); return Math.abs(a.top - c.top) < 2 && a.right < c.left; })()`);
        t.ok(inp, '入力が左右2列にならない');
      } finally {
        await b.setViewport(WIDTH, 812);
      }
    }
  },
  {
    id: 'TC-UI-12', name: '日付・時刻の欄: 幅320・375・768px で、日付・時刻・「今の時刻にする」が重ならず、高さ48pxで枠の中に収まる（入力・修正・絞り込み）',
    run: async (b, t) => {
      const DT = (sel) => `(function(){
        var row = document.querySelector(${JSON.stringify(sel)}); if (!row) return { err: 'なし' };
        var r = Array.prototype.map.call(row.querySelectorAll('input, button'), function(e){ var x = e.getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, h: Math.round(x.height) }; });
        var box = row.getBoundingClientRect(), bad = [];
        for (var i = 1; i < r.length; i++) if (Math.abs(r[i].t - r[i-1].t) < 2 && r[i].l < r[i-1].r - 0.5) bad.push('重なり ' + i);
        r.forEach(function(x, i){ if (x.r > box.right + 0.5) bad.push('枠の外 ' + i); });
        Array.prototype.forEach.call(row.querySelectorAll('input'), function(e){ if (Math.round(e.getBoundingClientRect().height) !== 48) bad.push('高さ ' + Math.round(e.getBoundingClientRect().height)); });
        return { bad: bad };
      })()`;
      try {
        for (const w of [320, 375, 768]) {
          await b.setViewport(w, 900);
          await open(b, 'tab=input&op=U01');
          let s = await b.evalJs(DT('#panel-input .dt-row'));
          t.ok(!s.err && !s.bad.length, '入力 幅' + w + ': ' + JSON.stringify(s));
          if (w === 320) await b.screenshot(path.join(OUT, 'ui12_input_320.png'));
          await open(b, 'tab=history&op=U01');
          if (w < 1024) await b.click('#btn-filter-toggle');
          s = await b.evalJs(`(function(){ var a = document.getElementById('f-from').getBoundingClientRect(), c = document.getElementById('f-to').getBoundingClientRect();
            return { ok: a.right <= c.left + 0.5 && Math.round(a.height) === 48 && Math.round(c.height) === 48 && c.right <= document.getElementById('filter-card').getBoundingClientRect().right }; })()`);
          t.ok(s.ok, '絞り込みの期間 幅' + w);
        }
        await b.setViewport(375, 812);
        await open(b, 'tab=history&op=U01');
        const id = await b.evalJs(findRecordJs(`r.setterId === 'U01' && r.source === 'アプリ' && !r.deleted`));
        await b.evalJs(`openRecord(${JSON.stringify(id)})`); await b.settle();
        await b.evalJs(clickText('.modal[data-kind="record"] .btn', '修正する')); await b.settle();
        const s = await b.evalJs(DT('.modal[data-kind="record-edit"] .dt-row'));
        t.ok(!s.err && !s.bad.length, '修正: ' + JSON.stringify(s));
      } finally {
        await b.setViewport(WIDTH, 812);
      }
    }
  },
  {
    id: 'TC-UI-13', name: 'スクロールしても画面上部（ヘッダ）が残る（幅375・768・1280px。GAS の枠と同じく html にスクロールを持たせて確認）。PC の履歴は項目名がヘッダのすぐ下に残る',
    run: async (b, t) => {
      const PROBE = `(function(){ var pb = document.querySelector('.preview-banner'); if (pb) pb.style.display = 'none'; document.body.style.paddingTop = '0';
        document.documentElement.style.overflow = 'auto'; document.scrollingElement.scrollTop = 600;
        var h = document.querySelector('.app-header').getBoundingClientRect(), th = document.querySelector('#history-list .record-head');
        var tr = th ? th.getBoundingClientRect() : null;
        return { scrolled: document.scrollingElement.scrollTop > 100, headerTop: Math.round(h.top), headerBottom: Math.round(h.bottom),
          headShown: !!th && getComputedStyle(th).display !== 'none', headTop: tr ? Math.round(tr.top) : null }; })()`;
      try {
        for (const w of [375, 768, 1280]) {
          await b.setViewport(w, 800);
          await open(b, 'tab=history&op=U01');
          const s = await b.evalJs(PROBE);
          t.ok(s.scrolled, '幅' + w + ': スクロールできない');
          t.ok(s.headerTop === 0, '幅' + w + ': ヘッダが流れる（' + s.headerTop + '）');
          if (w >= 1024) t.ok(s.headShown && s.headTop === s.headerBottom, '幅' + w + ': 項目名がヘッダの下に残らない（' + s.headTop + ' / ' + s.headerBottom + '）');
          await b.screenshot(path.join(OUT, 'ui13_scrolled_' + w + '.png'), { visible: true }); // スクロールした位置で見えている範囲を撮る
        }
      } finally {
        await b.setViewport(WIDTH, 812);
      }
    }
  },
  {
    id: 'TC-UI-08', name: 'js.html で alert / confirm / prompt を使っていない',
    run: async (b, t) => {
      const js = fs.readFileSync(path.join(ROOT, 'gas_app', 'js.html'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      t.ok(!/\b(alert|confirm|prompt)\s*\(/.test(js), 'alert / confirm / prompt の呼び出しがある');
    }
  }
];

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'local_preview.html'))) { console.error('local_preview.html がありません。先に node tools/build_local_preview.js を実行してください'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launchBrowser({ siteDir: ROOT, viewport: { width: WIDTH, height: 812 } });
  let ng = 0;
  try {
    for (const c of CHECKS.filter((x) => !ONLY || ONLY.indexOf(x.id) >= 0)) {
      const errors = [];
      const t = { ok: (cond, m) => { if (!cond) errors.push(m); } };
      let timer;
      try {
        await Promise.race([c.run(b, t), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(CHECK_TIMEOUT_MS / 1000 + '秒たっても終わらない')), CHECK_TIMEOUT_MS); })]);
      } catch (e) { errors.push('例外: ' + (e && e.message ? e.message : e)); }
      finally { clearTimeout(timer); }
      if (errors.length) ng++;
      console.log((errors.length ? ' NG ' : ' OK ') + ' ' + c.id + ' ' + c.name + (errors.length ? ' — ' + errors.join(' / ') : ''));
    }
    const pageErrors = b.consoleMessages.filter((m) => !/^warning: \[プレビュー\]/.test(m));
    if (pageErrors.length) {
      ng++;
      console.log(' NG  ページ内のエラー・警告:');
      pageErrors.forEach((m) => console.log('      ' + m));
    }
  } finally {
    await b.close();
  }
  console.log('画像: ' + path.relative(ROOT, OUT));
  console.log(ng ? 'NG が ' + ng + ' 件あります' : 'すべて OK です');
  process.exit(ng ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
