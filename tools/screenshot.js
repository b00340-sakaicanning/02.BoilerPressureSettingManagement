#!/usr/bin/env node
/**
 * local_preview.html を撮影する（画面確認用。plan/02 §2）
 *
 *   node tools/screenshot.js "<ハッシュ>" <出力先.png|.webp> [幅=375] [--full]
 *   例: node tools/screenshot.js "tab=home&op=U01" screenshot/home.png
 *       node tools/screenshot.js "tab=history&op=U01&admin=1" screenshot/history_admin.png 375 --full
 *
 * 事前に node tools/build_local_preview.js で local_preview.html を作っておくこと。
 * 撮影のたびにプレビューのデータ（localStorage）は空の状態から作り直される（Chrome のプロファイルを毎回新しくするため）。
 * ページ内のエラーや警告があれば、最後に一覧で出す。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { launchBrowser } = require('./browserDriver.js');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2).filter((a) => a !== '--full');
const fullPage = process.argv.includes('--full');
const hash = args[0] || 'tab=home&op=U01';
const out = path.resolve(ROOT, args[1] || 'screenshot/preview.png');
const width = Number(args[2] || 375);

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'local_preview.html'))) {
    console.error('local_preview.html がありません。先に node tools/build_local_preview.js を実行してください');
    process.exit(1);
  }
  const b = await launchBrowser({ siteDir: ROOT, viewport: { width, height: 812 } });
  try {
    await b.goto('/local_preview.html#' + hash);
    await b.screenshot(out, { fullPage });
    console.log('撮影しました: ' + path.relative(ROOT, out) + '（幅' + width + 'px' + (fullPage ? '、ページ全体' : '') + '）');
    if (b.consoleMessages.length) {
      console.log('ページ内のエラー・警告:');
      b.consoleMessages.forEach((m) => console.log('  ' + m));
    }
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
