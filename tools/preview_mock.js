/**
 * local_preview.html 用のモック（plan/01 K-25、plan/05 §9）
 * 元: 02.物品購入届CSV出力/tools/preview_mock.js（google.script.run の代用部分を流用）
 *
 * - google.script.run の代わりに、フェイク（tools/gas_fakes.js）の上で動く本物の Code.gs を呼ぶ。
 * - データは Tests.gs の seedDevData() が作る架空のもの（実在の人物ではない）。
 *   localStorage（キー boilerMock_v1）に保存し、再読み込みしても残す。
 * - 管理者パスワードは boiler（Tests.gs の setAdminPasswordForPreview_ でスクリプトプロパティに入れる。保存データを読んだあとも毎回入れ直す）。
 * - URL のハッシュで状態を指定できる（例: local_preview.html#tab=history&op=U02&admin=1&open=BP-20261101-001）
 *     op=入力者ID   … 操作者（op=none で未選択の状態にする）
 *     admin=1      … 管理者モードにする
 *     open=記録ID  … 記録の詳細を開く（js.html の openRecord を呼ぶ）
 *     tab=…        … js.html 側で扱う
 * - Code.gs や Tests.gs にまだ無い関数は呼ばない（typeof で確かめる）。
 */
(function () {
  'use strict';
  var STORAGE_KEY = 'boilerMock_v1';
  var OP_KEY = 'boilerPressure.operatorId';     // js.html と同じキー（plan/01 K-19）
  var TOKEN_KEY = 'boilerPressure.adminToken';  // js.html と同じキー（sessionStorage）
  var PREVIEW_PASSWORD = 'boiler';
  var GAS = window.__GAS__;
  var fns = GAS.fns;
  var fakes = GAS.fakes;

  // seedDevData がまだ無いとき（フェーズ0）の、バナー用の仮の操作者
  var FALLBACK_OPERATORS = [
    { operatorId: 'U01', shortName: 'A', fullName: '架空 一郎', isUnderline: false },
    { operatorId: 'U02', shortName: 'B', fullName: '架空 二郎', isUnderline: true },
    { operatorId: 'U03', shortName: 'C', fullName: '架空 三郎', isUnderline: false },
    { operatorId: 'U04', shortName: 'D', fullName: '架空 四郎', isUnderline: false },
    { operatorId: 'U05', shortName: 'E', fullName: '架空 五郎', isUnderline: false }
  ];

  function call(name) {
    if (typeof fns[name] !== 'function') return undefined;
    if (typeof fns.resetExecutionCache_ === 'function') fns.resetExecutionCache_();
    return fns[name].apply(null, Array.prototype.slice.call(arguments, 1));
  }

  function seedAll() {
    call('menuSetup');
    var msg = call('seedDevData');
    if (msg) console.log('[プレビュー] ' + msg);
    call('setAdminPasswordForPreview_', PREVIEW_PASSWORD);
    saveState();
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, fakes.helpers.exportState()); } catch (e) { console.warn('プレビューのデータを保存できません: ' + e); }
  }

  function loadOrSeed() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { saved = null; }
    if (saved) {
      try { fakes.helpers.importState(saved); call('setAdminPasswordForPreview_', PREVIEW_PASSWORD); return; } catch (e) { console.warn('保存データを読めないため作り直します: ' + e); }
    }
    seedAll();
  }

  function mockOperators() {
    try {
      var res = call('getInitialData', { operatorId: '', token: null });
      if (res && res.ok && res.data && res.data.operators && res.data.operators.length) {
        return res.data.operators.filter(function (o) { return o.active; });
      }
    } catch (e) { console.warn(e); }
    return FALLBACK_OPERATORS;
  }

  function getOperatorId() { try { return localStorage.getItem(OP_KEY) || ''; } catch (e) { return ''; } }
  function hasToken() { try { return !!sessionStorage.getItem(TOKEN_KEY); } catch (e) { return false; } }

  function authenticateAsAdmin() {
    var res = call('authenticateAdmin', getOperatorId(), PREVIEW_PASSWORD);
    if (res === undefined) { console.warn('[プレビュー] authenticateAdmin はまだありません'); return false; }
    saveState();
    if (res && res.ok) { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ operatorId: getOperatorId(), token: res.data.token, expiresAt: res.data.expiresAt })); return true; }
    console.warn('[プレビュー] 管理者認証に失敗しました', res && res.error);
    return false;
  }

  // ---- google.script.run の代わり ----
  window.__gasPending = 0; // tools/browserDriver.js が、通信が終わるのを待つために見る
  function makeRunner(onSuccess, onFailure) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return makeRunner(fn, onFailure); };
        if (prop === 'withFailureHandler') return function (fn) { return makeRunner(onSuccess, fn); };
        if (prop === 'withUserObject') return function () { return makeRunner(onSuccess, onFailure); };
        return function () {
          var args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
          window.__gasPending++;
          setTimeout(function () {
            try {
              var f = fns[prop];
              if (typeof f !== 'function') throw new Error('サーバー関数がありません: ' + String(prop));
              var res = f.apply(null, args);
              saveState();
              if (onSuccess) onSuccess(res);
            } catch (e) {
              console.error(e);
              if (onFailure) onFailure(e);
            } finally {
              window.__gasPending--;
            }
          }, 120);
        };
      }
    });
  }
  window.google = { script: { run: makeRunner(null, null) } };

  // ---- バナーの操作 ----
  window.mockReset = function () {
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(OP_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* 無視 */ }
    location.hash = '';
    location.reload();
  };
  window.mockSwitch = function (operatorId) {
    try { localStorage.setItem(OP_KEY, operatorId); sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* 無視 */ }
    location.reload();
  };
  window.mockAdmin = function () {
    if (hasToken()) { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* 無視 */ } location.reload(); return; }
    if (authenticateAsAdmin()) location.reload();
  };

  // ---- 起動 ----
  var hash = String(location.hash || '');
  loadOrSeed();

  var ops = mockOperators();
  var m = hash.match(/op=(\w+)/);
  try {
    if (m && m[1] === 'none') localStorage.removeItem(OP_KEY); // 操作者が未選択の状態（TC-UI-01）
    else if (m) localStorage.setItem(OP_KEY, m[1]);
    else if (!localStorage.getItem(OP_KEY) && ops.length) localStorage.setItem(OP_KEY, ops[0].operatorId);
  } catch (e) { /* 無視 */ }

  if (/admin=1/.test(hash) && !hasToken()) authenticateAsAdmin();

  document.addEventListener('DOMContentLoaded', function () {
    var sel = document.getElementById('pv-operator');
    if (sel) {
      var cur = getOperatorId();
      sel.innerHTML = ops.map(function (o) {
        var label = o.operatorId + ' ' + o.shortName + (o.isUnderline ? ' (下線)' : '') + (o.fullName ? '（' + o.fullName + '）' : '');
        return '<option value="' + o.operatorId + '"' + (o.operatorId === cur ? ' selected' : '') + '>' + label + '</option>';
      }).join('');
    }
    var btn = document.getElementById('pv-admin');
    if (btn) btn.textContent = hasToken() ? '管理者モードを解除' : '管理者モード';
  });

  var o = hash.match(/open=([\w-]+)/);
  if (o) {
    window.addEventListener('load', function () {
      setTimeout(function () { if (typeof window.openRecord === 'function') window.openRecord(o[1]); }, 1200);
    });
  }
})();
