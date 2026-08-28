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

/* ---------- 利用環境の追加ウィザード ---------- */
section('利用環境の追加ウィザード');
{
  const layers0 = S().layers.length, groups0 = S().groups.length;
  w.addGroupFlow();
  t('ウィザードが開く', w.document.getElementById('addenv-bg').classList.contains('open'));
  t('配列の選択肢に「設定なし」がある',
    [...w.document.getElementById('ae-loc').options].some(o => o.value === ''));
  t('OSの選択肢にiOSがある',
    [...w.document.getElementById('ae-os').options].some(o => o.value === 'ios'));
  t('コピー元に既存の利用環境が並ぶ', w.document.getElementById('ae-src').options.length === groups0,
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

  // JIS利用環境を作る
  w.document.getElementById('ae-name').value = 'JISTEST';
  setVal(w, 'ae-loc', 'jis');
  setVal(w, 'ae-os', 'win');
  w.document.getElementById('ae-copy').checked = true;
  const srcCount = S().groups[0].count;
  w.document.getElementById('ae-src').value = '0';
  click(w, 'ae-create');

  t('利用環境が増える', S().groups.length === groups0 + 1, String(S().groups.length));
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

/* ---------- 利用環境の設定チップ ---------- */
section('利用環境の設定');
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

/* ---------- コンボと利用環境 ---------- */
section('コンボの利用環境別対応');
{
  // 既定のキーマップは素直な2レイヤーなので、基準側の配列を明示しておく
  S().groups[0].locale = 'us';
  S().groups[0].platform = 'win';
  w.renderAll();
  S().combos.push({ name: 'dq_test', binding: '&kp LS(SQT)', keyPositions: [20, 21], layers: [], timeout: 50 });
  w.renderCombos();
  const box = w.document.getElementById('combo-envwarn');
  t('利用環境依存のコンボが知らされる', box.textContent.includes('利用環境'), box.textContent.slice(0, 60));
  const btn = [...box.querySelectorAll('button')].find(b => b.textContent.includes('利用環境ごとに分ける'));
  t('分割ボタンが出る', !!btn);
  if (btn) {
    const n0 = S().combos.length;
    btn.dispatchEvent(new w.Event('click', { bubbles: true }));
    t('分割でコンボが増える', S().combos.length > n0, `${S().combos.length} vs ${n0}`);
    t('分割後は警告が消える', !w.document.getElementById('combo-envwarn').textContent.includes('利用環境ごとに'),
      w.document.getElementById('combo-envwarn').textContent.slice(0, 40));
    t('分割したコンボにlayers指定が入る',
      S().combos.filter(c => c.name.startsWith('dq_test_')).every(c => c.layers && c.layers.length > 0));
  }
}

/* ---------- マクロ等の利用環境別対応 ---------- */
section('マクロ等の利用環境別対応');
{
  S().behaviors.morphs.push({ name: 'ui_morph', b1: '&kp SQT', b2: '&kp DQT', mods: ['MOD_LSFT'], keepMods: [] });
  const rs = w.groupRanges(S().groups);
  S().layers[rs[0].start].bindings[5] = '&ui_morph';
  const last = rs[rs.length - 1];
  S().layers[last.start].bindings[5] = '&ui_morph';
  w.renderBehs();
  const box = w.document.getElementById('bm-envwarn');
  t('利用環境依存の自作定義が知らされる', box.textContent.includes('ui_morph'), box.textContent.slice(0, 80));
  const btn = [...box.querySelectorAll('button')].find(b => b.textContent.includes('利用環境ごとに分ける'));
  t('分割ボタンが出る', !!btn);
  if (btn) {
    btn.dispatchEvent(new w.Event('click', { bubbles: true }));
    t('定義が複製される', S().behaviors.morphs.some(m => /^ui_morph_/.test(m.name)),
      S().behaviors.morphs.map(m => m.name).join(','));
    t('参照先が差し替わる', /^&ui_morph_/.test(S().layers[last.start].bindings[5]),
      S().layers[last.start].bindings[5]);
    t('基準利用環境の参照は変わらない', S().layers[rs[0].start].bindings[5] === '&ui_morph');
    t('分割後は警告が消える', !w.document.getElementById('bm-envwarn').textContent.includes('利用環境ごとに'));
  }
}

/* ---------- OSに合わせたキー表示 ---------- */
section('OS別のキー表示');
{
  const st = S();
  const rs = w.groupRanges(st.groups);
  const set = ['&kp LALT', '&kp LGUI', '&kp LCTRL', '&kp LC(C)', '&kp LC(LS(T))',
    '&kp DEL', '&kp LS(N2)', '&kp A', '&kp LC(T)'];
  // 先頭の利用環境をWindows、末尾の利用環境をmacOSにして見比べる
  // OSの違いだけを見たいので、配列は両方そろえる
  const first = 0, last = rs.length - 1;
  st.groups[first].locale = 'us'; st.groups[first].platform = 'win';
  st.groups[last].locale = 'us';  st.groups[last].platform = 'mac';
  [rs[first].start, rs[last].start].forEach(li => {
    set.forEach((b, i) => { if (i < st.layers[li].bindings.length) st.layers[li].bindings[i] = b; });
  });
  const read = () => [...w.document.querySelectorAll('#board .key')]
    .slice(0, set.length).map(k => k.textContent.trim());

  w.eval('activeLayer=' + rs[first].start); w.renderAll();
  const winFace = read();
  w.eval('activeLayer=' + rs[last].start); w.renderAll();
  const macFace = read();

  t('Windows利用環境では Alt と出る', winFace[0] === 'Alt', winFace[0]);
  t('macOS利用環境では ⌥ と出る', macFace[0] === '⌥', macFace[0]);
  t('Windows利用環境では Win と出る', winFace[1] === 'Win', winFace[1]);
  t('macOS利用環境では ⌘ と出る', macFace[1] === '⌘', macFace[1]);
  t('Ctrl の表示も変わる', winFace[2] === 'Ctrl' && macFace[2] === '⌃', winFace[2] + ' / ' + macFace[2]);
  t('修飾ラッパの表示も変わる', winFace[3] === '^C' && macFace[3] === '⌃C', winFace[3] + ' / ' + macFace[3]);
  t('Del の表示も変わる', winFace[5] === 'Del' && macFace[5] === '⌦', winFace[5] + ' / ' + macFace[5]);
  t('記号は配列で決まるので変わらない', winFace[6] === macFace[6], winFace[6] + ' / ' + macFace[6]);
  t('文字キーは変わらない', winFace[7] === macFace[7]);
  t('Ctrl+Shift+T と Ctrl+T が区別できる', winFace[4] !== winFace[8], winFace[4] + ' vs ' + winFace[8]);

  // 表示を変えても書き出しは同じ
  const out1 = w.generateKeymap(st);
  st.groups[last].platform = 'win'; w.renderAll();
  const out2 = w.generateKeymap(st);
  t('表示が変わっても .keymap は同じ', out1 === out2);
  t('OSを戻すと表示も戻る',
    [...w.document.querySelectorAll('#board .key')][0].textContent.trim() === 'Alt',
    [...w.document.querySelectorAll('#board .key')][0].textContent.trim());

  // OS未設定なら Windows と同じ表記
  st.groups[last].platform = null; w.renderAll();
  t('OS未設定はWindowsと同じ表記',
    [...w.document.querySelectorAll('#board .key')][0].textContent.trim() === 'Alt');
}

/* ---------- 内蔵キーボード ---------- */
section('内蔵キーボード');
{
  w.renderKbModal();
  const rows = [...w.document.querySelectorAll('#kb-list .listrow')];
  const builtins = ev('BUILTIN_PROFILES');
  t('一覧に内蔵プロファイルが並ぶ', rows.length >= builtins.length,
    `${rows.length} vs ${builtins.length}`);
  t('roBa以外も出る', rows.some(r => r.textContent.includes('Corne')),
    rows.map(r => r.textContent.slice(0, 10)).join(' / '));
  const corne = rows.find(r => r.textContent.includes('Corne (6列)'));
  t('Corneの行がある', !!corne);
  t('キー数が表示される', corne.textContent.includes('42'), corne.textContent.slice(0, 30));
  t('補足が表示される', corne.textContent.includes('crkbd'), corne.textContent.slice(0, 40));
  t('既定のHHKBが先頭', rows[0].textContent.includes('HHKB'), rows[0].textContent.slice(0, 20));

  // 別のキーボードで新規作成して、そのまま書き出せるか
  const before = ev('state.keyboard.id');
  const target = builtins.find(p => p.id === 'lily58');
  w.newDocWith(target);
  t('キーボードを切り替えられる', ev('state.keyboard.id') === 'lily58', ev('state.keyboard.id'));
  t('盤面のキー数が合う', w.document.querySelectorAll('#board .key').length === 58,
    String(w.document.querySelectorAll('#board .key').length));
  t('レイヤーのキー数も合う', ev('state.layers[0].bindings.length') === 58);
  S().layers[0].bindings[0] = '&kp A';
  const out = w.generateKeymap(S());
  t('切り替え後も書き出せる', out.includes('&kp A'));
  t('書き出しを読み直せる', w.parseKeymap(out).layers[0].bindings.length === 58);
  t('切り替えでエラーが出ない', !(w.__alerts || []).length, (w.__alerts || []).join(' / '));

  // 元に戻す(後続のテストに影響させない)
  w.newDocWith(builtins.find(p => p.id === before) || builtins[0]);
  t('元のキーボードに戻せる', ev('state.keyboard.id') === before, ev('state.keyboard.id'));
}

/* ---------- レイアウトの取り込み ---------- */
section('レイアウトの取り込み');
{
  // 通信はせず、取得後の描画と追加だけを確かめる
  const found = [
    { path: 'app/dts/layouts/x/tkl.dtsi', node: 'tkl', name: 'TKL 87 Key ANSI', keyCount: 3,
      keys: [[100,100,0,0,0,0,0],[100,100,100,0,0,0,0],[200,100,200,0,0,0,0]] },
    { path: 'app/dts/layouts/x/pad.dtsi', node: 'pad', name: '17 Key Numpad', keyCount: 2,
      keys: [[100,100,0,0,0,0,0],[100,200,100,0,0,0,0]] }
  ];
  w.renderKbFound(found, 5);
  const box = w.document.getElementById('kb-repo-result');
  t('見つかった数が出る', box.textContent.includes('2 件'), box.textContent.slice(0, 40));
  t('調べ残しも知らせる', box.textContent.includes('5 件'), box.textContent.slice(0, 60));
  const rows = [...box.querySelectorAll('.listrow')];
  t('一覧に並ぶ', rows.length === 2, String(rows.length));
  t('名前が出る', rows[0].textContent.includes('TKL 87 Key ANSI'));
  t('キー数が出る', rows[0].textContent.includes('3キー'));
  t('取得元のパスが出る', rows[0].textContent.includes('tkl.dtsi'));

  const n0 = w.kbLibLoad().length;
  [...rows[0].querySelectorAll('button')].find(b => b.textContent === '追加')
    .dispatchEvent(new w.Event('click', { bubbles: true }));
  const lib = w.kbLibLoad();
  t('追加できる', lib.length === n0 + 1, `${lib.length} vs ${n0 + 1}`);
  const added = lib[lib.length - 1];
  t('名前と座標が入る', added.name === 'TKL 87 Key ANSI' && added.keys.length === 3, added.name);
  t('行構成が導かれる', Array.isArray(added.rows) && added.rows.length > 0);
  t('1U以外の幅も保たれる', added.keys[2][0] === 200, String(added.keys[2][0]));
  t('一覧に反映される',
    [...w.document.querySelectorAll('#kb-list .listrow')].some(r => r.textContent.includes('TKL 87 Key ANSI')));

  // 同じものをもう一度追加しても名前がぶつからない
  w.renderKbFound(found, 0);
  [...w.document.querySelectorAll('#kb-repo-result .listrow')][0]
    .querySelector('button').dispatchEvent(new w.Event('click', { bubbles: true }));
  const lib2 = w.kbLibLoad();
  t('重ねて追加しても名前が重複しない',
    new Set(lib2.map(x => x.name)).size === lib2.length, lib2.map(x => x.name).join(','));
  t('idも重複しない', new Set(lib2.map(x => x.id)).size === lib2.length);
  t('エラーが出ない', !(w.__alerts || []).length, (w.__alerts || []).join(' / '));
}

/* ---------- キーの大きさの編集 ---------- */
section('キーの大きさの編集');
{
  const hh = ev('BUILTIN_PROFILES')[0];
  w.openKbEditor(hh);
  t('編集画面が開く', w.document.getElementById('kbedit-bg').classList.contains('open'));
  const keys = [...w.document.querySelectorAll('#kbe-board .mkey')];
  t('盤面が描かれる', keys.length === hh.keyCount, `${keys.length} vs ${hh.keyCount}`);
  t('選択前は入力が使えない', w.document.getElementById('kbe-w').disabled);

  keys[1].dispatchEvent(new w.Event('click', { bubbles: true }));
  t('クリックで選べる', txt(w, 'kbe-sel') === 'pos 1', txt(w, 'kbe-sel'));
  t('今の幅が入る', w.document.getElementById('kbe-w').value === '1', w.document.getElementById('kbe-w').value);

  const preset = [...w.document.querySelectorAll('.kbe-preset')].find(e => e.dataset.w === '2.25');
  preset.dispatchEvent(new w.Event('click', { bubbles: true }));
  t('よく使う幅を押すと反映される', w.document.getElementById('kbe-w').value === '2.25');
  t('重なりが出ない(後ろがずれる)', txt(w, 'kbe-warn') === '', txt(w, 'kbe-warn').slice(0, 40));

  const libBefore = w.kbLibLoad().length;
  const bindingsBefore = JSON.stringify(S().layers.map(l => l.bindings));
  w.document.getElementById('kbe-save').dispatchEvent(new w.Event('click', { bubbles: true }));
  const lib = w.kbLibLoad();
  t('複製として保存される', lib.length === libBefore + 1, `${lib.length} vs ${libBefore + 1}`);
  t('保存した幅が残る', lib[lib.length - 1].keys[1][0] === 225, String(lib[lib.length - 1].keys[1][0]));
  t('内蔵プロファイルは変わらない', ev('BUILTIN_PROFILES')[0].keys[1][0] === 100);
  t('キーの割り当ては変わらない',
    JSON.stringify(S().layers.map(l => l.bindings)) === bindingsBefore);
  t('編集画面が閉じる', !w.document.getElementById('kbedit-bg').classList.contains('open'));

  // 自分のプロファイルを編集する場合は、複製せずその場で書き換わる
  {
    const mine = lib[lib.length - 1];
    const n0 = w.kbLibLoad().length;
    w.openKbEditor(mine);
    [...w.document.querySelectorAll('#kbe-board .mkey')][2]
      .dispatchEvent(new w.Event('click', { bubbles: true }));
    const p15 = [...w.document.querySelectorAll('.kbe-preset')].find(e => e.dataset.w === '1.5');
    p15.dispatchEvent(new w.Event('click', { bubbles: true }));
    w.document.getElementById('kbe-save').dispatchEvent(new w.Event('click', { bubbles: true }));
    const after = w.kbLibLoad();
    t('自分のものは複製されない', after.length === n0, `${after.length} vs ${n0}`);
    t('その場で書き換わる', after[after.length - 1].keys[2][0] === 150,
      String(after[after.length - 1].keys[2][0]));
    t('前回の編集も残っている', after[after.length - 1].keys[1][0] === 225,
      String(after[after.length - 1].keys[1][0]));
  }
  t('エラーが出ない', !(w.__alerts || []).length, (w.__alerts || []).join(' / '));
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
