/* ============================================================
 * 画面を実際に動かすテスト (jsdom)
 *
 * tests.js の大半は「core層の計算」か「ソースにこう書いてある」の検査で、
 * ボタンを押したときに本当に動くかは見ていない。
 * ここでは index.html をブラウザと同じように読み込み、
 * 実際にクリック・入力して結果を確かめる。
 *
 *   実行: node ui-tests.js          (jsdom が無ければ何もせず終了)
 *   準備: npm install jsdom
 * ============================================================ */
const fs = require('fs'), path = require('path');

let JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  try { JSDOM = require('/tmp/node_modules/jsdom').JSDOM; }
  catch (e2) {
    console.log('--- 画面の動作テスト ---');
    console.log('  jsdom が入っていないため省略しました。`npm install jsdom` で実行できます。');
    process.exit(0);
  }
}

const htmlPath = process.argv[2] || path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) pass++;
  else { fail++; console.log('  ✗ FAIL:', name, detail !== undefined ? '→ ' + detail : ''); }
}
function section(s) { console.log('--- ' + s); }

/* ---------- 画面を起こす ---------- */
function boot() {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://example.invalid/',
    // ページのスクリプトが走る前に、ブラウザにあって jsdom に無いものを補う
    beforeParse(w) {
      w.alert = msg => { w.__alerts = (w.__alerts || []).concat(String(msg)); };
      w.confirm = () => (w.__confirmAnswer === undefined ? true : w.__confirmAnswer);
      w.prompt = () => w.__promptAnswer;
      w.matchMedia = q => ({
        matches: false, media: q,
        addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {}
      });
      w.URL.createObjectURL = () => 'blob:x';
      w.URL.revokeObjectURL = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.scrollTo = () => {};
      w.print = () => {};
      w.open = () => null;
    }
  });
  return dom.window;
}

/* let / const で宣言された値は window に載らないため、スクリプトの
   スコープで評価して取り出す。オブジェクトは参照が返るので書き換えもできる。 */
const ev = expr => w.eval(expr);
const S = () => w.eval('state');

const click = (w, id) => { const el = w.document.getElementById(id); el.dispatchEvent(new w.Event('click', { bubbles: true })); };
const setVal = (w, id, v) => {
  const el = w.document.getElementById(id);
  el.value = v;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
};
const txt = (w, id) => (w.document.getElementById(id).textContent || '').trim();

let w;
try { w = boot(); }
catch (e) {
  console.log('--- 画面の動作テスト ---');
  console.log('  ✗ 画面を起動できませんでした:', e.message);
  process.exit(1);
}

/* ---------- 起動 ---------- */
section('起動');
{
  t('スクリプトが最後まで走る', typeof S() === 'object' && !!S());
  t('既定のキーマップが読める', Array.isArray(S().layers) && S().layers.length > 0,
    S().layers ? String(S().layers.length) : 'なし');
  t('盤面が描かれる', w.document.querySelectorAll('#board .key').length > 0,
    String(w.document.querySelectorAll('#board .key').length));
  t('レイヤー一覧が描かれる', w.document.querySelectorAll('#layerbar .ltab').length > 0,
    String(w.document.querySelectorAll('#layerbar .ltab').length));
  t('起動時にエラーの警告が出ていない', !(w.__alerts || []).length, (w.__alerts || []).join(' / '));
  t('主要な関数が用意されている',
    ['renderAll', 'save', 'load', 'addGroupFlow', 'copyLayer', 'deleteLayer'].every(f => typeof w[f] === 'function'));
}

/* ---------- Undo / Redo ---------- */
section('Undo / Redo');
{
  const before = S().layers[0].bindings[0];
  S().layers[0].bindings[0] = '&kp Z';
  w.renderAll();
  t('編集が state に入る', S().layers[0].bindings[0] === '&kp Z');

  click(w, 'btn-undo');
  t('Undoで元に戻る', S().layers[0].bindings[0] === before, S().layers[0].bindings[0]);

  click(w, 'btn-redo');
  t('Redoでやり直せる', S().layers[0].bindings[0] === '&kp Z', S().layers[0].bindings[0]);

  click(w, 'btn-undo');
  t('もう一度Undoできる', S().layers[0].bindings[0] === before);

  // 全設定が履歴に乗るか(保存対象の取りこぼしが無いか)
  const snapKeys = Object.keys(JSON.parse(w.snapshotStr()));
  t('履歴に全項目が入る', JSON.stringify(snapKeys) === JSON.stringify(ev('STATE_KEYS')),
    snapKeys.join(','));

  // コンボを足してUndoで消えるか
  const n0 = S().combos.length;
  S().combos.push({ name: 'zz_tmp', binding: '&kp A', keyPositions: [0, 1], layers: [], timeout: 50 });
  w.save();
  click(w, 'btn-undo');
  t('コンボの追加もUndoできる', S().combos.length === n0, `${S().combos.length} vs ${n0}`);
}

/* ---------- 環境の追加ウィザード ---------- */
section('環境の追加ウィザード');
{
  const layers0 = S().layers.length, groups0 = S().groups.length;
  w.addGroupFlow();
  t('ウィザードが開く', w.document.getElementById('addenv-bg').classList.contains('open'));
  t('配列の選択肢に「設定なし」がある',
    [...w.document.getElementById('ae-loc').options].some(o => o.value === ''));
  t('OSの選択肢にiOSがある',
    [...w.document.getElementById('ae-os').options].some(o => o.value === 'ios'));
  t('コピー元に既存の環境が並ぶ', w.document.getElementById('ae-src').options.length === groups0,
    String(w.document.getElementById('ae-src').options.length));

  // 名前を空のまま作ろうとすると断られる
  w.document.getElementById('ae-name').value = '';
  click(w, 'ae-create');
  t('名前が空だと作れない', S().groups.length === groups0);
  t('理由が表示される', txt(w, 'ae-msg').length > 0, txt(w, 'ae-msg'));

  // 既存と同じ名前も断られる
  w.document.getElementById('ae-name').value = S().groups[0].name;
  click(w, 'ae-create');
  t('同じ名前だと作れない', S().groups.length === groups0);

  // JIS環境を作る
  w.document.getElementById('ae-name').value = 'JISTEST';
  setVal(w, 'ae-loc', 'jis');
  setVal(w, 'ae-os', 'win');
  w.document.getElementById('ae-copy').checked = true;
  const srcCount = S().groups[0].count;
  w.document.getElementById('ae-src').value = '0';
  click(w, 'ae-create');

  t('環境が増える', S().groups.length === groups0 + 1, String(S().groups.length));
  t('ウィザードが閉じる', !w.document.getElementById('addenv-bg').classList.contains('open'));
  const g = S().groups[S().groups.length - 1];
  t('名前が入る', g.name === 'JISTEST', g.name);
  t('配列とOSが入る', g.locale === 'jis' && g.platform === 'win', `${g.locale}/${g.platform}`);
  t('コピー元と同じ数のレイヤーができる', g.count === srcCount, `${g.count} vs ${srcCount}`);
  t('レイヤーが実際に増える', S().layers.length === layers0 + srcCount,
    `${S().layers.length} vs ${layers0 + srcCount}`);
  t('結果が画面に表示される', txt(w, 'warnings').includes('JISTEST'), txt(w, 'warnings').slice(0, 60));

  const added = S().layers.slice(layers0);
  t('中身が変換されている',
    JSON.stringify(added.map(l => l.bindings)) !== JSON.stringify(S().layers.slice(0, srcCount).map(l => l.bindings)));
  t('壊れたバインディングがない',
    !/undefined|NaN/.test(added.flatMap(l => l.bindings).join(' ')));
  t('レイヤー参照が有効な範囲',
    added.every(l => l.bindings.every(b => {
      const m = b.trim().match(/^&(?:mo|lt|to|tog|sl|lt_to_layer_0)\s+(\d+)/);
      return !m || (Number(m[1]) >= 0 && Number(m[1]) < S().layers.length);
    })));
}

/* ---------- 環境の設定チップ ---------- */
section('環境の設定');
{
  const gi = S().groups.length - 1;
  const chips = [...w.document.querySelectorAll('#layerbar .envchip')];
  t('設定チップが並ぶ', chips.length === S().groups.length, String(chips.length));
  t('チップに配列とOSが出る', chips[gi].textContent.includes('JIS') && chips[gi].textContent.includes('Windows'),
    chips[gi].textContent);

  chips[gi].dispatchEvent(new w.Event('click', { bubbles: true }));
  t('クリックで設定が開く', w.document.getElementById('envset-bg').classList.contains('open'));
  t('現在の設定が入っている', w.document.getElementById('es-loc').value === 'jis');

  const bindingsBefore = JSON.stringify(S().layers.map(l => l.bindings));
  setVal(w, 'es-loc', 'uk');
  click(w, 'es-save');
  t('設定が変わる', S().groups[gi].locale === 'uk', S().groups[gi].locale);
  t('設定を変えても配置は変わらない',
    JSON.stringify(S().layers.map(l => l.bindings)) === bindingsBefore);
  t('設定が閉じる', !w.document.getElementById('envset-bg').classList.contains('open'));

  // 戻す
  S().groups[gi].locale = 'jis';
  w.renderAll();
}

/* ---------- レイヤーの複製・削除 ---------- */
section('レイヤーの操作');
{
  const n0 = S().layers.length;
  const sum = () => S().groups.reduce((a, g) => a + g.count, 0);
  w.copyLayer(0);
  t('複製でレイヤーが増える', S().layers.length === n0 + 1);
  t('複製後も員数が合う', sum() === S().layers.length, `${sum()} vs ${S().layers.length}`);
  t('複製したレイヤーが選択される', ev('activeLayer') === 1, String(ev('activeLayer')));

  w.__confirmAnswer = true;
  w.deleteLayer(1);
  t('削除でレイヤーが減る', S().layers.length === n0, String(S().layers.length));
  t('削除後も員数が合う', sum() === S().layers.length);

  w.__confirmAnswer = false;
  const n1 = S().layers.length;
  w.deleteLayer(1);
  t('確認で断れば削除されない', S().layers.length === n1);
  w.__confirmAnswer = true;

  // 参照がすべて有効なまま
  t('操作後も参照が有効',
    S().layers.every(l => l.bindings.every(b => {
      const m = b.trim().match(/^&(?:mo|lt|to|tog|sl|lt_to_layer_0)\s+(\d+)/);
      return !m || (Number(m[1]) >= 0 && Number(m[1]) < S().layers.length);
    })));
}

/* ---------- コンボと環境 ---------- */
section('コンボの環境別対応');
{
  S().combos.push({ name: 'dq_test', binding: '&kp LS(SQT)', keyPositions: [20, 21], layers: [], timeout: 50 });
  w.renderCombos();
  const box = w.document.getElementById('combo-envwarn');
  t('環境依存のコンボが知らされる', box.textContent.includes('環境'), box.textContent.slice(0, 60));
  const btn = [...box.querySelectorAll('button')].find(b => b.textContent.includes('環境ごとに分ける'));
  t('分割ボタンが出る', !!btn);
  if (btn) {
    const n0 = S().combos.length;
    btn.dispatchEvent(new w.Event('click', { bubbles: true }));
    t('分割でコンボが増える', S().combos.length > n0, `${S().combos.length} vs ${n0}`);
    t('分割後は警告が消える', !w.document.getElementById('combo-envwarn').textContent.includes('環境ごとに'),
      w.document.getElementById('combo-envwarn').textContent.slice(0, 40));
    t('分割したコンボにlayers指定が入る',
      S().combos.filter(c => c.name.startsWith('dq_test_')).every(c => c.layers && c.layers.length > 0));
  }
}

/* ---------- マクロ等の環境別対応 ---------- */
section('マクロ等の環境別対応');
{
  S().behaviors.morphs.push({ name: 'ui_morph', b1: '&kp SQT', b2: '&kp DQT', mods: ['MOD_LSFT'], keepMods: [] });
  const rs = w.groupRanges(S().groups);
  S().layers[rs[0].start].bindings[5] = '&ui_morph';
  const last = rs[rs.length - 1];
  S().layers[last.start].bindings[5] = '&ui_morph';
  w.renderBehs();
  const box = w.document.getElementById('bm-envwarn');
  t('環境依存の自作定義が知らされる', box.textContent.includes('ui_morph'), box.textContent.slice(0, 80));
  const btn = [...box.querySelectorAll('button')].find(b => b.textContent.includes('環境ごとに分ける'));
  t('分割ボタンが出る', !!btn);
  if (btn) {
    btn.dispatchEvent(new w.Event('click', { bubbles: true }));
    t('定義が複製される', S().behaviors.morphs.some(m => /^ui_morph_/.test(m.name)),
      S().behaviors.morphs.map(m => m.name).join(','));
    t('参照先が差し替わる', /^&ui_morph_/.test(S().layers[last.start].bindings[5]),
      S().layers[last.start].bindings[5]);
    t('基準環境の参照は変わらない', S().layers[rs[0].start].bindings[5] === '&ui_morph');
    t('分割後は警告が消える', !w.document.getElementById('bm-envwarn').textContent.includes('環境ごとに'));
  }
}

/* ---------- 書き出しと読み直し ---------- */
section('書き出し');
{
  const out = w.generateKeymap(S());
  t('.keymap を書き出せる', out.length > 0 && out.includes('keymap'));
  t('書き出しに undefined が混じらない', !/undefined/.test(out.replace(/undefined\s*\{/g, '')),
    (out.match(/\S*undefined\S*/) || [''])[0]);
  const re = w.parseKeymap(out);
  t('読み直せる', !re.error, re.error);
  t('読み直してレイヤー数が一致', re.layers.length === S().layers.length,
    `${re.layers.length} vs ${S().layers.length}`);
  t('読み直して配置が一致',
    JSON.stringify(re.layers.map(l => l.bindings)) === JSON.stringify(S().layers.map(l => l.bindings)));

  const issues = w.runValidation(S(), ev('osTargets'));
  t('整合性チェックが動く', Array.isArray(issues));
  t('存在しない参照は残っていない', !issues.some(x => x.includes('存在しないレイヤー')),
    issues.filter(x => x.includes('存在しない')).join(' / '));
  t('未定義のビヘイビアは残っていない', !issues.some(x => x.includes('未定義のビヘイビア')),
    issues.filter(x => x.includes('未定義')).join(' / '));
}

/* ---------- ブラウザ保存とバックアップ ---------- */
section('保存と復元');
{
  const snap = w.snapshotStr();
  const stored = w.localStorage.getItem('roba_keymap_state_v4');
  t('ブラウザに保存されている', !!stored);
  if (stored) {
    const o = JSON.parse(stored);
    t('保存内容に全項目が入る', ev('STATE_KEYS').every(k => k in o), ev('STATE_KEYS').filter(k => !(k in o)).join(','));
    t('選択中のレイヤーも保存される', 'activeLayer' in o);
  }
  // 復元して同じ状態に戻る
  const layersBefore = JSON.stringify(S().layers);
  S().layers[0].bindings[0] = '&kp Q';
  w.applySnapshot(snap);
  t('スナップショットから戻せる', JSON.stringify(S().layers) === layersBefore);
  t('戻したあとも画面が描ける', w.document.querySelectorAll('#board .key').length > 0);
}

/* ---------- 表示言語 ---------- */
section('表示言語');
{
  const jp = txt(w, 'btn-export');
  w.setLang('en'); w.applyLang();
  const en = txt(w, 'btn-export');
  t('英語に切り替わる', en !== jp && !/[ぁ-んァ-ン一-龥]/.test(en), `${jp} → ${en}`);
  w.setLang('ja'); w.applyLang();
  t('日本語に戻る', txt(w, 'btn-export') === jp, txt(w, 'btn-export'));
}

/* ---------- ダイアログの開閉 ---------- */
section('ダイアログ');
{
  const dialogs = ['combo-bg', 'morph-bg', 'td-bg', 'macro-bg', 'cl-bg', 'ht-bg',
    'tune-bg', 'tb-bg', 'gh-bg', 'kb-bg', 'ktest-bg', 'order-bg', 'os-bg', 'plat-bg', 'sw-bg'];
  dialogs.forEach(id => {
    const el = w.document.getElementById(id);
    if (!el) { t('ダイアログがある: ' + id, false); return; }
    const errs = [];
    const onerr = e => errs.push(e.message);
    w.addEventListener('error', onerr);
    el.classList.add('open');
    w.closeModal(id);
    w.removeEventListener('error', onerr);
    t('開閉できる: ' + id, !el.classList.contains('open') && errs.length === 0, errs.join(' / '));
  });
  t('起動から通してエラーの警告が出ていない', !(w.__alerts || []).length, (w.__alerts || []).join(' / '));
}

console.log(`\n画面の動作テスト: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
