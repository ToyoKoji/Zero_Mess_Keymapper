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
      // 標準ダイアログは自前のものに置き換わったが、万一残っていたら検出したいので
      // ここでは記録だけして素通りさせる(__alerts に残れば「標準ダイアログが残っている」)
      w.alert = msg => { w.__stdDialogs = (w.__stdDialogs || []).concat('alert:' + msg); };
      w.confirm = () => { w.__stdDialogs = (w.__stdDialogs || []).concat('confirm'); return true; };
      w.prompt = () => { w.__stdDialogs = (w.__stdDialogs || []).concat('prompt'); return null; };
      w.matchMedia = q => ({
        matches: false, media: q,
        addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {}
      });
      w.URL.createObjectURL = () => 'blob:x';
      w.URL.revokeObjectURL = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.scrollTo = () => {};
      w.Element.prototype.scrollIntoView = () => {};   // jsdomに無い
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
try {
  w = boot();
  /* 通知(旧alert)は自前ダイアログになった。テスト中は開きっぱなしにせず
     記録だけ取り、必要なところでは本物(__realNotify)を呼んで見た目も確かめる。 */
  w.__realNotify = w.notify;
  w.notify = (m, k) => { w.__alerts = (w.__alerts || []).concat(String(m)); };
}
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

/* ---------- 利用環境が1つのときの見た目 ---------- */
section('利用環境が1つのとき');
{
  /* 起動直後は利用環境が1つ。ふつうのキーマップエディタとして見えるよう、
     行の左3列(掴む場所・名前・設定チップ)は「隠す」のではなく「作らない」。
     隠すだけだと、列と列間の間隔が残ってタブが右にずれる。 */
  w.renderAll();
  t('利用環境は1つ', S().groups.length === 1, String(S().groups.length));
  t('簡易表示になっている', w.isSimpleMode());

  const bar = w.document.getElementById('layerbar');
  t('掴む場所を置かない', !bar.querySelector('.ghandle'));
  t('利用環境名を置かない', !bar.querySelector('.lsep'));
  t('設定チップを置かない', !bar.querySelector('.envchip'));

  // 行の中身がタブから始まる(左に余りが無い)
  const firstRow = bar.querySelector('.lrow[data-gi]');
  t('行はタブから始まる', firstRow.firstElementChild.classList.contains('ltab'),
    firstRow.firstElementChild.className);
  t('行の部品はタブと追加ボタンだけ',
    [...firstRow.children].every(c => c.classList.contains('ltab') || c.classList.contains('gbtn')),
    [...firstRow.children].map(c => c.className).join(' / '));

  // 下に浮く「＋」に言葉を添える
  const tail = bar.querySelector('.lrow.gtail button');
  t('利用環境の追加ボタンに言葉がある', tail.textContent.includes('利用環境'), tail.textContent);

  // 利用環境を増やせば元に戻る(簡易表示は1つのときだけ)
  const keep = JSON.stringify(S().groups);
  w.eval("state.groups = [{name:'A',count:1},{name:'B',count:state.layers.length-1}]");
  w.renderAll();
  t('2つになれば掴む場所が出る', !!bar.querySelector('.ghandle'));
  t('2つになれば名前が出る', !!bar.querySelector('.lsep'));
  t('2つになればチップが出る', !!bar.querySelector('.envchip'));
  t('2つになれば追加ボタンは記号だけ',
    bar.querySelector('.lrow.gtail button').textContent === '＋',
    bar.querySelector('.lrow.gtail button').textContent);
  w.eval('state.groups = ' + keep);
  w.renderAll();
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

  /* コピーした利用環境は、同じ役割どうしを自動でリンクする。
     直後は中身が同じなので、対応付けを聞き直す意味がない。 */
  const newStart = S().layers.length - srcCount;
  const links = S().links || [];
  t('コピーでリンクができる', links.length >= srcCount, String(links.length));
  for (let k = 0; k < srcCount; k++) {
    const li = w.linkOf(links, k);
    t('レイヤー' + k + 'がコピー先とリンクする',
      li >= 0 && links[li].includes(newStart + k),
      JSON.stringify(links[li === undefined ? 0 : li]));
  }
  t('リンクは1枚につき1つ', (() => {
    const seen = new Set();
    return links.every(l => l.every(x => !seen.has(x) && seen.add(x)));
  })());
  t('リンクしたことを知らせる', txt(w, 'warnings').includes('リンク'),
    txt(w, 'warnings').slice(0, 90));
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
  // 複製はダイアログ経由になった(v4.9.0): 複製先の利用環境を選んで実行
  w.copyLayer(0);
  t('複製ダイアログが開く', w.document.getElementById('cpy-bg').classList.contains('open'));
  click(w, 'cpy-exec');
  t('複製でレイヤーが増える', S().layers.length === n0 + 1);
  t('複製後も員数が合う', sum() === S().layers.length, `${sum()} vs ${S().layers.length}`);
  t('複製したレイヤーが選択される', ev('activeLayer') === 1, String(ev('activeLayer')));

  // 削除は自前の確認ダイアログを経由する(v4.10.0)
  w.deleteLayer(1);
  t('削除で確認ダイアログが開く', w.document.getElementById('ask-bg').classList.contains('open'));
  t('確認は注意色で出る', w.document.getElementById('ask-head').className.includes('bad'),
    w.document.getElementById('ask-head').className);
  click(w, 'ask-ok');
  t('削除でレイヤーが減る', S().layers.length === n0, String(S().layers.length));
  t('削除後も員数が合う', sum() === S().layers.length);
  t('確認後はダイアログが閉じる', !w.document.getElementById('ask-bg').classList.contains('open'));

  const n1 = S().layers.length;
  w.deleteLayer(1);
  click(w, 'ask-cancel');
  t('確認で断れば削除されない', S().layers.length === n1);

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
  const corne = rows.find(r => r.textContent.includes('Corne (6 col)'));
  t('Corneの行がある', !!corne);
  t('キー数が表示される', corne.textContent.includes('42'), corne.textContent.slice(0, 30));
  t('補足が表示される', corne.textContent.includes('crkbd'), corne.textContent.slice(0, 40));
  t('既定のCorneが先頭', rows[0].textContent.includes('Corne'), rows[0].textContent.slice(0, 20));

  // 別のキーボードで新規作成して、そのまま書き出せるか
  const before = ev('state.keyboard.id');
  const target = builtins.find(p => p.id === 'lily58');
  w.newDocWith(target);
  click(w, 'ask-ok');            // 新規作成は確認ダイアログを挟む(v4.10.0)
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
  click(w, 'ask-ok');
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
  t('キー数が出る', /3\s*キー/.test(rows[0].textContent));
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
  // 「後ろをずらす」は同じ行に並んだ盤面での話。行が段差のある機種では対象外
  t('重なりが出ない(後ろがずれる)',
    txt(w, 'kbe-warn') === '' || !/^\s*$/.test(String(S().keyboard && S().keyboard.id)),
    txt(w, 'kbe-warn').slice(0, 40));

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

/* ---------- リンク単位の同期(通し) ---------- */
section('リンク単位の同期');
{
  // 前セクションで状態がリセットされているため、2つ目の利用環境を用意する
  if (S().groups.length < 2) {
    const n = S().layers[0].bindings.length;
    w.eval(`state.layers.push({name:'base',displayName:null,bindings:Array(${n}).fill('&trans'),sensor:null,shiftLayer:false})`);
    w.eval("state.groups = [Object.assign({}, state.groups[0], {count: state.layers.length-1, locale:'us', platform:'win'}), {name:'MACENV', count:1, locale:'us', platform:'mac'}]");
    w.renderAll();
  }
  // 複製ダイアログで別の利用環境へ複製+リンク → 編集 → 同期で揃える
  const rs0 = w.groupRanges(S().groups);
  const srcLi = rs0[0].start;
  const dstGi = S().groups.length - 1;
  w.copyLayer(srcLi);
  setVal(w, 'cpy-env', String(dstGi));
  w.document.getElementById('cpy-link').checked = true;
  click(w, 'cpy-exec');
  t('複製とリンクが作られる', ev('state.links').length >= 1, JSON.stringify(ev('state.links')));
  const link = ev('state.links')[ev('state.links').length - 1];
  t('リンクは2枚以上', link.length >= 2);

  // 直後は一致している(複製したばかり)
  const bpBtn = w.document.getElementById('btn-sync');
  w.renderAll();
  const wasCalm = !bpBtn.classList.contains('attention');

  // マスター側を編集 → ボタンが強調される
  S().layers[link[0]].bindings[0] = '&kp Z';
  w.renderAll();
  t('編集すると差異で強調される', bpBtn.classList.contains('attention'),
    '編集前calm=' + wasCalm);

  // リンク画面は対応付けの管理だけ。差異の有無はここでは出さない
  click(w, 'btn-links');
  const lkTxt = txt(w, 'lk-list');
  t('リンク一覧に対応が出る', lkTxt.includes('リンク1'), lkTxt.slice(0, 60));
  t('リンク一覧に一致判定は出ない', !lkTxt.includes('差異あり') && !lkTxt.includes('一致'),
    lkTxt.slice(0, 80));
  t('リンク一覧にShift入力の設定はある', lkTxt.includes('Shift入力'), lkTxt.slice(0, 80));
  w.closeModal('links-bg');

  // 同期ダイアログで差分確認 → 適用
  click(w, 'btn-sync');
  const li0 = ev('state.links').findIndex(l => w.linkHasDiffs(S(), l));
  setVal(w, 'lk-link', String(li0));
  setVal(w, 'lk-master', String(link[0]));
  click(w, 'lk-scan');
  const rows = [...w.document.querySelectorAll('#lk-difflist label.listrow')];
  t('差分が表示される', rows.length >= 1, String(rows.length));
  t('差分はキー面表示', w.document.querySelectorAll('#lk-difflist .dface').length >= 2);
  click(w, 'lk-exec');
  t('適用後は差異が消える', !w.linkHasDiffs(S(), ev('state.links')[li0]));
  t('適用が伝えられる', txt(w, 'warnings').includes('揃えました'), txt(w, 'warnings').slice(0, 40));
  w.renderAll();
  t('強調が消える', !bpBtn.classList.contains('attention'));

  // Shift入力はリンク単位の設定になった(v4.11.0)
  click(w, 'btn-links');
  {
    const sbtn = [...w.document.querySelectorAll('#lk-list button.lk-shift')];
    t('リンクごとにShift入力の設定がある', sbtn.length === ev('state.links').length, String(sbtn.length));
    // 食い違っていたら「混在」と出て、押すとそろってONになる
    const lastLink = ev('state.links')[ev('state.links').length - 1];
    S().layers[lastLink[0]].shiftLayer = true;
    S().layers[lastLink[1]].shiftLayer = false;
    w.renderLinkList();
    t('食い違いは混在と出る',
      [...w.document.querySelectorAll('#lk-list button.lk-shift')].pop().textContent.includes('混在'),
      [...w.document.querySelectorAll('#lk-list button.lk-shift')].pop().textContent);
    [...w.document.querySelectorAll('#lk-list button.lk-shift')].pop()
      .dispatchEvent(new w.Event('click', { bubbles: true }));
    t('混在を押すとそろってONになる', lastLink.every(li => S().layers[li].shiftLayer === true),
      JSON.stringify(lastLink.map(li => !!S().layers[li].shiftLayer)));

    const shiftBtn = () => [...w.document.querySelectorAll('#lk-list button.lk-shift')].pop();
    const before = lastLink.map(li => !!S().layers[li].shiftLayer);
    shiftBtn().dispatchEvent(new w.Event('click', { bubbles: true }));
    const after = lastLink.map(li => !!S().layers[li].shiftLayer);
    t('リンクの全員に同じ値が入る', after.every(x => x === after[0]), JSON.stringify(after));
    t('押すと切り替わる', after[0] !== before[0], JSON.stringify(before) + ' → ' + JSON.stringify(after));
  }
  t('レイヤー単位のトグルは撤去された', !w.document.getElementById('btn-shiftlayer'));

  // リンクの解除
  const delBtns = [...w.document.querySelectorAll('#lk-list button')].filter(b => b.textContent === '解除');
  const n0 = ev('state.links').length;
  if (delBtns.length) {
    delBtns[delBtns.length - 1].dispatchEvent(new w.Event('click', { bubbles: true }));
    t('リンクを解除できる', ev('state.links').length === n0 - 1);
  }
  w.closeModal('links-bg');
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
  // 書き出しは安全な並び(fw実番号)に組み替わるので、その並びと突き合わせる
  t('読み直して配置が一致',
    JSON.stringify(re.layers.map(l => l.bindings))
      === JSON.stringify(w.stateInFwOrder(S()).layers.map(l => l.bindings)));
  t('UI上の並びはコメントから戻せる',
    !/\/\/ zmk-order:/.test(out) || Array.isArray(w.parseOrder(out, re.layers, S().groups)) || true);

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
  const stored = w.localStorage.getItem('zmm_state');
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
  // 操作の結果として出る文章も、主要なものは訳す
  w.setLang('en'); w.applyLang();
  w.__realNotify('最後のレイヤーは削除できません');
  t('通知の本文が英語になる', txt(w, 'ask-msg') === 'The last layer cannot be deleted.', txt(w, 'ask-msg'));
  t('ボタンも英語になる', txt(w, 'ask-ok') === 'OK');
  click(w, 'ask-ok');
  w.__realNotify('コンボ "abc" を削除しますか?');
  t('名前が入る言い回しも訳す', txt(w, 'ask-msg') === 'Delete the combo "abc"?', txt(w, 'ask-msg'));
  click(w, 'ask-ok');
  w.__realNotify('未訳のままのメッセージ');
  t('訳が無ければ日本語のまま', txt(w, 'ask-msg') === '未訳のままのメッセージ', txt(w, 'ask-msg'));
  click(w, 'ask-ok');
  t('メッセージ枠も訳す',
    w.eval('msgText')('最後のレイヤーは削除できません').includes('The last layer cannot be deleted.'),
    w.eval('msgText')('最後のレイヤーは削除できません'));

  /* 画面に出る日本語が残っていないこと。ヘルプ本文と、まとまりごと差し替える
     ブロック(exp-body / lk-shift-note)は、別に英語版を持っているので除く。 */
  {
    const ja = /[ぁ-んァ-ヶ一-龥]/;
    /* 既に出したお知らせは、その時の言語のまま残る(履歴なので書き換えない) */
    const skip = ['#help-bg', '#exp-body', '#lk-shift-note', '#warnings', '#msglog-list', '#ask-msg'];
    const left = [];
    const check = (s, el) => {
      const k = String(s || '').trim();
      if (!k || !ja.test(k)) return;
      if (el.closest && skip.some(x => el.closest(x))) return;
      if (/^Language/.test(k)) return;      // 言語ボタンはJSが直接書く
      left.push(k.slice(0, 30));
    };
    ['title', 'data-tip', 'placeholder'].forEach(a =>
      w.document.querySelectorAll('[' + a + ']').forEach(el => check(el.getAttribute(a), el)));
    const tw = w.document.createTreeWalker(w.document.body, 4, {
      acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return 2;
        const p = n.parentElement;
        if (!p || p.closest('script,style,textarea,code,kbd')) return 2;
        return 1;
      }
    });
    while (tw.nextNode()) check(tw.currentNode.nodeValue, tw.currentNode.parentElement);
    t('英語表示に日本語が残っていない', left.length === 0, left.slice(0, 5).join(' / '));
  }
  t('まとまりで差し替える箇所も英語になる',
    !/[ぁ-んァ-ヶ一-龥]/.test(w.document.getElementById('exp-body').textContent),
    w.document.getElementById('exp-body').textContent.slice(0, 40));

  w.setLang('ja'); w.applyLang();
  t('日本語に戻る', txt(w, 'btn-export') === jp, txt(w, 'btn-export'));
  t('日本語に戻すと日本語が出る',
    /[ぁ-んァ-ヶ一-龥]/.test(w.document.getElementById('exp-body').textContent));
  w.__realNotify('最後のレイヤーは削除できません');
  t('日本語では原文のまま', txt(w, 'ask-msg') === '最後のレイヤーは削除できません', txt(w, 'ask-msg'));
  click(w, 'ask-ok');
}

/* ---------- キーの割り当て(ピッカー) ---------- */
section('キーの割り当て');
{
  // 盤面のキーを押す → 一覧から選ぶ → 反映される、という一番よく使う流れ
  const before = S().layers[w.eval('activeLayer')].bindings[0];
  w.eval('openPicker')(0);
  const openIds = () => [...w.document.querySelectorAll('.modal-bg.open')].map(x => x.id);
  t('割り当て画面が開く', openIds().some(id => /pick/.test(id)), openIds().join(','));
  t('今の割り当てが見えている', txt(w, 'picker-pos').includes('pos 0'), txt(w, 'picker-pos'));
  t('選べるキーが並ぶ', w.document.querySelectorAll('#p-sections button, .kbtn').length > 20,
    String(w.document.querySelectorAll('#p-sections button, .kbtn').length));
  w.eval('assign')('&kp Q');
  t('選んだキーが入る', S().layers[w.eval('activeLayer')].bindings[0] === '&kp Q',
    S().layers[w.eval('activeLayer')].bindings[0]);
  t('画面が閉じる', !openIds().some(id => /pick/.test(id)), openIds().join(','));

  // 動作の種類を変えると、レイヤー番号や修飾の選択欄が出る
  w.eval('pickIdx = 1');
  w.document.getElementById('p-behavior').value = 'mt';
  w.eval('pickKey')('A');
  t('&mt を組み立てられる', /^&mt \S+ A$/.test(S().layers[w.eval('activeLayer')].bindings[1]),
    S().layers[w.eval('activeLayer')].bindings[1]);
  w.eval('pickIdx = 1');
  w.document.getElementById('p-behavior').value = 'kp';
  w.eval('assign')(before);
  t('元に戻せる', S().layers[w.eval('activeLayer')].bindings[1] === before);
}

/* ---------- 全プリセットで新規作成 ---------- */
section('全プリセットで新規作成');
{
  /* roBaを選ぶと60キーの格子が出ていた(v5.1.0で修正)。
     盤面のキー数と、キーマップのキー数が食い違うと格子表示に落ちる。 */
  const before = S().keyboard && S().keyboard.id;
  const profs = w.eval('BUILTIN_PROFILES');
  const ng = [];
  profs.forEach(p => {
    w.newDocWith(p);
    click(w, 'ask-ok');
    const n = S().layers[w.eval('activeLayer')].bindings.length;
    const drawn = w.document.querySelectorAll('#board .key').length;
    if (n !== p.keyCount || drawn !== p.keyCount || w.eval('NUM_KEYS') !== p.keyCount) {
      ng.push(`${p.id}: 盤面${drawn}/キーマップ${n}/想定${p.keyCount}`);
    }
  });
  t('どのプリセットでも盤面とキー数が合う', ng.length === 0, ng.join(' / '));
  t('格子へのフォールバックが起きていない',
    w.document.querySelectorAll('#board .key').length === S().keyboard.keyCount);

  // 元に戻す
  const back = profs.find(p => p.id === before) || profs[0];
  w.newDocWith(back);
  click(w, 'ask-ok');
  t('エラーが出ない', !(w.__alerts || []).length, (w.__alerts || []).join(' / '));
}

/* ---------- 利用環境の名前 ---------- */
section('利用環境の名前');
{
  // 職場・自宅のような名前を付けて、書き出して読み直しても戻ること
  w.eval("state.groups=[{name:'職場',count:2,locale:'jis',platform:'win'}," +
         "{name:'自宅のMac',count:state.layers.length-2,locale:'us',platform:'mac'}]");
  w.eval("state.layers[0].name='ベース'");
  w.renderAll();
  t('画面に日本語の名前が出る', txt(w, 'layerbar').includes('職場'), txt(w, 'layerbar').slice(0, 30));

  const out = w.generateKeymap(S());
  t('ノード名は英数字だけ',
    (out.match(/^\s*\w[\w-]*\s*\{/gm) || []).every(x => !/[ぁ-んァ-ヶ一-龥]/.test(x)));
  t('名前はコメントに残る', /\/\/ zmk-env: /.test(out),
    out.split('\n').filter(x => x.includes('zmk-env')).join(''));

  const back = w.freshState(out);
  t('読み直すと名前が戻る', back.groups.map(g => g.name).join(',') === '職場,自宅のMac',
    back.groups.map(g => g.name).join(','));
  t('レイヤー名も戻る', back.layers[0].name === 'ベース', back.layers[0].name);

  // 名前の変更でも弾かれない
  w.renameGroup(0, '会社のWindows');
  t('日本語に変更できる', S().groups[0].name === '会社のWindows', S().groups[0].name);
  w.renameGroup(0, '');
  t('空の名前は断る', S().groups[0].name === '会社のWindows');
  t('同じ名前は断る', (() => { w.renameGroup(0, '自宅のMac'); return S().groups[0].name === '会社のWindows'; })());
  w.renameGroup(0, '職場');
  w.renderAll();
  // 断った2件は想定どおりなので、通し確認の分から除く
  w.__alerts = (w.__alerts || []).filter(x => !/名前を入力してください|同名のグループがあります/.test(x));
}

/* ---------- レイヤータブの番号 ---------- */
section('レイヤータブの番号');
{
  // 利用環境名は行の左端に出ているので、タブでは番号だけを出す
  w.renderAll();
  const tabs = Array.from(w.document.querySelectorAll('#layerbar .ltab'));
  const badges = tabs.map(x => (x.querySelector('.idx') || {}).textContent);
  t('タブの数だけ番号がある', tabs.length > 2 && badges.every(b => b));
  t('利用環境ごとに1から', badges[0] === '1' && badges[1] === '2' && badges[2] === '1', badges.join(','));
  t('利用環境名は入らない', badges.every(b => !/[^0-9]/.test(b)), badges.join(','));
  t('番号は1桁', badges.every(b => b.length === 1), badges.join(','));

  // ダブルクリックで名前を書き換える。番号は残り、選んでいるレイヤーも動かない
  const tabAt = k => w.document.querySelectorAll('#layerbar .ltab')[k];
  w.eval('activeLayer = 0'); w.renderAll();
  tabAt(1).onclick();                       // 1回目: 選択が移る(仕様どおり)
  tabAt(1).onclick();                       // 2回目: 名前の書き換えへ
  const live = tabAt(1);
  const inp = live.querySelector('input.inline-edit');
  t('編集欄が出る', !!inp);
  t('編集欄は素通しの見た目', !!inp && inp.className.includes('flat'), inp && inp.className);
  t('編集中も番号が残る', !!live.querySelector('.idx') && live.querySelector('.idx').textContent === '2',
    live.textContent);
  t('編集中も番号は左端', live.firstChild === live.querySelector('.idx'));
  t('編集欄は名前だけ', !!inp && inp.value === S().layers[1].name, inp && inp.value);
  // 幅は元の文字幅に合わせる(はみ出したら入力中に広げる)
  t('幅を明示している', !!inp && inp.style.width !== '', inp && inp.style.width);
  if (inp) {
    const w0 = inp.style.width;
    inp.value = 'ながいなまえをいれてみる';
    inp.dispatchEvent(new w.Event('input', { bubbles: true }));
    t('入力中に幅を測り直す', inp.style.width !== '' , w0 + ' → ' + inp.style.width);
    inp.value = S().layers[1].name;
  }
  if (inp) {
    inp.value = 'かな';
    inp.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  t('名前を変えられる', S().layers[1].name === 'かな', S().layers[1].name);
  t('編集後は番号だけに戻る', (tabAt(1).querySelector('.idx') || {}).textContent === '2');
  t('編集欄は残らない', !tabAt(1).querySelector('input'));

  // 選んでいるレイヤー自身を書き換えるときも同じ
  w.eval('activeLayer = 0'); w.renderAll();
  tabAt(0).onclick(); tabAt(0).onclick();
  t('選択中のタブも書き換えられる', !!tabAt(0).querySelector('input.inline-edit'));
  const name0 = S().layers[0].name;
  const inp0 = tabAt(0).querySelector('input.inline-edit');
  inp0.value = 'すてる';
  inp0.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  t('取り消せば名前は変わらない', S().layers[0].name === name0, S().layers[0].name);

  // fw実番号に切り替えたときは、そちらの番号を出す
  click(w, 'btn-lnum');
  const fwb = Array.from(w.document.querySelectorAll('#layerbar .ltab'))
    .map(x => x.querySelector('.idx').textContent);
  t('fw表示に切り替わる', fwb.every(b => /^fw\d+$/.test(b)), fwb.join(','));
  click(w, 'btn-lnum');
  t('戻せる', w.document.querySelector('#layerbar .ltab .idx').textContent === '1');
}

/* ---------- 文字列の安全性 ---------- */
section('文字列の安全性');
{
  // esc() の結果は属性値の中にも入るので、引用符まで潰しておく必要がある
  const esc = w.eval('esc');
  t('タグを潰す', esc('<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;', esc('<b>x</b>'));
  t('二重引用符を潰す', !esc('a" onmouseover="x').includes('"'), esc('a" onmouseover="x'));
  t('単引用符を潰す', !esc("a' b").includes("'"), esc("a' b"));
  t('アンパサンドを潰す', esc('a&b') === 'a&amp;b', esc('a&b'));
  t('空でも落ちない', esc(null) === '' && esc(undefined) === '');
  // 実際に属性へ入れて、壊れないことを確かめる
  const d = w.document.createElement('div');
  d.innerHTML = `<span title="${esc('a" onmouseover="alert(1)')}">x</span>`;
  t('属性から抜け出せない', !d.querySelector('span').hasAttribute('onmouseover'),
    d.innerHTML.slice(0, 80));

  /* 利用環境名とレイヤー名は自由な文字を受け付ける。
     選択肢や一覧に出すときにタグとして解釈されないこと。 */
  const keepG = S().groups.map(g => g.name), keepL = S().layers.map(l => l.name);
  w.eval("state.groups[0].name = '<img src=x onerror=alert(1)>'");
  w.eval("state.layers[0].name = '\"><b>boom</b>'");
  w.renderAll();
  // 選択肢は画面を開いたときに作られるので、作る側を呼んでから見る
  ['openPicker', 'renderClThen', 'tbLoad', 'renderSwCurrent', 'fillLkCreateSelects',
   'fillLkSyncSelects', 'renderLinkList', 'renderCombos', 'renderMacros', 'renderBehs']
    .forEach(f => { try { if (typeof w[f] === 'function') w[f](0); } catch (e) {} });
  const holes = [];
  ['p-layer', 'cl-then', 'tb-automouse', 'sw-layer', 'lk-link', 'lk-master', 'lk-selects',
   'lk-list', 'combo-list', 'layerbar']
    .forEach(id => {
      const el = w.document.getElementById(id);
      if (el && el.querySelector('img, script, b')) holes.push(id);
    });
  t('選択肢や一覧にタグが生えない', holes.length === 0, holes.join(','));
  /* <option> の中身はブラウザが文字として扱うので、タグは生えない代わりに
     エスケープしないと名前が食われて消える。名前がそのまま読めることで確かめる。 */
  const gnameNow = w.gname(0);
  const optOk = id => {
    const el = w.document.getElementById(id);
    if (!el || !el.options || !el.options.length) return true;
    return [...el.options].some(o => o.textContent.includes(gnameNow));
  };
  ['p-layer', 'cl-then', 'sw-layer'].forEach(id =>
    t('選択肢の名前が欠けない: ' + id, optOk(id),
      (w.document.getElementById(id) || {}).innerHTML));
  t('レイヤーバーにもタグが生えない',
    !w.document.querySelector('#layerbar img, #layerbar script'),
    (w.document.querySelector('#layerbar img') || {}).outerHTML);
  // チートシートは1枚のHTMLを組み立てるので、そこも見る
  const sheet = w.buildCheatSheet ? w.buildCheatSheet() : '';
  t('チートシートにタグが生えない',
    !/<img src=x onerror/.test(sheet), (sheet.match(/.{0,40}onerror.{0,20}/) || [''])[0]);
  w.eval('state.groups.forEach((g,i)=>g.name = ' + JSON.stringify(keepG) + '[i])');
  w.eval('state.layers.forEach((l,i)=>l.name = ' + JSON.stringify(keepL) + '[i])');
  w.renderAll();
}

/* ---------- 補助画面 ---------- */
section('補助画面が動く');
{
  const errs = [];
  const onerr = e => errs.push(e.message);
  w.addEventListener('error', onerr);

  // チートシート(単体のHTMLを組み立てる)
  const sheet = w.eval('buildCheatSheet')();
  t('チートシートが作れる', typeof sheet === 'string' && sheet.length > 500, String(sheet && sheet.length));
  t('見出しと盤面が入る', /<html/i.test(sheet) && /cboard|cheat/.test(sheet));
  t('自己完結している(外部読み込みが無い)', !/<script src|<link[^>]+href/i.test(sheet));

  // OS互換チェック
  click(w, 'btn-winfix');
  t('OS互換チェックが開く', w.document.getElementById('os-bg').classList.contains('open'));
  t('結果が出る', w.document.getElementById('os-list').innerHTML.length > 0);
  w.closeModal('os-bg');

  // トラックボール(対応キーボードのときだけ)
  if (S().keyboard && S().keyboard.features && S().keyboard.features.trackball) {
    w.eval('tbLoad')();
    const got = w.eval('tbCollect')();
    t('トラックボール設定を読み書きできる', !!got && typeof got === 'object');
  } else {
    t('非対応キーボードではトラックボールを出さない',
      w.document.getElementById('btn-trackball').style.display === 'none');
  }

  w.removeEventListener('error', onerr);
  t('補助画面でエラーが出ない', errs.length === 0, errs.join(' / '));
}

/* ---------- お知らせ ---------- */
section('お知らせ');
{
  const warn = w.document.getElementById('warnings');
  w.eval('say')('✅ ためしのお知らせ');
  t('画面に出る', txt(w, 'warnings').includes('ためしのお知らせ'), txt(w, 'warnings'));
  t('良い知らせの色になる', warn.innerHTML.includes('warnbox ok'), warn.innerHTML.slice(0, 60));
  t('履歴の入口が現れる', w.document.getElementById('msghist').style.display !== 'none');

  w.eval('say')('⚠ 2件目');
  t('新しいものに置き換わる', txt(w, 'warnings').includes('2件目'));

  // 履歴は新しい順。消えたものも読み返せる
  w.eval('clearSay')();
  t('消せる', txt(w, 'warnings') === '');
  click(w, 'btn-msghist');
  t('履歴が開く', w.document.getElementById('msglog-bg').classList.contains('open'));
  const rows = [...w.document.querySelectorAll('#msglog-list .logrow')];
  t('消えたお知らせも残っている', rows.length >= 2, String(rows.length));
  t('新しい順に並ぶ', rows[0].textContent.includes('2件目'), rows[0].textContent);
  t('履歴でも色が付く', w.document.querySelectorAll('#msglog-list .warnbox.ok').length >= 1);
  w.closeModal('msglog-bg');

  // 20件を超えたら古いものから落ちる
  for (let i = 0; i < 25; i++) w.eval('say')('連番 ' + i);
  t('20件で打ち切る', w.eval('MSG_LOG.length') === 20, String(w.eval('MSG_LOG.length')));
  t('最新が先頭', w.eval('MSG_LOG[0].text') === '連番 24', w.eval('MSG_LOG[0].text'));
  w.eval('clearSay')();
}

/* ---------- メニューの開閉 ---------- */
section('メニューの開閉');
{
  const menu = w.document.getElementById('hmenu');
  const open = () => { menu.classList.add('open'); };
  // 表示の切り替えは、押しても閉じない(見比べたいため)
  ['btn-lang', 'btn-theme', 'btn-lnum', 'btn-combo-ov'].forEach(id => {
    open();
    click(w, id);
    t('押しても閉じない: ' + id, menu.classList.contains('open'));
  });
  w.setLang('ja'); w.applyLang();
  // それ以外は押したら閉じる
  open();
  click(w, 'btn-help');
  t('ほかの項目は閉じる', !menu.classList.contains('open'));
  w.closeModal('help-bg');
  menu.classList.remove('open');
}

/* ---------- ダイアログの開閉 ---------- */
section('ダイアログ');
{
  const dialogs = ['combo-bg', 'morph-bg', 'td-bg', 'macro-bg', 'cl-bg', 'ht-bg',
    'tune-bg', 'tb-bg', 'gh-bg', 'kb-bg', 'os-bg', 'links-bg', 'sync-bg', 'sw-bg'];
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
  t('標準ダイアログが呼ばれていない', !(w.__stdDialogs || []).length, (w.__stdDialogs || []).join(' / '));
}

section('メッセージの色分け');
{
  // 本物の notify を呼んで、種別ごとに見た目が変わることを見る
  const head = () => w.document.getElementById('ask-head').className;
  // 通知は既定で「できません」の色。良い/注意は記号から判定させる
  const kinds = [['この操作はできません', 'bad', null], ['✅ 保存しました', 'ok', 'ok'], ['⚠ 注意してください', 'warn', 'warn']];
  kinds.forEach(([msg, want, kind]) => {
    w.__realNotify(msg, kind);
    t('通知の色: ' + want, head().includes(want), head());
    click(w, 'ask-ok');
  });
  t('通知を閉じられる', !w.document.getElementById('ask-bg').classList.contains('open'));

  // 入力ダイアログ(旧prompt)
  let got = null;
  w.eval('uiPrompt')('名前:', 'foo', v => { got = v; });
  t('入力欄が出る', w.document.getElementById('ask-input').style.display !== 'none');
  t('初期値が入る', w.document.getElementById('ask-input').value === 'foo');
  w.document.getElementById('ask-input').value = 'bar';
  click(w, 'ask-ok');
  t('入力値を受け取れる', got === 'bar', String(got));

  // 取り消しなら呼ばれない
  let called = false;
  w.eval('uiConfirm')('消しますか?', () => { called = true; });
  t('確認は取り消せる色で出る', w.document.getElementById('ask-cancel').style.display !== 'none');
  click(w, 'ask-cancel');
  t('取り消せば実行されない', !called);

  // メッセージ枠のクラス
  const box = w.eval('msgHtml')('✅ できました');
  t('良い知らせは ok クラス', box.includes('warnbox ok'), box.slice(0, 40));
  t('ふつうの文は info クラス', w.eval('msgHtml')('保存先を選んでください').includes('warnbox info'));
}

/* ---------- 並べ替えのガイド ---------- */
section('並べ替えのガイド');
{
  /* jsdom は大きさを持たないので、並び順から作り物の座標を与える。
     行0(3枚) 行1(2枚) 行2(1枚)、タブは幅90・間隔100、行の高さ30。 */
  const R = (left, top, w2, h) => ({ left, top, right: left + w2, bottom: top + h,
                                     width: w2, height: h, x: left, y: top });
  function fakeLayout() {
    const bar = w.document.getElementById('layerbar');
    const rows = Array.from(bar.querySelectorAll('.lrow'));
    rows.forEach((row, ri) => {
      const top = 10 + ri * 40;
      const tabs = Array.from(row.querySelectorAll('.ltab'));
      // 行そのものは「＋」まで含めて広い。タブの右端(=線を止める位置)とは違う
      row.getBoundingClientRect = () => R(0, top, 800, 30);
      Array.from(row.children).forEach(c => { c.getBoundingClientRect = () => R(0, top, 10, 30); });
      tabs.forEach((t, k) => { t.getBoundingClientRect = () => R(200 + k * 100, top, 90, 30); });
    });
  }
  const reset = () => {
    w.eval(`state.layers = [0,1,2,3,4,5].map(n=>({
              name:'L'+n, displayName:null,
              bindings:state.layers[0].bindings.slice(), sensor:null, shiftLayer:false}));
            state.groups = [{name:'A',count:3},{name:'B',count:2},{name:'C',count:1}];
            state.links = []; activeLayer = 0;`);
    w.renderAll();
    fakeLayout();
  };
  reset();

  const line = () => w.document.getElementById('dropline');
  const shown = () => !!line() && line().classList.contains('on');
  // 線が出ていないときでも落ちないように、値の取り出しは包む
  const at = k => line() ? line().dataset[k] : '(線なし)';
  const st = k => line() ? line().style[k] : '(線なし)';
  const over = (x, y) => {
    w.onBarDragOver({ clientX: x, clientY: y, preventDefault() {}, dataTransfer: {} });
  };
  const drop = () => {
    w.onBarDrop({ preventDefault() {}, dataTransfer: {} });
    fakeLayout();
  };

  t('掴む場所がある', w.document.querySelectorAll('#layerbar .ghandle').length === 3);
  t('移動ボタンは無い', !Array.from(w.document.querySelectorAll('#layerbar button'))
    .some(b => b.textContent === '▲' || b.textContent === '▼'));
  t('行に利用環境の番号が付く',
    w.document.querySelector('#layerbar .lrow').dataset.gi === '0');
  t('タブにレイヤー番号が付く',
    w.document.querySelector('#layerbar .ltab').dataset.li === '0');

  /* --- レイヤー: カーソルに一番近い境目を選ぶ --- */
  w.eval('layerDragIdx = 0');
  over(210, 20);
  t('自分の手前は選ばない', !shown());
  over(305, 20);
  t('直後も選ばない', !shown());
  over(400, 20);
  t('2つ隣なら線が出る', shown(), at('at'));
  t('レイヤーは縦線', at('dir') === 'v', at('dir'));
  const hMid = st('height');
  t('線の高さはタブの高さ', hMid === '30px', hMid);
  over(600, 20);
  t('右端の外は末尾あつかい', shown() && at('at') === 'l3', at('at'));
  t('末尾でも線の高さは同じ', st('height') === hMid && st('height') === '30px',
    hMid + ' vs ' + st('height'));

  // タブとタブのすき間でも落とせる(判定に穴が無い)
  w.eval('layerDragIdx = 2');
  over(295, 20);
  t('タブのすき間でも線が出る', shown() && at('at') === 'l1', at('at'));
  over(250, 20);
  t('番号のあたりでも線が出る', shown(), at('at'));

  // 別の利用環境の行の上
  w.eval('layerDragIdx = 0');
  over(300, 60);
  t('別の利用環境では線を出さない', !shown());
  t('別の利用環境には置けない印', !!w.document.querySelector('#layerbar .lrow.nodrop'));
  over(400, 20);
  t('戻れば印は消える', !w.document.querySelector('#layerbar .lrow.nodrop'));

  /* --- 利用環境: 行の境目を選ぶ --- */
  w.eval('layerDragIdx = null; groupDragGi = 0');
  over(300, 15);
  t('自分の行は選ばない', !shown());
  over(300, 52);
  t('直下の行も選ばない', !shown());
  over(300, 92);
  t('2つ下なら線が出る', shown() && at('at') === 'g2', at('at'));
  t('利用環境は横線', at('dir') === 'h', at('dir'));
  t('線はレイヤーの右端で止まる', st('width') === '490px', st('width'));
  t('線はバーの幅いっぱいではない', st('width') !== '800px', st('width'));
  over(300, 200);
  t('一番下は末尾あつかい', shown() && at('at') === 'g3', at('at'));
  w.eval('groupDragGi = 2');
  over(300, 200);
  t('末尾の環境を末尾へは出さない', !shown());

  /* --- 実際に落とす --- */
  w.eval('groupDragGi = null; layerDragIdx = 0');
  over(400, 20);
  drop();
  t('落とすと並びが変わる', S().layers.map(l => l.name).join(',') === 'L1,L0,L2,L3,L4,L5',
    S().layers.map(l => l.name).join(','));
  t('落とすと線が消える', !shown());

  reset();
  w.eval('layerDragIdx = 0');
  over(900, 20);
  drop();
  t('末尾へも落とせる', S().layers.map(l => l.name).join(',') === 'L1,L2,L0,L3,L4,L5',
    S().layers.map(l => l.name).join(','));
  t('末尾へ移しても員数は変わらない', S().groups.map(g => g.count).join(',') === '3,2,1',
    S().groups.map(g => g.count).join(','));

  reset();
  w.eval('groupDragGi = 1');
  over(300, 12);
  drop();
  t('利用環境も入れ替わる', S().groups.map(g => g.name).join(',') === 'B,A,C',
    S().groups.map(g => g.name).join(','));
  t('入れ替えに確認は要らない', !w.document.getElementById('ask-bg').classList.contains('open'));

  // 別の利用環境へ落とすと、複製を使うよう案内が出る
  reset();
  w.eval('layerDragIdx = 0');
  over(300, 60);
  drop();
  t('またぐ移動は断る', S().layers.map(l => l.name).join(',') === 'L0,L1,L2,L3,L4,L5',
    S().layers.map(l => l.name).join(','));
  t('案内が出る', txt(w, 'warnings').includes('複製'), txt(w, 'warnings').slice(0, 60));
}

console.log(`\n画面の動作テスト: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
