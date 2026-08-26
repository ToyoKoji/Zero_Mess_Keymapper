#!/usr/bin/env node
/* =====================================================================
 * Zero Mess Keymapper — 自動テストスイート
 * 使い方: node tests.js [HTMLファイルパス]
 * HTMLからcore/UIスクリプトを抽出し、構文と主要ロジックを検証する。
 * 機能追加やリファクタリングの後は必ずこれを実行すること。
 * ===================================================================== */
const fs = require('fs');
const path = require('path');

const htmlPath = process.argv[2] || path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script(?: id="core")?>([\s\S]*?)<\/script>/g)];

let pass = 0, fail = 0;
function t(name, cond, detail){
  if(cond){ pass++; }
  else { fail++; console.log('  ✗ FAIL:', name, detail!==undefined? '→ '+detail : ''); }
}
function section(s){ console.log('--- '+s); }

/* ---------- 0. 構文 ---------- */
section('構文');
scripts.forEach((s,i)=>{
  try{ new Function(s[1]); t('script'+i+' syntax', true); }
  catch(e){ t('script'+i+' syntax', false, e.message); }
});

/* ---------- core 読み込み ---------- */
const corePath = '/tmp/zmk-core-test.js';
fs.writeFileSync(corePath, scripts[0][1]);
delete require.cache[require.resolve(corePath)];
const C = require(corePath);
const ui = scripts[1][1];

/* ---------- 1. パースとラウンドトリップ ---------- */
section('keymapパース/生成');
const p = C.parseKeymap(C.DEFAULT_KEYMAP);
t('7レイヤー×43キー', p.layers.length===7 && p.layers.every(l=>l.bindings.length===C.NUM_KEYS));
{
  const st = {originalText:C.DEFAULT_KEYMAP, layers:p.layers};
  const out = C.generateKeymap(st);
  const p2 = C.parseKeymap(out);
  t('バインディング完全一致', p.layers.every((l,i)=>l.bindings.every((b,j)=>b===p2.layers[i].bindings[j])));
  t('sensor保持', out.includes('inc_dec_kp PG_UP'));
}

/* ---------- 2. グループとJIS変換 ---------- */
section('グループ/JIS変換');
{
  const pp = C.parseKeymap(C.DEFAULT_KEYMAP);
  pp.layers.forEach((l,i)=>l.shiftLayer=(i===0));
  const groups = [{name:'US',count:5},{name:'GEN',count:2}];
  const st = {originalText:C.DEFAULT_KEYMAP, layers:pp.layers, groups};
  groups.push({name:'JIS',count:5});
  C.convertAllToJis(st);
  t('12レイヤー構成', st.layers.length===12);
  t('JIS名に_JISなし', st.layers.slice(7).every(l=>!/_JIS$/.test(l.name)));
  t('親指参照リマップ(JIS側へ)', st.layers[7].bindings[38]==='&lt 9 SPACE' && st.layers[7].bindings[41]==='&lt 8 ENTER');
  t('GEN参照は据え置き', st.layers[7].bindings[37]==='&lt_to_layer_0 6 INT_HENKAN' && st.layers[7].bindings[7]==='&lt 5 I');
  const l7m = [...new Set(st.layers[7].bindings.filter(b=>b.startsWith('&jis_')))].sort().join(',');
  t('Shift有効レイヤーでmorph生成', l7m==='&jis_minus,&jis_semi,&jis_sqt', l7m);
  t('Shift無効レイヤーはmorphなし', st.layers.slice(8).every(L=>L.bindings.every(b=>!b.startsWith('&jis_'))));
  // 順→逆の完全復元
  let rt = true;
  const maps = C.buildJisMaps(groups);
  for(const s of maps.order){
    st.layers[s].bindings.forEach(b=>{
      const f = C.convBinding(b, maps.fwd, !!st.layers[s].shiftLayer).raw;
      const back = C.convBindingUs(f, maps.rev).raw;
      if(C.normBinding(back)!==C.normBinding(b)) rt = false;
    });
  }
  t('順変換→逆変換の完全復元', rt);
  // ノード名と復元
  const out = C.generateKeymap(st);
  t('ノード名にグループ接頭辞', C.parseKeymap(out).layers[0].name==='US_01_default_layer');
  t('グループ名の一意関数', C.gnameFor(groups,0)==='US_01' && C.gnameFor(groups,6)==='GEN_02' && C.gnameFor(groups,11)==='JIS_05');
}

/* ---------- 3. 個別変換ケース ---------- */
section('変換ケース');
[
 ['&kp AT_SIGN','&kp LBKT'], ['&kp CARET','&kp EQUAL'], ['&kp PIPE','&kp LS(INT3)'],
 ['&kp SQT','&jis_sqt'], ['&kp EQUAL','&jis_eql'], ['&kp LS(N2)','&kp LBKT'],
 ['&kp Q','&kp Q'], ['&trans','&trans'], ['&kp LC(LA(KP_NUMBER_0))','&kp LC(LA(KP_NUMBER_0))'],
].forEach(([i,e])=>t('JIS: '+i, C.convBinding(i, null, true).raw===e, C.convBinding(i, null, true).raw));
[
 ['&jis_minus','&kp MINUS'], ['&kp LBKT','&kp AT'], ['&kp LS(N7)','&kp SQT'], ['&kp NUHS','&kp RBKT'],
].forEach(([i,e])=>t('US: '+i, C.convBindingUs(i, null).raw===e, C.convBindingUs(i, null).raw));
t('normBinding等価', C.normBinding('&kp NUMBER_7')===C.normBinding('&kp N7'));

/* ---------- 4. 各機能ノードのラウンドトリップ ---------- */
section('Combo/Behavior/Macro/CondLayer');
{
  const combos = C.parseCombos(C.DEFAULT_KEYMAP);
  t('combos 5件', combos.length===5);
  const behs = C.parseBehaviors(C.DEFAULT_KEYMAP);
  t('morphs 0 / hts 1 / raws 0', behs.morphs.length===0 && behs.hts.length===1 && behs.raws.length===0);
  t('lt_to_layer_0構造化', behs.hts[0].name==='lt_to_layer_0' && behs.hts[0].holdBeh==='&mo');
  const mac = C.parseMacros(C.DEFAULT_KEYMAP);
  t('to_layer_0はraw保持', mac.raws.length===1 && mac.items.length===0);
  const st = {originalText:C.DEFAULT_KEYMAP, layers:C.parseKeymap(C.DEFAULT_KEYMAP).layers,
    combos, behaviors:behs, macros:mac,
    condLayers:[{name:'tri', ifLayers:[1,2], thenLayer:3}],
    trackball:{automouseLayer:6, scrollLayers:[5], snipeLayers:[]},
    holdtap:{mt:{flavor:'tap-preferred', tapping:'180', quickTap:'0', idle:null}, lt:{tapping:'220'}, sk:{releaseAfter:'900', quickRelease:true}, sl:{}}};
  st.behaviors.hts.push({name:'hm', holdBeh:'&kp', tapBeh:'&kp', flavor:'balanced', tapping:'175', quickTap:null, idle:'150', positions:[5,6], onRelease:true, label:null});
  st.behaviors.morphs.push({name:'mm', b1:'&kp DOT', b2:'&kp COLON', mods:['MOD_LSFT'], keepMods:['MOD_LSFT']});
  st.behaviors.tds.push({name:'td1', term:250, bindings:['&kp A','&kp B']});
  st.macros.items.push({name:'mc1', tapMs:20, waitMs:null, steps:C.parseMacroSteps('&macro_press &kp LSHFT &macro_tap &kp H &macro_release &kp LSHFT')});
  const out = C.generateKeymap(st);
  t('combo保持', out.includes('key-positions = <11 12>'));
  const b2 = C.parseBehaviors(out);
  t('behaviorsラウンドトリップ', b2.morphs.length===1 && b2.tds.length===1 && b2.hts.length===2);
  t('hold-tap詳細保持', JSON.stringify(b2.hts.find(h=>h.name==='hm').positions)==='[5,6]' && b2.hts.find(h=>h.name==='hm').onRelease===true);
  t('label保持', out.includes('label = "LAYER_TAP_TO_0"'));
  const m2 = C.parseMacros(out);
  t('macroラウンドトリップ', m2.items.length===1 && m2.raws.length===1 && C.genMacroBindings(m2.items[0].steps)===C.genMacroBindings(st.macros.items[0].steps));
  t('condLayerラウンドトリップ', JSON.stringify(C.parseCondLayers(out))===JSON.stringify(st.condLayers));
  t('holdtapラウンドトリップ', C.parseHoldtapOne(out,'mt').flavor==='tap-preferred' && C.parseHoldtapOne(out,'lt').tapping==='220');
  t('stickyラウンドトリップ', C.parseStickyOne(out,'sk').quickRelease===true && C.parseStickyOne(out,'sk').releaseAfter==='900');
  t('trackball反映', C.parseTrackball(out).automouseLayer===6);
  t('コメント保全', out.includes('// arrows {'));
  t('生成後もkeymapパース可', C.parseKeymap(out).layers.length===7);
}

/* ---------- 5. 文字テーブル/表示 ---------- */
section('文字テーブル');
t('charFor us', C.charFor('N2','us',true)==='@' && C.charFor('LBKT','us',false)==='[');
t('charFor jis', C.charFor('N2','jis',true)==='"' && C.charFor('LBKT','jis',false)==='@');
t('LOCALE_CHARS拡張点', !!C.LOCALE_CHARS.us && !!C.LOCALE_CHARS.jis);
t('bindingLabel', C.bindingLabel('&sk LSHIFT').top==='SK' && C.bindingLabel('&caps_word').main==='CapsW');

/* ---------- 6. UI純関数(抽出評価) ---------- */
section('UI純関数');
function evalUiFn(startMarker, endMarker, expr, extra){
  const seg = ui.slice(ui.indexOf(startMarker), ui.indexOf(endMarker));
  const coreSrc = scripts[0][1].replace('if (typeof module','if (false && typeof module');
  return eval(coreSrc + '\n' + (extra||'') + seg + '\n;(' + expr + ')');
}
{
  const deriveGroups = evalUiFn('// ノード名(US_01_xxx形式)からグループと表示名を復元', 'function freshState(', 'deriveGroups');
  const layers = [{name:'US_01_a',bindings:[]},{name:'US_02_b',bindings:[]},{name:'JIS_01_a',bindings:[]}];
  const g = deriveGroups(layers);
  t('deriveGroups', JSON.stringify(g)==='[{"name":"US","count":2},{"name":"JIS","count":1}]' && layers[0].name==='a' && layers[2].name==='a');
  const modsPhrase = evalUiFn('// 修飾セットの日本語表現', '// バインディングの見た目文字列', 'modsPhrase');
  t('modsPhrase', modsPhrase(['MOD_LSFT','MOD_RSFT'])==='Shift中' && modsPhrase(['MOD_LSFT','MOD_RCTL'])==='LShiftまたはRCtrl押下時');
}
{
  // uiLabel: 実文字表示
  const seg = ui.slice(ui.indexOf('function kpFace'), ui.indexOf('function renderBoard(){'));
  const coreSrc = scripts[0][1].replace('if (typeof module','if (false && typeof module');
  const state = {behaviors:{morphs:[],tds:[],hts:[{name:'hm',holdBeh:'&kp',tapBeh:'&kp',positions:[],onRelease:false}]},macros:{items:[],raws:[]}};
  const R = eval(coreSrc + seg + ';({uiLabel})');
  t('uiLabel JIS実文字', R.uiLabel('&kp LS(N8)','jis',true).main==='(' && R.uiLabel('&kp LBKT','jis',true).main==='@');
  t('uiLabel corner制御', R.uiLabel('&kp N2','jis',true).corner==='"' && R.uiLabel('&kp N2','jis',false).corner===undefined);
  t('uiLabel カスタムHT', R.uiLabel('&hm LSHIFT A','us',true).hold==='⇧' && R.uiLabel('&hm LSHIFT A','us',true).main==='A');
}

/* ---------- 6.5 13-a: キーボード抽象化 ---------- */
section('13-a キーボード抽象化');
{
  const dtsi = 'keys = <&key_physical_attrs 100 100 0 37 0 0 0>, <&key_physical_attrs 100 100 650 387 (-2000) 750 387>;';
  t('parsePhysicalLayout(負数/括弧対応)', JSON.stringify(C.parsePhysicalLayout(dtsi))==='[[100,100,0,37,0,0,0],[100,100,650,387,-2000,750,387]]');
  t('parsePhysicalLayout(該当なし)', C.parsePhysicalLayout('nothing here')===null);
  t('deriveRows(roBaは4行)', C.deriveRows(C.ROBA_PROFILE.keys).length===4);
  t('gridKeys', C.gridKeys(30).length===30 && C.gridKeys(30)[12][3]===100);
  const emp = C.makeEmptyKeymap(30);
  const pe = C.parseKeymap(emp);
  t('makeEmptyKeymap', pe.layers.length===1 && pe.layers[0].bindings.length===30);
  // 切替: 30キー盤で生成→復帰
  C.setKeyboard({id:'g30', name:'g30', keyCount:30, keys:C.gridKeys(30), rows:null, features:{}});
  t('setKeyboard反映', C.getKeyboard().numKeys===30 && C.getKeyboard().keyboard.id==='g30');
  const st30 = {originalText:emp, layers:pe.layers, groups:[{name:'MAIN',count:1}]};
  const out30 = C.generateKeymap(st30);
  t('30キーでの生成/再パース', C.parseKeymap(out30).layers[0].bindings.length===30);
  C.setKeyboard(C.ROBA_PROFILE);
  t('roBaへ復帰', C.getKeyboard().numKeys===43);
}

/* ---------- 6.7 12-a: GitHub連携ヘルパ ---------- */
section('12-a GitHub連携');
{
  // Node環境にbtoa/atobがない場合の補完
  if(typeof globalThis.btoa==='undefined'){
    globalThis.btoa = s=>Buffer.from(s,'binary').toString('base64');
    globalThis.atob = b=>Buffer.from(b,'base64').toString('binary');
  }
  t('parseRepoRef owner/repo', JSON.stringify(C.parseRepoRef('ikoooGit/zmk-config-roBa'))==='{"owner":"ikoooGit","repo":"zmk-config-roBa"}');
  t('parseRepoRef URL', JSON.stringify(C.parseRepoRef('https://github.com/ikoooGit/zmk-config-roBa'))==='{"owner":"ikoooGit","repo":"zmk-config-roBa"}');
  t('parseRepoRef .git/末尾スラッシュ', JSON.stringify(C.parseRepoRef('https://github.com/a/b.git/'))==='{"owner":"a","repo":"b"}');
  t('parseRepoRef 不正入力', C.parseRepoRef('not a repo')===null && C.parseRepoRef('')===null);
  const sample = C.DEFAULT_KEYMAP;
  t('base64往復(UTF-8)', C.base64ToUtf8(C.utf8ToBase64(sample))===sample);
  t('base64往復(日本語)', C.base64ToUtf8(C.utf8ToBase64('日本語テスト🎹'))==='日本語テスト🎹');
  const pf = C.pickConfigFiles(['config/roBa.keymap','config/roBa_R.conf','README.md','config/west.yml','build.yaml','x/y.keymap']);
  t('pickConfigFiles', JSON.stringify(pf.keymaps)==='["config/roBa.keymap","x/y.keymap"]' && JSON.stringify(pf.confs)==='["config/roBa_R.conf"]');
}

/* ---------- 6.8 OS互換性チェック ---------- */
section('Windows互換チェック');
{
  t('K_MUTE検出', C.findWinIncompatible('&kp K_MUTE')[0].to==='C_MUTE');
  t('K_PREV→C_PREVIOUS', C.fixWinIncompatible('&kp K_PREV')==='&kp C_PREVIOUS');
  t('修飾内も検出', C.fixWinIncompatible('&kp LC(K_NEXT)')==='&kp LC(C_NEXT)');
  t('mt内も検出', C.fixWinIncompatible('&mt LSHIFT K_MUTE')==='&mt LSHIFT C_MUTE');
  t('C_系は誤検出しない', C.findWinIncompatible('&kp C_MUTE').length===0 && C.findWinIncompatible('&kp C_NEXT').length===0);
  t('通常キーは誤検出しない', C.findWinIncompatible('&kp A').length===0 && C.fixWinIncompatible('&kp A')==='&kp A');
  t('部分一致で壊さない', C.fixWinIncompatible('&kp K_NEXT2')==='&kp K_NEXT2');
}

/* ---------- 6.7 環境間のレイヤー参照 ---------- */
section('状態の保存・復元');
{
  /* 保存先が3つある(Undo履歴 / ブラウザ保存 / バックアップJSON)。
     何を保存するかが分散すると、設定項目を足したときに黙って消える。 */
  const st = C.parseKeymap(C.DEFAULT_KEYMAP);
  const full = Object.assign(C.pickState({}), {
    originalText: C.DEFAULT_KEYMAP,
    layers: st.layers,
    groups: [{name:'US', count:st.layers.length, locale:'us', platform:'win', color:'#123456'}],
    keyboard: 'roba',
    combos: C.parseCombos(C.DEFAULT_KEYMAP),
    behaviors: C.parseBehaviors(C.DEFAULT_KEYMAP),
    trackball: C.parseTrackball(C.DEFAULT_KEYMAP),
    conf: Object.assign({}, C.CONF_DEFAULTS),
    holdtap: {mt:C.parseHoldtapOne(C.DEFAULT_KEYMAP,'mt'), lt:C.parseHoldtapOne(C.DEFAULT_KEYMAP,'lt'),
              sk:C.parseStickyOne(C.DEFAULT_KEYMAP,'sk'), sl:C.parseStickyOne(C.DEFAULT_KEYMAP,'sl')},
    macros: C.parseMacros(C.DEFAULT_KEYMAP),
    condLayers: C.parseCondLayers(C.DEFAULT_KEYMAP)
  });

  t('保存項目が一覧化されている', Array.isArray(C.STATE_KEYS) && C.STATE_KEYS.length>0);
  t('保存項目に重複がない', new Set(C.STATE_KEYS).size===C.STATE_KEYS.length);
  t('pickState が全項目を返す', JSON.stringify(Object.keys(C.pickState(full)))===JSON.stringify(C.STATE_KEYS));
  t('pickState は保存対象外を持ち込まない',
    Object.keys(C.pickState(Object.assign({}, full, {activeLayer:3, 一時的な値:1}))).every(k=>C.STATE_KEYS.includes(k)));
  t('pickState は空でも落ちない', Object.keys(C.pickState(null)).length===C.STATE_KEYS.length);

  // 往復(Undo履歴 / ブラウザ保存に相当)
  const round = C.pickState(JSON.parse(JSON.stringify(C.pickState(full))));
  C.STATE_KEYS.forEach(k=>{
    t('往復しても失われない: '+k, JSON.stringify(round[k])===JSON.stringify(full[k]));
  });

  // バックアップJSON(付帯情報つき)に相当
  {
    const payload = Object.assign({app:'zero-mess-keymapper', version:C.APP_VERSION, date:'x'},
      C.pickState(full), {activeLayer:2});
    const back = C.pickState(JSON.parse(JSON.stringify(payload)));
    t('バックアップ形式でも全項目が戻る',
      C.STATE_KEYS.every(k=>JSON.stringify(back[k])===JSON.stringify(full[k])));
    t('バックアップに付帯情報が入る', payload.app==='zero-mess-keymapper' && payload.activeLayer===2);
  }

  /* ここが要: state を作る場所と保存する場所の項目がずれていないか。
     新しい設定を足して STATE_KEYS に入れ忘れると、この1本が落ちる。 */
  {
    // freshState が返すオブジェクトの「最上位の項目名」だけを拾う。
    // holdtap:{mt:..} のような入れ子を数えないよう、深さ0の部分だけ見る。
    const fresh = ui.slice(ui.indexOf('function freshState('));
    const body = fresh.slice(0, fresh.indexOf('\n}\n'));
    const inner = body.slice(body.lastIndexOf('return {') + 8);
    let depth = 0, top = '';
    for (const ch of inner) {
      if (ch === '{' || ch === '(' || ch === '[') { depth++; continue; }
      if (ch === '}' || ch === ')' || ch === ']') { if (depth === 0) break; depth--; continue; }
      if (depth === 0) top += ch;
    }
    // 区切りの , を消費すると次の項目を取りこぼすため、後読みで判定する
    const made = [...(',' + top).matchAll(/,\s*([a-zA-Z_]\w*)\s*(?=[:,])/g)].map(m => m[1]);
    const missing = C.STATE_KEYS.filter(k => !made.includes(k));
    const extra = [...new Set(made)].filter(k => !C.STATE_KEYS.includes(k));
    t('freshState の項目がすべて保存対象になっている', missing.length === 0, missing.join(','));
    t('保存されない項目が紛れていない', extra.length === 0, extra.join(','));
  }

  // 保存箇所が1本化されている(手書きの重複が復活していない)
  t('保存箇所が pickState に集約されている',
    !ui.includes('state = {originalText:o.originalText') && !ui.includes('originalText:state.originalText, layers:state.layers'));
  t('ブラウザ保存が pickState を使う', /function load\(\)\{[\s\S]{0,400}pickState\(o\)/.test(ui));
  t('バックアップが pickState を使う', /btn-backup[\s\S]{0,400}pickState\(state\)/.test(ui));
}

section('並べ替えと参照の追従');
{
  /* 並べ替えでレイヤー番号が変わると、それを指すあらゆる設定を直す必要がある。
     1つでも漏れると、並べ替えた瞬間に別のレイヤーを指す。 */
  const mk = ()=>({
    layers: [
      {name:'L0', bindings:['&mo 1','&lt 2 SPACE','&to 3','&kp A','&lt_to_layer_0 2 INT_HENKAN']},
      {name:'L1', bindings:['&tog 2','&sl 0','&trans','&none','&kp B']},
      {name:'L2', bindings:['&mo 0','&kp C','&trans','&trans','&trans']},
      {name:'L3', bindings:['&mo 1','&kp D','&trans','&trans','&trans']}
    ],
    combos: [{name:'c1', binding:'&mo 2', keyPositions:[1,2], layers:[0,1]},
             {name:'c2', binding:'&kp ESC', keyPositions:[3,4], layers:[]}],
    trackball: {automouseLayer:2, scrollLayers:[1,3], snipeLayers:[2]},
    condLayers: [{name:'tri', ifLayers:[1,2], thenLayer:3}]
  });

  // L3 を先頭へ: 0→1, 1→2, 2→3, 3→0
  {
    const s = mk();
    const perm = C.reorderLayers(s, [3,0,1,2]);
    t('レイヤーが並べ替わる', s.layers.map(l=>l.name).join(',')==='L3,L0,L1,L2');
    t('&mo が追従する', s.layers[1].bindings[0]==='&mo 2', s.layers[1].bindings[0]);
    t('&lt が追従する', s.layers[1].bindings[1]==='&lt 3 SPACE', s.layers[1].bindings[1]);
    t('&to も追従する(並べ替えでは番号自体が変わるため)', s.layers[1].bindings[2]==='&to 0', s.layers[1].bindings[2]);
    t('カスタムhold-tapも追従する', s.layers[1].bindings[4]==='&lt_to_layer_0 3 INT_HENKAN', s.layers[1].bindings[4]);
    t('通常キーは変わらない', s.layers[1].bindings[3]==='&kp A');
    t('&tog / &sl も追従する', s.layers[2].bindings[0]==='&tog 3' && s.layers[2].bindings[1]==='&sl 1',
      s.layers[2].bindings.slice(0,2).join(' '));
    t('コンボの動作が追従する', s.combos[0].binding==='&mo 3', s.combos[0].binding);
    t('コンボのlayers指定が追従する', s.combos[0].layers.join(',')==='1,2', s.combos[0].layers.join(','));
    t('layers未指定のコンボは空のまま', s.combos[1].layers.length===0);
    t('自動マウスレイヤーが追従する', s.trackball.automouseLayer===3, String(s.trackball.automouseLayer));
    t('スクロールレイヤーが追従する', s.trackball.scrollLayers.join(',')==='0,2', s.trackball.scrollLayers.join(','));
    t('スナイプレイヤーが追従する', s.trackball.snipeLayers.join(',')==='3');
    t('条件付きレイヤーのifが追従する', s.condLayers[0].ifLayers.join(',')==='2,3', s.condLayers[0].ifLayers.join(','));
    t('条件付きレイヤーのthenが追従する', s.condLayers[0].thenLayer===0, String(s.condLayers[0].thenLayer));
    t('対応表が返る', perm[3]===0 && perm[0]===1);
  }

  // 元に戻せる(往復)
  {
    const s = mk(), before = JSON.stringify(s);
    C.reorderLayers(s, [3,0,1,2]);
    C.reorderLayers(s, [1,2,3,0]);
    t('並べ替えは往復で元に戻る', JSON.stringify(s)===before);
  }
  // 変化なしの並べ替えでは何も起きない
  {
    const s = mk(), before = JSON.stringify(s);
    C.reorderLayers(s, [0,1,2,3]);
    t('並びが同じなら変化しない', JSON.stringify(s)===before);
  }
  // 参照が範囲外でも壊さない
  {
    const s = mk();
    s.layers[0].bindings[0] = '&mo 99';
    C.reorderLayers(s, [3,0,1,2]);
    t('存在しない番号は触らない', s.layers[1].bindings[0]==='&mo 99');
  }
  // 設定が欠けていても落ちない
  {
    const s = {layers:[{name:'a',bindings:['&mo 1']},{name:'b',bindings:['&kp A']}]};
    let ok = true;
    try{ C.reorderLayers(s, [1,0]); }catch(e){ ok = false; }
    t('コンボやトラックボールが無くても落ちない', ok);
  }

  // 移動の計算
  t('前へ移動', C.orderForMove(5,3,1).join(',')==='0,3,1,2,4', C.orderForMove(5,3,1).join(','));
  t('後ろへ移動', C.orderForMove(5,1,4).join(',')==='0,2,3,1,4', C.orderForMove(5,1,4).join(','));
  t('先頭へ移動', C.orderForMove(4,3,0).join(',')==='3,0,1,2');
  t('末尾へ移動', C.orderForMove(4,0,4).join(',')==='1,2,3,0');
  t('同じ位置なら変化なし', C.orderForMove(4,2,2).join(',')==='0,1,2,3');
  t('移動しても全レイヤーが1回ずつ現れる',
    [[6,0,5],[6,5,0],[6,2,4],[6,4,2]].every(([n,f,x])=>{
      const o = C.orderForMove(n,f,x);
      return o.length===n && new Set(o).size===n;
    }));

  // グループ移動の計算
  {
    const g = [{name:'A',count:2},{name:'B',count:3},{name:'C',count:1}];
    const r = C.orderForGroupMove(g, 0, 2);
    t('グループ移動でレイヤー順が入れ替わる', r.order.join(',')==='2,3,4,0,1,5', r.order.join(','));
    t('グループの並びも返る', r.groupOrder.join(',')==='1,0,2', r.groupOrder.join(','));
    t('グループ移動でも全レイヤーが1回ずつ',
      r.order.length===6 && new Set(r.order).size===6);
    const back = C.orderForGroupMove(g, 2, 0);
    t('末尾を先頭へも計算できる', back.groupOrder.join(',')==='2,0,1', back.groupOrder.join(','));
  }

  // グループ移動を実際に適用して参照が保たれるか
  {
    const s = mk();
    s.groups = [{name:'A',count:2},{name:'B',count:2}];
    const {order, groupOrder} = C.orderForGroupMove(s.groups, 0, 2);
    s.groups = groupOrder.map(k=>s.groups[k]);
    C.reorderLayers(s, order);
    t('グループ移動後もレイヤー数が保たれる', s.layers.length===4);
    t('グループ移動後も参照が有効な範囲',
      s.layers.every(l=>l.bindings.every(b=>{
        const m = b.trim().match(/^&\S+\s+(\d+)/);
        if(!m || !/^&(mo|lt|to|tog|sl|lt_to_layer_0)\b/.test(b.trim())) return true;
        const v = Number(m[1]);
        return v>=0 && v<s.layers.length;
      })));
    t('グループ移動後もコンボのlayersが有効',
      s.combos.every(c=>(c.layers||[]).every(x=>x>=0 && x<s.layers.length)));
  }
}

section('レイヤーの複製・削除・移動');
{
  /* いずれもレイヤー番号を動かすので、参照とグループの員数がついてこないと壊れる。
     ドラッグ&ドロップで手軽に起こせる操作なので、境界条件まで確かめる。 */
  const mk = ()=>({
    layers: [
      {name:'A0', bindings:['&mo 1','&lt 3 SPACE','&kp A'], sensor:null, shiftLayer:true},
      {name:'A1', bindings:['&to 3','&kp B','&trans'], sensor:null, shiftLayer:false},
      {name:'B0', bindings:['&mo 0','&kp C','&trans'], sensor:'&inc_dec_kp C_VOL_UP C_VOL_DN', shiftLayer:false},
      {name:'B1', bindings:['&tog 2','&kp D','&trans'], sensor:null, shiftLayer:false}
    ],
    groups: [{name:'A', count:2}, {name:'B', count:2}],
    combos: [{name:'c', binding:'&mo 3', keyPositions:[0,1], layers:[2,3]}],
    trackball: {automouseLayer:3, scrollLayers:[2], snipeLayers:[]},
    condLayers: [{name:'tri', ifLayers:[1,2], thenLayer:3}]
  });

  /* ---- 複製 ---- */
  {
    const s = mk();
    const pos = C.copyLayerAt(s, 0);
    t('複製は直後に入る', pos===1 && s.layers[1].name==='A0', String(pos));
    t('複製でレイヤーが1枚増える', s.layers.length===5);
    t('複製元のグループの員数が増える', s.groups[0].count===3 && s.groups[1].count===2,
      s.groups.map(g=>g.count).join(','));
    t('複製の中身は同じ', s.layers[1].bindings.join(',')===s.layers[0].bindings.join(','));
    t('複製は別の配列を持つ(元と連動しない)', s.layers[1].bindings!==s.layers[0].bindings);
    t('複製でShift入力設定を引き継ぐ', s.layers[1].shiftLayer===true);
    t('複製の表示名はまっさら', s.layers[1].displayName===null);
    t('複製で後ろの参照がずれる', s.layers[0].bindings[1]==='&lt 4 SPACE', s.layers[0].bindings[1]);
    t('複製でコンボのlayersもずれる', s.combos[0].layers.join(',')==='3,4', s.combos[0].layers.join(','));
    t('複製でトラックボール設定もずれる', s.trackball.automouseLayer===4);
    t('複製で条件付きレイヤーもずれる',
      s.condLayers[0].ifLayers.join(',')==='2,3' && s.condLayers[0].thenLayer===4,
      s.condLayers[0].ifLayers.join(',')+' / '+s.condLayers[0].thenLayer);
  }
  {
    const s = mk();
    C.copyLayerAt(s, 3);           // 末尾を複製
    t('末尾の複製もできる', s.layers.length===5 && s.layers[4].name==='B1');
    t('末尾の複製では参照が動かない', s.combos[0].layers.join(',')==='2,3');
    t('末尾の複製でも員数が合う', s.groups[1].count===3);
  }
  {
    const s = mk();
    C.copyLayerAt(s, 2);           // センサー付きレイヤー
    t('センサー設定も複製される', s.layers[3].sensor===s.layers[2].sensor);
  }

  /* ---- 削除 ---- */
  {
    const s = mk();
    const r = C.deleteLayerAt(s, 1);
    t('削除でレイヤーが1枚減る', s.layers.length===3);
    t('削除したレイヤーが消えている', !s.layers.some(l=>l.name==='A1'));
    t('削除でグループの員数が減る', s.groups[0].count===1 && s.groups[1].count===2,
      s.groups.map(g=>g.count).join(','));
    t('削除でグループは消えない', r.removedGroup===false && s.groups.length===2);
    t('削除で後ろの参照が繰り上がる', s.layers[1].bindings[0]==='&mo 0');
    t('削除で先頭の参照も繰り上がる', s.layers[0].bindings[1]==='&lt 2 SPACE', s.layers[0].bindings[1]);
    t('削除でコンボのlayersが繰り上がる', s.combos[0].layers.join(',')==='1,2', s.combos[0].layers.join(','));
    t('削除でトラックボール設定が繰り上がる', s.trackball.automouseLayer===2);
  }
  {
    // 参照されているレイヤーを消すと fw0 に付け替わる
    const s = mk();
    C.deleteLayerAt(s, 3);
    t('消したレイヤーへの参照はfw0になる', s.combos[0].binding==='&mo 0', s.combos[0].binding);
    t('条件付きレイヤーのthenもfw0になる', s.condLayers[0].thenLayer===0);
    t('&to も付け替わる', s.layers[1].bindings[0]==='&to 0', s.layers[1].bindings[0]);
  }
  {
    // グループの最後の1枚を消すとグループごと消える
    const s = mk();
    C.deleteLayerAt(s, 3);
    const r = C.deleteLayerAt(s, 2);
    t('グループが空になると消える', r.removedGroup===true && s.groups.length===1,
      s.groups.map(g=>g.name).join(','));
    t('残ったグループの員数が正しい', s.groups[0].count===2 && s.layers.length===2);
  }
  {
    // 重複が整理される(2つのレイヤーがどちらも fw0 を指すようになる場合)
    const s = mk();
    s.condLayers[0].ifLayers = [2,3];
    C.deleteLayerAt(s, 3);
    C.deleteLayerAt(s, 2);
    t('付け替えで重なった番号は整理される',
      new Set(s.condLayers[0].ifLayers).size===s.condLayers[0].ifLayers.length,
      s.condLayers[0].ifLayers.join(','));
  }
  {
    const s = {layers:[{name:'only', bindings:['&kp A']}], groups:[{name:'G',count:1}]};
    t('最後の1枚は削除できない', C.deleteLayerAt(s, 0)===null && s.layers.length===1);
  }

  /* ---- 移動 ---- */
  {
    const s = mk();
    C.moveLayerAt(s, 0, 3);        // A0 をグループBへ
    t('移動でレイヤーが並べ替わる', s.layers.map(l=>l.name).join(',')==='A1,B0,A0,B1',
      s.layers.map(l=>l.name).join(','));
    t('移動元の員数が減り移動先が増える', s.groups[0].count===1 && s.groups[1].count===3,
      s.groups.map(g=>g.count).join(','));
    t('移動でレイヤー総数は変わらない', s.layers.length===4);
    t('移動でも参照が有効な範囲',
      s.layers.every(l=>l.bindings.every(b=>{
        const m = b.trim().match(/^&(?:mo|lt|to|tog|sl)\s+(\d+)/);
        return !m || (Number(m[1])>=0 && Number(m[1])<s.layers.length);
      })));
  }
  {
    // グループの最後の1枚を動かすとグループが消える
    const s = mk();
    C.moveLayerAt(s, 0, 3);
    const r = C.moveLayerAt(s, 0, 3);
    t('空になったグループが消える', r.removedGroup===true && s.groups.length===1,
      s.groups.map(g=>g.name+':'+g.count).join(','));
    t('全レイヤーが残っているグループに属する', s.groups[0].count===s.layers.length);
  }
  {
    const s = mk();
    t('同じ位置への移動は何もしない', C.moveLayerAt(s, 2, 2)===null);
  }
  {
    // グループの末尾へ落とす(移動先グループを明示)
    const s = mk();
    C.moveLayerAt(s, 3, 2, 0);     // B1 をグループAの末尾へ
    t('移動先グループを明示できる', s.groups[0].count===3 && s.groups[1].count===1,
      s.groups.map(g=>g.count).join(','));
    t('明示した移動でも並びが正しい', s.layers.map(l=>l.name).join(',')==='A0,A1,B1,B0',
      s.layers.map(l=>l.name).join(','));
  }

  /* ---- 一連の操作で壊れないか ---- */
  {
    const s = mk();
    C.copyLayerAt(s, 0);
    C.moveLayerAt(s, 0, 4);
    C.deleteLayerAt(s, 1);
    C.copyLayerAt(s, 2);
    t('複製・移動・削除を重ねても員数が合う',
      s.groups.reduce((a,g)=>a+g.count,0)===s.layers.length,
      s.groups.map(g=>g.name+':'+g.count).join(',')+' vs '+s.layers.length);
    t('重ねても参照がすべて有効',
      s.layers.every(l=>l.bindings.every(b=>{
        const m = b.trim().match(/^&(?:mo|lt|to|tog|sl)\s+(\d+)/);
        return !m || (Number(m[1])>=0 && Number(m[1])<s.layers.length);
      })));
    t('重ねてもコンボのlayersが有効',
      s.combos.every(c=>(c.layers||[]).every(x=>x>=0 && x<s.layers.length)));
    t('重ねてもトラックボール設定が有効',
      s.trackball.automouseLayer>=0 && s.trackball.automouseLayer<s.layers.length);
  }

  // UI側が core の処理を使っている(同じ計算が二重に書かれていない)
  t('複製はcoreの処理を使う', ui.includes('copyLayerAt(state, i)'));
  t('削除はcoreの処理を使う', ui.includes('deleteLayerAt(state, i)'));
  t('移動はcoreの処理を使う', ui.includes('moveLayerAt(state, from, target)'));
  t('参照の付け替えが1か所にまとまっている',
    (ui.match(/remapAllRefs\(/g)||[]).length===0, 'UI側の呼び出し数');

  /* ---- 追加と入れ替え ---- */
  {
    const s = mk();
    const pos = C.addLayerAt(s, 0);
    t('グループの末尾に足される', pos===2 && s.layers[2].name==='layer', String(pos));
    t('追加した層は全部透過', s.layers[2].bindings.every(b=>b==='&trans'));
    t('キー数が既存に揃う', s.layers[2].bindings.length===s.layers[0].bindings.length);
    t('追加でグループの員数が増える', s.groups[0].count===3 && s.groups[1].count===2,
      s.groups.map(g=>g.count).join(','));
    t('追加で後ろの参照がずれる', s.combos[0].layers.join(',')==='3,4', s.combos[0].layers.join(','));
    t('追加後も員数の合計が一致', s.groups.reduce((a,g)=>a+g.count,0)===s.layers.length);
  }
  {
    const s = mk();
    C.addLayerAt(s, 1);
    t('末尾グループへの追加もできる', s.layers.length===5 && s.layers[4].name==='layer');
    t('末尾への追加では参照が動かない', s.combos[0].layers.join(',')==='2,3');
  }
  {
    const s = mk();
    const perm = C.swapGroups(s, 0, 1);
    t('グループが入れ替わる', s.groups.map(g=>g.name).join(',')==='B,A', s.groups.map(g=>g.name).join(','));
    t('レイヤーも入れ替わる', s.layers.map(l=>l.name).join(',')==='B0,B1,A0,A1',
      s.layers.map(l=>l.name).join(','));
    t('入れ替えで参照が追従する', s.layers[2].bindings[0]==='&mo 3', s.layers[2].bindings[0]);
    t('入れ替えでコンボのlayersも追従', s.combos[0].layers.join(',')==='0,1', s.combos[0].layers.join(','));
    t('入れ替えの対応表が返る', perm[0]===2 && perm[2]===0);
    C.swapGroups(s, 0, 1);
    t('入れ替えは往復で元に戻る', s.layers.map(l=>l.name).join(',')==='A0,A1,B0,B1');
  }
  t('レイヤー追加はcoreの処理を使う', ui.includes('addLayerAt(state, gi)'));
  t('グループ入れ替えはcoreの処理を使う', ui.includes('swapGroups(state, gi, gj)'));
}

section('環境間のレイヤー参照');
{
  // 環境A(fw0-4) → 環境B(fw7-11)
  const map = C.buildEnvOffsetMap({start:0,count:5}, {start:7,count:5});
  t('対応表を作る', JSON.stringify(map)==='{"0":7,"1":8,"2":9,"3":10,"4":11}');
  t('レイヤー数が違えば少ない方に合わせる',
    JSON.stringify(C.buildEnvOffsetMap({start:0,count:5},{start:7,count:3}))==='{"0":7,"1":8,"2":9}');

  // 環境内の一時的なレイヤー切替 → 付け替える
  t('&lt を付け替える', C.remapWithinEnv('&lt 2 SPACE', map)==='&lt 9 SPACE');
  t('&mo を付け替える', C.remapWithinEnv('&mo 3', map)==='&mo 10');
  t('&tog を付け替える', C.remapWithinEnv('&tog 1', map)==='&tog 8');
  t('&sl を付け替える', C.remapWithinEnv('&sl 4', map)==='&sl 11');
  t('カスタムhold-tapも付け替える', C.remapWithinEnv('&lt_to_layer_0 3 INT_HENKAN', map)==='&lt_to_layer_0 10 INT_HENKAN');

  // 環境の切り替えは絶対指定 → そのまま
  t('&to は付け替えない(環境切替)', C.remapWithinEnv('&to 0', map)==='&to 0'
    && C.remapWithinEnv('&to 7', map)==='&to 7');

  // 対象外・範囲外
  t('通常キーは不変', C.remapWithinEnv('&kp A', map)==='&kp A' && C.remapWithinEnv('&trans', map)==='&trans');
  t('範囲外の番号は不変', C.remapWithinEnv('&mo 9', map)==='&mo 9');
  t('引数なしは不変', C.remapWithinEnv('&caps_word', map)==='&caps_word');
  t('WITHIN_ENV_REFS に &to を含まない', !C.WITHIN_ENV_REFS.includes('&to'));

  // 往復(A→B→A)で元に戻る
  const back = C.buildEnvOffsetMap({start:7,count:5}, {start:0,count:5});
  let ng = [];
  ['&lt 2 SPACE','&mo 3','&tog 1','&sl 4','&to 0','&kp A'].forEach(b=>{
    const r = C.remapWithinEnv(C.remapWithinEnv(b, map), back);
    if(r!==b) ng.push(b+' → '+r);
  });
  t('付け替えは往復で元に戻る', ng.length===0, ng.join(' | '));
}

/* ---------- 6.72 用語と単一環境 ---------- */
section('用語 / 単一環境');
{
  t('用語が一箇所にまとまっている', typeof C.TERMS==='object' && !!C.TERMS.env && !!C.TERMS.shared);
  t('term() が引ける', C.term('env')===C.TERMS.env && C.term('unknown')==='unknown');
  t('envCount / isSimpleMode がUIにある', ui.includes('function envCount') && ui.includes('function isSimpleMode'));
  t('単一環境でボタンを隠す処理がある', ui.includes("['btn-platform','btn-switcher','btn-order']"));
  t('共有という種別を持たない', !ui.includes('isSharedGroup') && !ui.includes('wantShared'));
  t('配列に「設定なし」がある', ui.includes("'<option value=\"\">設定なし</option>'"));
}

/* ---------- 6.75 レイヤー順序の検査 ---------- */
section('環境追加ウィザード');
{
  // 旧「US→JIS変換」ボタンが完全に撤去されていること(同期へ一本化)
  t('btn-jis がHTMLから消えている', !html.includes('btn-jis'));
  t('旧変換ダイアログ(conv-bg)が消えている', !html.includes('conv-bg'));
  t('旧変換ロジックが残っていない',
    !ui.includes('pendingConv') && !ui.includes('openConvDialog')
    && !ui.includes('computeConvDiffs') && !ui.includes('convDiffCount'));
  // 削除で巻き添えになりやすい近隣機能が生きていること
  t('mod-morph登録処理は残っている',
    ui.includes('function registerJisMorphs') && ui.includes('function pruneJisMorphs'));
  t('jis_* のロック判定は残っている', ui.includes('function isAutoJis'));

  // ウィザード本体
  t('コピーしない場合は1レイヤーだけ作る',
    /ae-create[\s\S]{0,1400}Array\(n\)\.fill\('&trans'\)/.test(ui));
  t('作成後に順序の問題を知らせる',
    /ae-create[\s\S]{0,3400}findShadowedRefs\(state\.groups, state\.layers\)/.test(ui));

  // ヘルプとi18n
  t('ヘルプに環境の追加がある', html.includes('<dt>環境の追加</dt>'));
  t('ヘルプから旧変換ボタンの記述が消えている', !html.includes('変換ボタンは差異があるときだけ有効'));
  ['環境を追加','コピー元:','作成','既存の環境から配置をコピーして変換する'].forEach(k=>{
    t('英訳がある: '+k, scripts[0][1].includes("'"+k+"':'"));
  });
  t('廃止した項目の英訳が残っていない',
    !scripts[0][1].includes("'⇄ US→JIS変換'") && !scripts[0][1].includes("'共有レイヤーを最後に移動'"));
}

section('環境追加ウィザードの実動作');
{
  const convBindingFull = C.convBindingFull;   // core へ移設済み
  const raw = C.DEFAULT_KEYMAP;
  const st = C.parseKeymap(raw);
  st.originalText = raw;
  st.groups = [{name:'US', count:5}, {name:'GEN', count:st.layers.length-5}];
  st.layers[0].shiftLayer = true;

  const s0 = C.groupRanges(st.groups)[0];
  const dstStart = st.layers.length;
  const offsetMap = C.buildEnvOffsetMap(s0, {start:dstStart, count:s0.count});

  function build(dstLoc, dstOs){
    const morphs = {}, used = new Set(), out = [];
    for(let k=0;k<s0.count;k++){
      const S = st.layers[s0.start+k];
      out.push({name:S.name, displayName:null, sensor:S.sensor, shiftLayer:!!S.shiftLayer,
        bindings:S.bindings.map(b=>{
          const r = convBindingFull(b, 'us', dstLoc, 'win', dstOs, !!S.shiftLayer,
            (nm,m)=>{morphs[nm]=m;}, offsetMap);
          if(r.raw.startsWith('&loc_')) used.add(r.raw.slice(1));
          return r.raw;
        })});
    }
    return {out, morphs, used};
  }

  const before = st.layers.slice(s0.start, s0.start+s0.count).flatMap(l=>l.bindings);

  // --- US配列 × macOS の環境を作る ---
  const mac = build('us','mac');
  t('レイヤー数がコピー元と同じ', mac.out.length === s0.count);
  t('キー数が保たれている', mac.out.every((l,i)=>l.bindings.length === st.layers[s0.start+i].bindings.length));

  let refIn = 0, refOut = [], badTo = 0;
  mac.out.forEach(l=>l.bindings.forEach(b=>{
    const tk = b.trim().split(/\s+/);
    if(['&mo','&lt','&tog','&sl'].includes(tk[0])){
      const n = Number(tk[1]);
      if(n>=dstStart && n<dstStart+s0.count) refIn++; else refOut.push(b.trim());
    }
    if(tk[0]==='&to' && Number(tk[1])>=dstStart) badTo++;
  }));
  t('自環境内のレイヤー参照が付け替わる', refIn > 0, '内'+refIn);
  t('環境外(共通層)への参照は温存される', refOut.every(b=>Number(b.split(/\s+/)[1]) < dstStart), JSON.stringify(refOut));
  t('&to は付け替えない(環境切替は絶対番号)', badTo === 0);
  t('Win→Macで変換が起きる', mac.out.flatMap(l=>l.bindings).join(' ') !== before.join(' '));
  t('Win→Macで壊れた出力がない', !/&undefined|&null|NaN/.test(mac.out.flatMap(l=>l.bindings).join(' ')));

  // 環境外を指す参照 = 後ろの環境から前を呼ぶ形。ウィザードはこれを警告する
  if(refOut.length){
    const shadow = C.findShadowedRefs(
      st.groups.concat([{name:'MAC', count:s0.count}]), st.layers.concat(mac.out));
    t('隠れる参照を検出できる(警告の根拠)', shadow.length > 0, JSON.stringify(shadow));
  }

  // --- JIS配列の環境を作る ---
  const jis = build('jis', null);
  const jflat = jis.out.flatMap(l=>l.bindings);
  t('US→JISで変換が起きる', jflat.join(' ') !== before.join(' '));
  t('US→JISでmod-morphが生成される', jis.used.size > 0, [...jis.used].join(',') || '0件');
  t('生成したmod-morphに中身が揃っている',
    [...jis.used].every(nm=>jis.morphs[nm] && jis.morphs[nm].u && jis.morphs[nm].s));
  t('US→JISで壊れた出力がない', !/&undefined|NaN/.test(jflat.join(' ')));

  // --- 書き出して読み直す ---
  st.layers = st.layers.concat(mac.out);
  st.groups = st.groups.concat([{name:'MAC', count:s0.count, locale:'us', platform:'mac'}]);
  [...mac.used].forEach(nm=>{
    const m = mac.morphs[nm];
    if(m) st.behaviors.morphs.push({name:nm, b1:m.u, b2:m.s, mods:['MOD_LSFT','MOD_RSFT'], keepMods:[]});
  });
  let out = '';
  try { out = C.generateKeymap(st); } catch(e){ t('書き出しで例外が出ない', false, e.message); }
  t('.keymap として書き出せる', out.length > 0 && out.includes('keymap'));
  t('書き出しに新環境が含まれる', /MAC_/.test(out));
  if(out){
    const re = C.parseKeymap(out);
    t('読み直してレイヤー数が一致', re.layers.length === st.layers.length, re.layers.length+' vs '+st.layers.length);
    t('読み直して中身が一致',
      JSON.stringify(re.layers.map(l=>l.bindings)) === JSON.stringify(st.layers.map(l=>l.bindings)));
  }
}

section('コンボの環境別対応');
{
  const groups = [
    {name:'US',  count:3, locale:'us',  platform:'win'},
    {name:'JIS', count:3, locale:'jis', platform:'win'},
    {name:'GEN', count:2, locale:null,  platform:null}
  ];
  // 環境属性の純関数化
  t('localeOfGroup が明示設定を返す', C.localeOfGroup(groups,1)==='jis');
  t('localeOfGroup が設定なしを返す', C.localeOfGroup(groups,2)===null);
  t('古いデータは名前から推測する', C.localeOfGroup([{name:'JIS',count:1}],0)==='jis');
  t('古いデータのGENは設定なし', C.localeOfGroup([{name:'GEN',count:1}],0)===null);
  t('platformOfGroup が動く',
    C.platformOfGroup([{name:'MAC',count:1}],0)==='mac' && C.platformOfGroup(groups,0)==='win');

  // 効く環境の判定
  const all = {name:'q', binding:'&kp LS(SQT)', keyPositions:[1,2], layers:[]};
  t('layers未指定は全環境に効く', C.comboEnvIndices(all, groups).join(',')==='0,1,2');
  t('layers指定で環境が絞られる',
    C.comboEnvIndices({...all, layers:[0,1]}, groups).join(',')==='0');
  t('環境をまたぐlayers指定も拾える',
    C.comboEnvIndices({...all, layers:[2,3]}, groups).join(',')==='0,1');

  // 環境依存の検出
  const issues = C.findComboEnvIssues(groups, [all]);
  t('記号コンボが環境依存として検出される', issues.length===1, JSON.stringify(issues));
  if(issues.length){
    t('基準は最初の環境', issues[0].baseName==='US');
    t('JIS環境で別の入力になると分かる', issues[0].diffs.some(d=>d.name==='JIS'));
    t('変換後の動作が入っている', issues[0].diffs.every(d=>d.binding && d.binding!==all.binding));
  }
  // 環境で変わらないものは検出しない
  t('Bluetoothコンボは検出しない', C.findComboEnvIssues(groups, [{name:'b', binding:'&bt BT_SEL 0', keyPositions:[3,4], layers:[]}]).length===0);
  t('文字キーのコンボは検出しない', C.findComboEnvIssues(groups, [{name:'e', binding:'&kp ESC', keyPositions:[5,6], layers:[]}]).length===0);
  t('1環境だけなら検出しない', C.findComboEnvIssues([{name:'US',count:3,locale:'us'}], [all]).length===0);
  t('既に環境ごとなら検出しない',
    C.findComboEnvIssues(groups, [{...all, layers:[0,1,2]}]).length===0);

  // 分割
  const parts = C.splitComboForEnvs(all, groups);
  t('環境の数だけ複製される', parts && parts.length===3, parts? parts.length : 'null');
  if(parts){
    t('名前が環境ごとに変わる', new Set(parts.map(p=>p.name)).size===3, parts.map(p=>p.name).join(','));
    t('名前がdevicetreeで使える形', parts.every(p=>/^[A-Za-z_][\w]*$/.test(p.name)), parts.map(p=>p.name).join(','));
    t('layers がその環境のレイヤーだけを指す',
      parts[0].layers.join(',')==='0,1,2' && parts[1].layers.join(',')==='3,4,5' && parts[2].layers.join(',')==='6,7');
    t('基準環境の動作は変わらない', parts[0].binding===all.binding);
    t('JIS環境の動作が変換されている', parts[1].binding!==all.binding && !/undefined|NaN/.test(parts[1].binding));
    t('キー位置は引き継がれる', parts.every(p=>p.keyPositions.join(',')==='1,2'));
    t('分割後は検出されなくなる', C.findComboEnvIssues(groups, parts).length===0);
  }

  // .keymap への書き出しと読み直し
  {
    const raw = C.DEFAULT_KEYMAP;
    const st = C.parseKeymap(raw); st.originalText = raw;
    st.combos = (parts||[]).map(p=>({...p, timeout:50, idle:null, slowRelease:false}));
    let out=''; try{ out = C.generateKeymap(st); }catch(e){ t('分割コンボを書き出せる', false, e.message); }
    t('分割コンボを書き出せる', out.includes('combos'));
    t('layers指定が書き出される', /layers\s*=\s*</.test(out));
    const re = C.parseCombos(out);
    t('読み直してコンボ数が一致', re.length===st.combos.length, re.length+' vs '+st.combos.length);
    t('読み直してlayersが一致',
      JSON.stringify(re.map(c=>c.layers))===JSON.stringify(st.combos.map(c=>c.layers)),
      JSON.stringify(re.map(c=>c.layers)));
    t('読み直して動作が一致',
      JSON.stringify(re.map(c=>c.binding))===JSON.stringify(st.combos.map(c=>c.binding)));
  }

  // UI側
  t('整合性チェックに組み込まれている', scripts[0][1].includes('findComboEnvIssues(state.groups||[], state.combos||[])'));
  t('単一環境では出さない', /function renderComboEnvWarn\(\)\{[\s\S]{0,300}isSimpleMode\(\)/.test(ui));
  t('ヘルプに記載がある', html.includes('<dt>コンボと環境</dt>'));
  t('英訳がある', scripts[0][1].includes("'環境ごとに分ける':'"));
  t('groupLocale は core へ委譲している', ui.includes('function groupLocale(gi){ return localeOfGroup(state.groups, gi); }'));
}

section('マクロ等の環境別対応');
{
  /* コンボと同じ問題。定義は1つなのに複数の環境から呼ばれるため、
     記号を出す定義は配列の違う環境で別の記号になる。 */
  const mk = ()=>({
    groups:[{name:'US', count:2, locale:'us', platform:'win'},
            {name:'JIS', count:2, locale:'jis', platform:'win'}],
    layers:[
      {name:'u0', bindings:['&mm','&my_td','&at_macro','&kp A','&plain']},
      {name:'u1', bindings:['&kp B','&trans','&trans','&trans','&trans']},
      {name:'j0', bindings:['&mm','&my_td','&at_macro','&kp A','&plain']},
      {name:'j1', bindings:['&kp B','&trans','&trans','&trans','&trans']}
    ],
    behaviors:{
      morphs:[{name:'mm', b1:'&kp SQT', b2:'&kp DQT', mods:['MOD_LSFT'], keepMods:[]},
              {name:'jis_lbkt', b1:'&kp LBKT', b2:'&kp A', mods:[], keepMods:[]},
              {name:'plain', b1:'&kp LEFT', b2:'&kp RIGHT', mods:['MOD_LSFT'], keepMods:[]}],
      tds:[{name:'my_td', term:200, bindings:['&kp AT_SIGN','&kp DQT']}],
      hts:[], raws:[]
    },
    macros:{items:[{name:'at_macro', waitMs:null, tapMs:null,
      steps:[{type:'tap', binding:'&kp AT_SIGN'},{type:'wait', ms:50},{type:'tap', binding:'&kp A'}]}], raws:[]},
    combos:[], trackball:null, condLayers:[]
  });

  // 中身の取り出しと書き戻し
  {
    const s0 = mk();
    t('mod-morphの中身を取り出せる',
      C.behaviorBindingsOf('morph', s0.behaviors.morphs[0]).join(',')==='&kp SQT,&kp DQT');
    t('tap-danceの中身を取り出せる',
      C.behaviorBindingsOf('td', s0.behaviors.tds[0]).join(',')==='&kp AT_SIGN,&kp DQT');
    t('マクロの中身を取り出せる(待機は空)',
      C.behaviorBindingsOf('macro', s0.macros.items[0]).join('|')==='&kp AT_SIGN||&kp A',
      C.behaviorBindingsOf('macro', s0.macros.items[0]).join('|'));
    const cp = C.behaviorWithBindings('morph', s0.behaviors.morphs[0], 'x', ['&kp A','&kp B']);
    t('書き戻した複製は名前と中身が変わる', cp.name==='x' && cp.b1==='&kp A' && cp.b2==='&kp B');
    t('書き戻しても他の設定は残る', JSON.stringify(cp.mods)===JSON.stringify(['MOD_LSFT']));
    t('書き戻しは元を壊さない', s0.behaviors.morphs[0].b1==='&kp SQT');
    const mc = C.behaviorWithBindings('macro', s0.macros.items[0], 'y', ['&kp Z','','&kp W']);
    t('マクロの待機ステップは保たれる', mc.steps[1].type==='wait' && mc.steps[1].binding===undefined);
    t('マクロの他のステップが書き換わる', mc.steps[0].binding==='&kp Z' && mc.steps[2].binding==='&kp W');
  }

  // 呼び出し元の環境
  {
    const s0 = mk();
    t('呼んでいる環境が分かる', C.envIndicesUsingBehavior(s0,'mm').join(',')==='0,1');
    t('呼ばれていなければ空', C.envIndicesUsingBehavior(s0,'nothing').length===0);
    t('部分一致では拾わない', C.envIndicesUsingBehavior(s0,'m').length===0);
    s0.layers[2].bindings[0] = '&kp A';
    t('片方の環境だけなら1つ', C.envIndicesUsingBehavior(s0,'mm').join(',')==='0');
  }

  // 検出
  {
    const s0 = mk();
    const iss = C.findBehaviorEnvIssues(s0);
    t('3種類とも検出される', iss.length===3, iss.map(x=>x.kind+':'+x.name).join(','));
    const byName = Object.fromEntries(iss.map(x=>[x.name,x]));
    t('mod-morphが検出される', !!byName.mm && byName.mm.kind==='morph');
    t('tap-danceが検出される', !!byName.my_td && byName.my_td.kind==='td');
    t('マクロが検出される', !!byName.at_macro && byName.at_macro.kind==='macro');
    t("' はJISでShift+7になる", byName.mm.diffs[0].bindings[0]==='&kp LS(N7)', byName.mm.diffs[0].bindings[0]);
    t('" はJISでShift+2になる', byName.mm.diffs[0].bindings[1]==='&kp LS(N2)', byName.mm.diffs[0].bindings[1]);
    t('@ はJISで括弧キーになる', byName.at_macro.diffs[0].bindings[0]==='&kp LBKT', byName.at_macro.diffs[0].bindings[0]);
    t('基準は最初の環境', iss.every(x=>x.baseName==='US'));
    t('環境で変わらない定義は検出しない', !byName.plain);
    t('自動生成のmod-morphは対象外', !byName.jis_lbkt);
    t('自動生成の判定', C.isGeneratedMorph('jis_x') && C.isGeneratedMorph('loc_x') && !C.isGeneratedMorph('mm'));
  }
  {
    // 1つの環境からしか呼ばれていなければ問題にしない
    const s0 = mk();
    s0.layers[2].bindings = ['&kp A','&kp A','&kp A','&kp A','&kp A'];
    t('片方の環境だけなら検出しない', C.findBehaviorEnvIssues(s0).length===0);
  }
  {
    // 環境が1つなら常に問題なし
    const s0 = mk();
    s0.groups = [{name:'US', count:4, locale:'us', platform:'win'}];
    t('単一環境では検出しない', C.findBehaviorEnvIssues(s0).length===0);
  }
  {
    // 配列が同じなら問題なし
    const s0 = mk();
    s0.groups[1].locale = 'us';
    t('配列が同じなら検出しない', C.findBehaviorEnvIssues(s0).length===0);
  }

  // 分割
  {
    const s0 = mk();
    const iss = C.findBehaviorEnvIssues(s0);
    const made = iss.slice().reverse().flatMap(x=>C.splitBehaviorForEnvs(s0, x));
    t('環境ごとに定義が増える', made.length===3, made.join(','));
    t('名前が環境名になる', made.every(n=>n.endsWith('_jis')), made.join(','));
    t('名前がdevicetreeで使える形', made.every(n=>/^[A-Za-z_]\w*$/.test(n)));
    t('mod-morphが追加される', s0.behaviors.morphs.some(m=>m.name==='mm_jis'));
    t('tap-danceが追加される', s0.behaviors.tds.some(d=>d.name==='my_td_jis'));
    t('マクロが追加される', s0.macros.items.some(m=>m.name==='at_macro_jis'));
    t('追加した定義の中身が変換されている',
      s0.behaviors.morphs.find(m=>m.name==='mm_jis').b1==='&kp LS(N7)');
    t('JIS環境の参照が差し替わる',
      s0.layers[2].bindings.slice(0,3).join(' ')==='&mm_jis &my_td_jis &at_macro_jis',
      s0.layers[2].bindings.slice(0,3).join(' '));
    t('基準環境の参照は変わらない',
      s0.layers[0].bindings.slice(0,3).join(' ')==='&mm &my_td &at_macro');
    t('基準環境の定義も変わらない', s0.behaviors.morphs[0].b1==='&kp SQT');
    t('関係ない定義は差し替えない', s0.layers[2].bindings[4]==='&plain');
    t('通常キーは触らない', s0.layers[2].bindings[3]==='&kp A');
    t('分割後は検出されなくなる', C.findBehaviorEnvIssues(s0).length===0);
    t('定義名が重複しない',
      new Set(C.collectBehaviorDefs(s0).map(d=>d.name)).size===C.collectBehaviorDefs(s0).length);
  }
  {
    // 3環境でも動くか
    const s0 = mk();
    s0.groups.push({name:'UK', count:2, locale:'uk', platform:'win'});
    s0.layers.push({name:'k0', bindings:['&mm','&kp A','&kp A','&kp A','&kp A']},
                   {name:'k1', bindings:['&kp B','&trans','&trans','&trans','&trans']});
    const iss = C.findBehaviorEnvIssues(s0).filter(x=>x.name==='mm');
    t('3環境ぶんの差異が出る', iss[0].diffs.length===2, JSON.stringify(iss[0].diffs.map(d=>d.name)));
    C.splitBehaviorForEnvs(s0, iss[0]);
    t('環境ごとに別の定義ができる',
      s0.behaviors.morphs.some(m=>m.name==='mm_jis') && s0.behaviors.morphs.some(m=>m.name==='mm_uk'));
    t('UK環境の参照も差し替わる', s0.layers[4].bindings[0]==='&mm_uk', s0.layers[4].bindings[0]);
  }
  {
    // 名前が衝突する場合はずらす
    const s0 = mk();
    s0.behaviors.morphs.push({name:'mm_jis', b1:'&kp A', b2:'&kp B', mods:[], keepMods:[]});
    const iss = C.findBehaviorEnvIssues(s0).filter(x=>x.name==='mm');
    const made = C.splitBehaviorForEnvs(s0, iss[0]);
    t('名前が衝突したらずらす', made[0]==='mm_jis2', made[0]);
    t('ずらしても参照が合う', s0.layers[2].bindings[0]==='&mm_jis2');
  }

  // 書き出して読み直す
  {
    const s0 = mk();
    s0.originalText = C.DEFAULT_KEYMAP;
    C.findBehaviorEnvIssues(s0).slice().reverse().forEach(x=>C.splitBehaviorForEnvs(s0, x));
    let out = '';
    try{ out = C.generateKeymap(s0); }catch(e){ t('分割後も書き出せる', false, e.message); }
    t('分割後も書き出せる', out.length>0);
    t('追加した定義が書き出される', /mm_jis/.test(out) && /my_td_jis/.test(out) && /at_macro_jis/.test(out));
    const rb = C.parseBehaviors(out), rm = C.parseMacros(out);
    t('読み直してmod-morphが揃う', rb.morphs.some(m=>m.name==='mm_jis'), rb.morphs.map(m=>m.name).join(','));
    t('読み直してtap-danceが揃う', rb.tds.some(d=>d.name==='my_td_jis'), rb.tds.map(d=>d.name).join(','));
    t('読み直してマクロが揃う', rm.items.some(m=>m.name==='at_macro_jis'), rm.items.map(m=>m.name).join(','));
    t('読み直して中身も一致',
      (rb.morphs.find(m=>m.name==='mm_jis')||{}).b1==='&kp LS(N7)',
      JSON.stringify(rb.morphs.find(m=>m.name==='mm_jis')));
    t('待機ステップも書き出される', /macro_wait_time 50/.test(out));
  }

  // 壊れた待機ステップ(時間なし)を書き出さない — ビルドできない keymap になるため
  {
    t('時間のない待機は出力しない',
      !/undefined/.test(C.genMacroBindings([{type:'tap',binding:'&kp A'},{type:'wait'},{type:'tap',binding:'&kp B'}])),
      C.genMacroBindings([{type:'tap',binding:'&kp A'},{type:'wait'},{type:'tap',binding:'&kp B'}]));
    t('時間が0や負でも出力しない',
      !/macro_wait_time/.test(C.genMacroBindings([{type:'wait',ms:0}]))
      && !/macro_wait_time/.test(C.genMacroBindings([{type:'wait',ms:-5}])));
    t('正しい待機は出力する', C.genMacroBindings([{type:'wait',ms:30}])==='&macro_wait_time 30');
    t('壊れた待機があっても他のステップは残る',
      C.genMacroBindings([{type:'tap',binding:'&kp A'},{type:'wait'},{type:'tap',binding:'&kp B'}])==='&kp A &kp B');
  }

  // UI
  t('3画面に警告枠がある',
    html.includes('id="bm-envwarn"') && html.includes('id="td-envwarn"') && html.includes('id="mc-envwarn"'));
  t('共通の描画処理がある', ui.includes('function renderBehEnvWarn(boxId, kind)'));
  t('mod-morph画面で描画される', ui.includes("renderBehEnvWarn('bm-envwarn', 'morph')"));
  t('tap-dance画面で描画される', ui.includes("renderBehEnvWarn('td-envwarn', 'td')"));
  t('マクロ画面で描画される', ui.includes("renderBehEnvWarn('mc-envwarn', 'macro')"));
  t('単一環境では出さない', /function renderBehEnvWarn\([\s\S]{0,300}isSimpleMode\(\)/.test(ui));
  t('整合性チェックに組み込まれている', scripts[0][1].includes('findBehaviorEnvIssues(state).forEach'));
  t('ヘルプに記載がある', html.includes('<dt>マクロ・tap-dance と環境</dt>'));
}

section('レイヤー順序');
{
  // ZMK: レイヤー0は常に有効 / 番号が大きいレイヤーが優先
  // → 自分より前のレイヤーを呼び出しても無視される
  const groups = [{name:'US',count:5},{name:'GEN',count:2},{name:'JIS',count:5}];
  const mk = n => Array.from({length:n},(_,i)=>({name:'L'+i, bindings:Array(43).fill('&kp A')}));

  // JIS(fw7〜)から GEN(fw5,6) を呼ぶ → 隠れる
  const bad = mk(12);
  bad[7].bindings[0] = '&mo 6';
  const sh = C.findShadowedRefs(groups, bad);
  t('前のレイヤーへの呼び出しを検出', sh.length===1 && sh[0].target===6 && sh[0].groupName==='JIS');
  t('検出内容に位置が含まれる', sh[0].layerIndex===7 && sh[0].pos===0 && sh[0].blockedBy===7);

  // 並べ替えれば解消する
  const perm = C.orderToFixShadowing(groups, bad);
  t('並べ替え案が出る', Array.isArray(perm) && JSON.stringify(perm)==='[0,2,1]', JSON.stringify(perm));

  // 先頭グループからの呼び出しは常に安全
  const ok = mk(12);
  ok[0].bindings[0] = '&mo 6';
  ok[0].bindings[1] = '&lt 11 A';
  t('先頭グループは隠れない', C.findShadowedRefs(groups, ok).length===0);

  // 自分より後ろのレイヤーを呼ぶのは問題なし
  const ok2 = mk(12);
  ok2[7].bindings[0] = '&mo 9';
  t('後ろのレイヤーは問題なし', C.findShadowedRefs(groups, ok2).length===0);
  t('問題なければ並べ替え案は出ない', C.orderToFixShadowing(groups, ok2)===null);

  // &to は隠れない(そのレイヤーへ移る動作のため)
  const ok3 = mk(12);
  ok3[7].bindings[0] = '&to 0';
  ok3[7].bindings[1] = '&to 5';
  t('&to は対象外', C.findShadowedRefs(groups, ok3).length===0);
  t('layerRefTargets が &to を拾わない', C.layerRefTargets('&to 3').length===0
    && C.layerRefTargets('&mo 3')[0]===3 && C.layerRefTargets('&lt 3 A')[0]===3);
  t('layerRefTargets 対象外は空', C.layerRefTargets('&kp A').length===0 && C.layerRefTargets('&trans').length===0);

  // 単一グループでは何も起きない
  t('単一グループは常に問題なし', C.findShadowedRefs([{name:'MAIN',count:5}], mk(5)).length===0);
  t('単一グループは並べ替え不要', C.orderToFixShadowing([{name:'MAIN',count:5}], mk(5))===null);

  // ベース層の透過検出
  const tr = mk(12);
  tr[5].bindings[3] = '&trans';
  tr[5].bindings[9] = '&trans';
  const trs = C.findBaseTransIssues(groups, tr);
  t('先頭レイヤーの透過を検出', trs.length===1 && trs[0].groupName==='GEN' && JSON.stringify(trs[0].positions)==='[3,9]');
  t('レイヤー0は対象外', (()=>{ const x=mk(12); x[0].bindings[1]='&trans'; return C.findBaseTransIssues(groups,x).every(y=>y.layerIndex!==0); })());
  t('透過がなければ検出しない', C.findBaseTransIssues(groups, mk(12)).length===0);
}

/* ---------- 6.8 汎用配列変換 ---------- */
section('汎用配列変換');
{
  const conv = (b,f,to,sm,sink)=>C.convBindingLocale(b,f,to,sm,sink||(()=>{})).raw;
  t('ロケール一覧', C.LOCALE_LIST.length>=5 && C.LOCALE_LIST.map(l=>l.id).includes('dvorak'));
  t('同一ロケールは不変', conv('&kp AT_SIGN','us','us',true)==='&kp AT_SIGN');

  // --- 本質的な検証: 変換後に「同じ文字」が出るか ---
  // 変換前(from配列)で出る文字と、変換後(to配列)で出る文字が一致すべき
  function producedChar(binding, loc, shifted, morphs){
    const tk = binding.trim().split(/\s+/);
    if(tk[0].startsWith('&loc_')){
      const m = morphs[tk[0].slice(1)];
      if(!m) return null;
      const target = shifted? m.s : m.u;
      return C.charOfKeycode(target.trim().split(/\s+/).slice(1).join(''), loc);
    }
    if(tk[0]!=='&kp') return null;
    const kc = tk.slice(1).join('');
    if(shifted){
      // 素のキーにShiftを足したときの文字
      if(/^(LS|RS)\(/.test(kc)) return C.charOfKeycode(kc, loc); // すでにShift付き
      return C.charFor(C.canon(kc), loc, true);
    }
    return C.charOfKeycode(kc, loc);
  }
  const pairsToCheck = ['SQT','EQUAL','N2','MINUS','SEMI','GRAVE','LBKT','BSLH','RBKT','N7','N8','COMMA','DOT','FSLH','N1','N3'];
  let charNg = [];
  pairsToCheck.forEach(k=>{
    const morphs = {};
    const out = C.convBindingLocale('&kp '+k, 'us', 'jis', true, (n,m)=>{ morphs[n]=m; }).raw;
    [false,true].forEach(sh=>{
      const want = producedChar('&kp '+k, 'us', sh, {});
      const got  = producedChar(out, 'jis', sh, morphs);
      if(want && got && want!==got) charNg.push(`${k}${sh?'(Shift)':''}: ${want} → ${got}`);
    });
  });
  t('US→JIS: 変換後も同じ文字が出る', charNg.length===0, charNg.slice(0,4).join(' | '));

  // 汎用エンジンは既存実装より余計なmod-morphを作らないこと
  let extraMorph = [];
  ['&kp SQT','&kp EQUAL','&kp N2','&kp MINUS','&kp SEMI','&kp GRAVE','&kp LBKT','&kp BSLH','&kp RBKT'].forEach(b=>{
    const legacy = C.convBinding(b, null, true).raw.startsWith('&jis_');
    const generic = conv(b,'us','jis',true).startsWith('&loc_');
    if(generic && !legacy) extraMorph.push(b);
  });
  t('余計なmod-morphを作らない', extraMorph.length===0, extraMorph.join(','));

  // 読みやすい別名は保たれる(無意味な差分を出さない)
  t('同じ文字が出るキーは書き換えない', conv('&kp EXCLAMATION','us','jis',true)==='&kp EXCLAMATION'
    && conv('&kp HASH','us','jis',true)==='&kp HASH' && conv('&kp DLLR','us','jis',true)==='&kp DLLR');

  // 既存の US→JIS 実装と、記号の変換結果が一致すること
  let mismatch2 = [];
  ['&kp AT_SIGN','&kp CARET','&kp AMPERSAND','&kp ASTERISK','&kp LEFT_PARENTHESIS','&kp RIGHT_PARENTHESIS',
   '&kp UNDERSCORE','&kp PLUS','&kp LEFT_BRACE','&kp RIGHT_BRACE','&kp PIPE','&kp COLON','&kp DOUBLE_QUOTES','&kp TILDE'].forEach(b=>{
    const legacy = C.convBinding(b, null, true).raw;
    const generic = conv(b,'us','jis',true);
    if(legacy!==generic) mismatch2.push(b+': 既存='+legacy+' / 汎用='+generic);
  });
  t('既存US→JIS実装と一致(記号)', mismatch2.length===0, mismatch2.slice(0,3).join(' | '));

  // --- 文字配列(QWERTZ / Dvorak) ---
  t('QWERTZ: Y⇄Z', conv('&kp Y','us','de',false)==='&kp Z' && conv('&kp Z','us','de',false)==='&kp Y');
  t('QWERTZ: 他の文字は不変', conv('&kp A','us','de',false)==='&kp A' && conv('&kp Q','us','de',false)==='&kp Q');
  t('Dvorak: S→SEMI', conv('&kp S','us','dvorak',false)==='&kp SEMI');
  t('Dvorak: Q→X', conv('&kp Q','us','dvorak',false)==='&kp X');
  let dv = 0;
  'QWERTYUIOPASDFGHJKLZXCVBNM'.split('').forEach(c=>{
    if(conv(conv('&kp '+c,'us','dvorak',false),'dvorak','us',false)!=='&kp '+c) dv++;
  });
  t('Dvorak 文字26種が往復一致', dv===0, dv+'件不一致');

  // --- UK(ISO) ---
  t('UK: @ は Shift+SQT', conv('&kp AT_SIGN','us','uk',false)==='&kp LS(SQT)');
  t('UK: " は Shift+2', conv('&kp DQT','us','uk',false)==='&kp LS(N2)');
  t('UK: バックスラッシュはNUBS', conv('&kp BSLH','us','uk',false)==='&kp NUBS');

  // --- 変換できない文字は警告を出す(ドイツ語の ß は US に存在しない) ---
  const r = C.convBindingLocale('&kp MINUS','de','us',false,()=>{});
  t('変換不能時に警告を出す', r.warns.length>0, JSON.stringify(r));
  t('変換不能でもキーは壊さない', r.raw==='&kp MINUS', r.raw);
  // ` は US(素) から DE(Shift+EQUAL) へ変換できる
  t('DEへの記号変換', C.convBindingLocale('&kp GRAVE','us','de',false,()=>{}).raw==='&kp LS(EQUAL)');

  // --- ショートカットや非文字キーは触らない ---
  t('ショートカットは不変', conv('&kp LC(C)','us','jis',true)==='&kp LC(C)');
  t('レイヤー系は不変', conv('&lt 2 SPACE','us','jis',true)==='&lt 2 SPACE');
  t('透過は不変', conv('&trans','us','dvorak',true)==='&trans');
  t('矢印は不変', conv('&kp LEFT','us','jis',true)==='&kp LEFT');

  // --- 表示テーブルへの影響がないこと ---
  t('表示: us の A は A のまま', C.charFor('A','us',false)==='A' && C.charFor('A','us',true)==='A');
  t('表示: us の記号は従来どおり', C.charFor('N2','us',true)==='@' && C.charFor('LBKT','us',false)==='[');
  t('表示: jis の記号は従来どおり', C.charFor('N2','jis',true)==='"' && C.charFor('LBKT','jis',false)==='@');
  t('表示: de の Y は Z', C.charFor('Y','de',false)==='Z');
}

/* ---------- 6.85 OS互換テーブル ---------- */
section('OS互換(全OS対応)');
{
  t('OS一覧', C.OS_LIST.length===5 && C.OS_LIST.map(o=>o.id).join(',')==='win,mac,linux,ios,android');
  t('keycodesIn 単純', JSON.stringify(C.keycodesIn('&kp K_MUTE'))==='["K_MUTE"]');
  t('keycodesIn 修飾入れ子', JSON.stringify(C.keycodesIn('&kp LC(LA(K_NEXT))')).includes('K_NEXT'));
  t('keycodesIn mt', JSON.stringify(C.keycodesIn('&mt LSHIFT K_MUTE'))==='["LSHIFT","K_MUTE"]');
  // Windowsでは反応しないがLinuxでは動くもの
  t('K_MUTE: Winで問題', C.findOsIssues('&kp K_MUTE',['win']).length===1);
  t('K_MUTE: Linuxでは問題なし', C.findOsIssues('&kp K_MUTE',['linux']).length===0);
  t('K_MUTE: macでも問題なし', C.findOsIssues('&kp K_MUTE',['mac']).length===0);
  t('K_PLAY_PAUSE: Win/macで問題', C.findOsIssues('&kp K_PLAY_PAUSE',['win','mac']).length===1
    && C.findOsIssues('&kp K_PLAY_PAUSE',['win','mac'])[0].bad.length===2);
  // LinuxだけがOKなもの / Linuxが非対応なもの
  t('C_STOP: Winのみ非対応', JSON.stringify(C.findOsIssues('&kp C_STOP',['win','linux','android'])[0].bad)==='["win"]');
  t('SYSREQ: Linuxも非対応', C.findOsIssues('&kp SYSREQ',['linux']).length===1);
  t('INT7: Linux非対応/mac対応', C.findOsIssues('&kp INT7',['linux']).length===1 && C.findOsIssues('&kp INT7',['mac']).length===0);
  t('LANG6: Linux非対応', C.findOsIssues('&kp LANG6',['linux']).length===1);
  t('K_COPY: Linux以外で注意', C.findOsIssues('&kp K_COPY',['win','mac']).length===1 && C.findOsIssues('&kp K_COPY',['linux']).length===0);
  // 通常キーは誤検出しない
  t('通常キーは無警告', C.findOsIssues('&kp A',['win','mac','linux']).length===0
    && C.findOsIssues('&kp C_MUTE',['win','mac','linux','ios','android']).length===0
    && C.findOsIssues('&trans',['win']).length===0);
  // 置換
  t('fixOsIssues 置換', C.fixOsIssues('&kp K_MUTE',['win'])==='&kp C_MUTE');
  t('fixOsIssues 代替なしは不変', C.fixOsIssues('&kp SYSREQ',['linux'])==='&kp SYSREQ');
  t('fixOsIssues 対象外OSでは不変', C.fixOsIssues('&kp K_MUTE',['linux'])==='&kp K_MUTE');
  // テーブルの整合性
  const bad = Object.entries(C.OS_COMPAT).filter(([k,v])=>!Array.isArray(v.s) || v.s.length!==5 || !v.why);
  t('テーブルの形式が揃っている', bad.length===0, JSON.stringify(bad.slice(0,2)));
  const selfAlt = Object.entries(C.OS_COMPAT).filter(([k,v])=>v.alt===k);
  t('代替が自分自身になっていない', selfAlt.length===0);
  // 代替キーは「どのOSでも悪化させず、いずれかのOSで改善する」こと
  const altCheck = Object.entries(C.OS_COMPAT).filter(([k,v])=>{
    if(!v.alt) return false;
    const a = C.OS_COMPAT[v.alt];
    const as = a? a.s : [1,1,1,1,1]; // 表にない = 全OS対応
    const worse  = v.s.some((x,i)=> x===1 && as[i]===0);      // 動いていたのに壊れる
    const better = v.s.some((x,i)=> x===0 && as[i]!==0);      // 壊れていたのが直る
    return worse || !better;
  });
  t('代替キーが改善になっている', altCheck.length===0, JSON.stringify(altCheck.slice(0,2)));
}

/* ---------- 6.9 Win⇄Mac変換 ---------- */
section('日本語入力キーのOS対応');
{
  // 出典: https://zmk.dev/docs/keymaps/list-of-keycodes
  // 列は Windows / Linux / Android / macOS / iOS の順。本ツールは win,mac,linux,ios,android の順で持つ。
  const want = {
    INT_HENKAN:   {win:0, mac:1, linux:1, android:0},
    INT_MUHENKAN: {win:0, mac:1, linux:1, android:0},
    INT_KANA:     {win:0, mac:1, linux:1, android:0},
    LANG1:        {win:1, mac:1, linux:1, android:0},
    LANG2:        {win:1, mac:1, linux:1, android:0},
    LANG3:        {win:0, mac:1, linux:1, android:0},
    LANG4:        {win:0, mac:1, linux:1, android:0},
    LANG5:        {win:0, mac:1, linux:1, android:0}
  };
  Object.keys(want).forEach(k=>{
    const e = C.OS_COMPAT[k];
    t('対応表に載っている: '+k, !!e);
    if(e) Object.keys(want[k]).forEach(os=>{
      t(`${k} の ${os} が公式資料と一致`, e.s[C.OS_INDEX[os]]===want[k][os],
        `${e.s[C.OS_INDEX[os]]} (期待 ${want[k][os]})`);
    });
  });

  // Windows向けの検出と置き換え
  t('変換キーがWindowsで検出される', C.findOsIssues('&kp INT_HENKAN',['win']).length===1);
  t('別名(INT4)でも検出される', C.findOsIssues('&kp INT4',['win']).length===1);
  t('別名(INTERNATIONAL_4)でも検出される', C.findOsIssues('&kp INTERNATIONAL_4',['win']).length===1);
  t('LANG1はWindowsで検出されない', C.findOsIssues('&kp LANG1',['win']).length===0);
  t('別名(LANGUAGE_1)でも検出されない', C.findOsIssues('&kp LANGUAGE_1',['win']).length===0);
  t('LANG1はAndroidで検出される', C.findOsIssues('&kp LANG1',['android']).length===1);
  t('変換キーはmacOSでは検出されない', C.findOsIssues('&kp INT_HENKAN',['mac']).length===0);
  t('変換 → LANG1 に置き換えられる', C.fixOsIssues('&kp INT_HENKAN',['win'])==='&kp LANG1',
    C.fixOsIssues('&kp INT_HENKAN',['win']));
  t('無変換 → LANG2 に置き換えられる', C.fixOsIssues('&kp INT_MUHENKAN',['win'])==='&kp LANG2');
  t('ホールドタップの中でも置き換わる',
    C.fixOsIssues('&lt_to_layer_0 6 INT_HENKAN',['win'])==='&lt_to_layer_0 6 LANG1',
    C.fixOsIssues('&lt_to_layer_0 6 INT_HENKAN',['win']));
  t('置き換え後は問題が消える', C.findOsIssues(C.fixOsIssues('&kp INT_HENKAN',['win']),['win']).length===0);
  t('LANG3は代替を持たない(意味が違うため)', !C.OS_COMPAT.LANG3.alt);

  // Win⇄Mac変換では触らない(動くキーを動かないキーに変えないため)
  ['&kp INT_HENKAN','&kp INT_MUHENKAN','&kp LANG1','&kp LANG2','&kp LANGUAGE_1'].forEach(b=>{
    t('OS変換では触らない: '+b,
      C.convBindingPlatform(b,'win2mac').raw===b && C.convBindingPlatform(b,'mac2win').raw===b,
      C.convBindingPlatform(b,'mac2win').raw);
  });
  t('変換表から日本語入力の対応が消えている',
    !C.PLATFORM_PAIRS.some(([w,m])=>/INT_HENKAN|INT_MUHENKAN|LANG1|LANG2/.test(w+m)));

  // 別名の正規化
  t('INT4 と INT_HENKAN が同じ', C.canon('INT4')===C.canon('INT_HENKAN'));
  t('INT5 と INT_MUHENKAN が同じ', C.canon('INT5')===C.canon('INT_MUHENKAN'));
  t('INT2 と INT_KANA が同じ', C.canon('INT2')===C.canon('INT_KANA'));
  t('LANG_HANGEUL と LANG1 が同じ', C.canon('LANG_HANGEUL')===C.canon('LANG1'));
  t('LANGUAGE_3 と LANG3 が同じ', C.canon('LANGUAGE_3')===C.canon('LANG3'));

  // 既定のキーマップは変換/無変換を使っている → Windows利用者に知らせられること
  {
    const st = C.parseKeymap(C.DEFAULT_KEYMAP);
    const hits = st.layers.flatMap(l=>l.bindings).filter(b=>C.findOsIssues(b,['win']).length);
    t('既定キーマップのWindows非対応キーを検出できる', hits.length>0, hits.slice(0,3).join(' / '));
  }
}

section('Win⇄Mac変換');
{
  const cases = [
    ['&kp LC(C)','&kp LG(C)','コピー'],
    ['&kp HOME','&kp LG(LEFT)','行頭'],
    ['&kp END','&kp LG(RIGHT)','行末'],
    ['&kp LC(LEFT)','&kp LA(LEFT)','単語移動'],
    ['&kp LC(HOME)','&kp LG(UP)','文書先頭'],
    ['&kp LA(TAB)','&kp LG(TAB)','アプリ切替'],
    ['&kp LA(F4)','&kp LG(Q)','終了'],
    ['&kp LCTRL','&kp LGUI','主修飾'],
    ['&mt LCTRL A','&mt LGUI A','ホールド修飾'],
    ['&kp LS(LG(S))','&kp LG(LS(N4))','スクショ'],
  ];
  cases.forEach(([w,m,name])=>{
    t('win2mac '+name, C.convBindingPlatform(w,'win2mac').raw===m, C.convBindingPlatform(w,'win2mac').raw);
    t('mac2win '+name, C.convBindingPlatform(m,'mac2win').raw===w, C.convBindingPlatform(m,'mac2win').raw);
  });
  t('非対象は不変', C.convBindingPlatform('&kp A','win2mac').raw==='&kp A' && C.convBindingPlatform('&trans','win2mac').raw==='&trans');
  t('レイヤー系は不変', C.convBindingPlatform('&lt 2 SPACE','win2mac').raw==='&lt 2 SPACE');
  // 全パターンの往復一致
  let ng=0;
  C.PLATFORM_PAIRS.forEach(([w,m])=>{
    if(w.startsWith('&mt ')) return;
    if(C.convBindingPlatform(C.convBindingPlatform(w,'win2mac').raw,'mac2win').raw!==w) ng++;
    if(C.convBindingPlatform(C.convBindingPlatform(m,'mac2win').raw,'win2mac').raw!==m) ng++;
  });
  t('全ペアが往復一致', ng===0, ng+'件不一致');
}

/* ---------- 6.95 多言語対応 ---------- */
section('キーコードの別名(回帰)');
{
  // ZMKは同じキーに複数の書き方がある。実際の設定ファイルは長い別名を使うことが多く、
  // 以前はそれが変換表と文字列一致せず、変換されずに素通りしていた。
  t('canonBinding が別名を揃える',
    C.canonBinding('&kp LANGUAGE_1')===C.canonBinding('&kp LANG1'));
  t('canonBinding が修飾ラッパを壊さない',
    C.canonBinding('&kp LC(LS(N2))')==='&kp LC(LS(N2))', C.canonBinding('&kp LC(LS(N2))'));
  t('canonBinding がレイヤー番号を壊さない', C.canonBinding('&lt 3 SPACE')==='&lt 3 SPACE');
  t('canonBinding が空でも落ちない', C.canonBinding('')==='' && C.canonBinding(null)==='');

  const pairs = [
    ['&kp LEFT_WIN',     'mac2win', '&kp LCTRL'],
    ['&kp LEFT_GUI',     'mac2win', '&kp LCTRL'],
    ['&kp LGUI',         'mac2win', '&kp LCTRL'],
    ['&kp LEFT_CONTROL', 'win2mac', '&kp LGUI'],
    ['&kp LCTRL',        'win2mac', '&kp LGUI'],
    ['&kp RIGHT_WIN',    'mac2win', '&kp RCTRL']
  ];
  pairs.forEach(([b, d, want])=>{
    const got = C.convBindingPlatform(b, d).raw;
    t(`別名でも変換される: ${b} (${d})`, got===want, got);
  });

  // 別名でも &mt のパラメータ形が保たれる
  t('&mt の別名とパラメータ', C.convBindingPlatform('&mt LEFT_CONTROL A','win2mac').raw==='&mt LGUI A',
    C.convBindingPlatform('&mt LEFT_CONTROL A','win2mac').raw);

  // 変換してはいけないもの
  ['&kp A','&kp LS(N2)','&mo 3','&trans','&none','&bt BT_SEL 0','&kp ESCAPE',
   '&kp LANG1','&kp LANG2','&kp LANGUAGE_1','&kp INT_HENKAN','&kp INT_MUHENKAN'].forEach(b=>{
    t('変換対象外はそのまま: '+b,
      C.convBindingPlatform(b,'win2mac').raw===b && C.convBindingPlatform(b,'mac2win').raw===b);
  });

  // 別名を使ったコンボも環境依存として拾えるか
  {
    // 基準は最初の環境。LANGUAGE_1 は macOS 側の書き方なので mac→win で変換される
    const g = [{name:'MAC',count:2,locale:'jis',platform:'mac'},
               {name:'WIN',count:2,locale:'jis',platform:'win'}];
    const iss = C.findComboEnvIssues(g, [{name:'cmd', binding:'&kp LEFT_WIN', keyPositions:[1,2], layers:[]}]);
    t('別名のコンボもOS差を検出する', iss.length===1, JSON.stringify(iss));
    t('検出結果がWindows側の修飾キーになる',
      iss.length===1 && iss[0].diffs[0].binding==='&kp LCTRL', iss.length? iss[0].diffs[0].binding : '');
  }
}

section('OSの系統(iOS / Linux / Android)');
{
  // ショートカットの体系は Ctrl系(Windows/Linux/Android) と Cmd系(macOS/iOS) の2つ
  t('系統の割り当てが揃っている',
    C.OS_FAMILY.win==='ctrl' && C.OS_FAMILY.linux==='ctrl' && C.OS_FAMILY.android==='ctrl'
    && C.OS_FAMILY.mac==='cmd' && C.OS_FAMILY.ios==='cmd');
  t('全OSに系統がある', C.OS_LIST.every(o=>!!C.OS_FAMILY[o.id]),
    C.OS_LIST.filter(o=>!C.OS_FAMILY[o.id]).map(o=>o.id).join(','));

  const dir = C.platformDir;
  t('Ctrl系 → Cmd系 は win2mac', dir('win','mac')==='win2mac' && dir('linux','ios')==='win2mac'
    && dir('android','mac')==='win2mac');
  t('Cmd系 → Ctrl系 は mac2win', dir('mac','win')==='mac2win' && dir('ios','linux')==='mac2win');
  t('同じ系統なら変換しない', dir('win','linux')===null && dir('mac','ios')===null
    && dir('linux','android')===null && dir('win','win')===null);
  t('未設定なら変換しない', dir(null,'mac')===null && dir('win',null)===null && dir(null,null)===null);
  t('知らないOSでも落ちない', dir('win','bsd')===null);

  // iPad(iOS)への変換
  const toIos = (b)=>C.convBindingFull(b, null, null, 'win', 'ios', false, null, null);
  t('Windows → iPad でCtrlがCmdになる', toIos('&kp LC(C)').raw==='&kp LG(C)', toIos('&kp LC(C)').raw);
  t('Windows → iPad で行頭がCmd+←になる', toIos('&kp HOME').raw==='&kp LG(LEFT)');
  t('Linux → iPad も同じ結果',
    C.convBindingFull('&kp HOME', null, null, 'linux', 'ios', false, null, null).raw==='&kp LG(LEFT)');

  // iPadでは通用しない操作に注意書きが出る
  t('アプリの終了はiPadで注意が出る', toIos('&kp LA(F4)').warns.length===1, JSON.stringify(toIos('&kp LA(F4)').warns));
  t('スクショはiPadで注意が出る', toIos('&kp PSCRN').warns.length===1);
  t('macOSでは注意が出ない',
    C.convBindingFull('&kp LA(F4)', null, null, 'win', 'mac', false, null, null).warns.length===0);
  t('注意が出ても変換自体は行う', toIos('&kp LA(F4)').raw==='&kp LG(Q)');
  t('通常のショートカットには注意が出ない', toIos('&kp LC(C)').warns.length===0);

  // 同じ系統では何も起きない
  ['&kp LC(C)','&kp HOME','&kp LA(TAB)','&kp PSCRN'].forEach(b=>{
    t('Windows → Linux は不変: '+b,
      C.convBindingFull(b, null, null, 'win', 'linux', false, null, null).raw===b);
    t('macOS → iPad は不変: '+b,
      C.convBindingFull(b, null, null, 'mac', 'ios', false, null, null).raw===b);
  });

  // 往復
  ['&kp LC(C)','&kp HOME','&kp END','&kp LC(LEFT)','&kp LCTRL','&mt LCTRL A'].forEach(b=>{
    const there = C.convBindingFull(b, null, null, 'win', 'ios', false, null, null).raw;
    const back  = C.convBindingFull(there, null, null, 'ios', 'win', false, null, null).raw;
    t('Windows⇄iPad で往復する: '+b, back===b, there+' → '+back);
  });

  // 配列とOSを同時に変換しても壊れない
  {
    const r = C.convBindingFull('&kp LS(SQT)', 'us', 'jis', 'win', 'ios', false, null, null);
    t('配列とOSを同時に変換できる', !!r.raw && !/undefined|NaN/.test(r.raw), r.raw);
  }

  // UI
  t('OS選択肢が全OSから作られる', ui.includes('OS_LIST.map(o=>`<option value="${o.id}">'));
  t('同期の判定が系統ベース', ui.includes('!platformDir(srcOs, dstOs)'));
  t('系統が同じ場合の案内がある', ui.includes('ショートカットの体系が同じため'));
}

section('環境の設定チップ');
{
  t('一覧にチップを出す', ui.includes("chip.className = 'envchip'"));
  t('チップは短縮名を使う', ui.includes('envSummary(gi, true)'));
  t('ツールチップは正式名を使う', ui.includes('envSummary(gi).text'));
  t('単一環境では隠す', ui.includes("if(simple) chip.style.display = 'none';"));
  t('チップのスタイルがある', html.includes('.envchip{'));
  t('未設定は破線で示す', html.includes('.envchip.unset{'));
  t('ヘルプに記載がある', html.includes('<dt>環境の設定を変える</dt>'));
  t('英訳がある', scripts[0][1].includes("'環境の設定':'"));

  // envSummary は state に依存するので、同じ組み立てを再現して確かめる
  const label = (loc, os)=>{
    const full = loc? ((C.LOCALE_LIST.find(l=>l.id===loc)||{}).name || loc) : null;
    const ln = full? full.replace(/\s*[（(].*$/, '') : null;
    const on = os? C.osName(os) : null;
    if(ln && on) return ln+' × '+on;
    return ln || on || '配列 / OS を設定';
  };
  t('両方あると「配列 × OS」', label('jis','win')==='JIS × Windows', label('jis','win'));
  t('チップでは補足の括弧を落とす', label('us',null)==='US' && label('de',null)==='DE', label('de',null));
  t('括弧のない配列名はそのまま', label('dvorak',null)==='Dvorak');
  t('OSだけならOS名', label(null,'ios')==='iOS', label(null,'ios'));
  t('どちらもなければ促す', label(null,null)==='配列 / OS を設定');
  t('osName が全OSを引ける', C.OS_LIST.every(o=>C.osName(o.id)===o.name));
  t('osName は未知でも落ちない', C.osName('bsd')==='bsd' && C.osName(null)==='');
}

section('多言語対応(i18n)');
{
  t('辞書が十分な語数', Object.keys(C.I18N_EN).length >= 150, Object.keys(C.I18N_EN).length+'語');
  C.setLang('ja');
  t('日本語モードは無変換', C.tr('保存')==='保存');
  C.setLang('en');
  t('英訳される', C.tr('保存')==='Save' && C.tr('レイヤー')==='Layer');
  t('未登録は原文のまま', C.tr('登録されていない文言')==='登録されていない文言');
  t('前後の空白を保持', C.tr(' 保存 ')===' Save ');
  t('nullでも落ちない', C.tr(null)===null);
  // 訳語の重複や空欄がないか
  const empties = Object.entries(C.I18N_EN).filter(([k,v])=>!v || !k);
  t('空の訳がない', empties.length===0, JSON.stringify(empties.slice(0,3)));
  const nonAscii = Object.values(C.I18N_EN).filter(v=>/[ぁ-んァ-ヶ一-龠]/.test(v));
  t('訳文に日本語が残っていない', nonAscii.length===0, JSON.stringify(nonAscii.slice(0,3)));
  C.setLang('ja');
}

/* ---------- 6.97 ヘルプ英訳 ---------- */
section('ヘルプ英訳');
{
  const helpEn = ui.match(/const HELP_EN = \{[\s\S]*?\n\};/);
  t('HELP_EN が定義されている', !!helpEn);
  ['hp-about','hp-ops','hp-zmk','hp-tool'].forEach(id=>{
    t('英語版 '+id, helpEn && helpEn[0].includes("'"+id+"'"));
  });
  t('英語版に日本語が混ざっていない', helpEn && !/[ぁ-んァ-ヶ一-龠]/.test(
    helpEn[0].replace(/^const HELP_EN = \{/,'').replace(/\};$/,'')
      .replace(/'hp-[a-z]+':/g,'')), '要確認');
  t('applyHelpLang がある', ui.includes('function applyHelpLang'));
}

/* ---------- 7. バージョン/プロファイル ---------- */
section('想定利用の通し確認');
{
  /* ベースを1つ作り、環境を足して同じ操作感を得る、という本ツールの中心的な使い方を
     最初から最後まで動かす。
       ベース = JIS × Windows / 追加 = US × macOS、US × iPadOS */
  const raw = C.DEFAULT_KEYMAP;
  const st = C.parseKeymap(raw);
  st.originalText = raw;
  st.combos = C.parseCombos(raw);
  st.behaviors = C.parseBehaviors(raw);
  st.macros = C.parseMacros(raw);
  const baseCount = 5, genCount = st.layers.length - baseCount;
  st.groups = [{name:'WIN', count:baseCount, locale:'jis', platform:'win'},
               {name:'GEN', count:genCount,  locale:null,  platform:null}];
  st.layers[0].shiftLayer = true;
  const KEYS = st.layers[0].bindings.length;

  function addEnv(name, locale, platform, srcGi){
    const g = C.groupRanges(st.groups)[srcGi];
    const srcLoc = C.localeOfGroup(st.groups, srcGi), srcOs = C.platformOfGroup(st.groups, srcGi);
    const offsetMap = C.buildEnvOffsetMap(g, {start:st.layers.length, count:g.count});
    const morphs = {}, used = new Set(), warns = new Set();
    for(let k=0;k<g.count;k++){
      const S = st.layers[g.start+k];
      const bindings = S.bindings.map(b=>{
        const r = C.convBindingFull(b, srcLoc, locale, srcOs, platform, !!S.shiftLayer,
          (nm,m)=>{morphs[nm]=m;}, offsetMap);
        r.warns.forEach(w=>warns.add(w));
        if(r.raw.startsWith('&loc_')) used.add(r.raw.slice(1));
        return r.raw;
      });
      st.layers.push({name:S.name, displayName:null, bindings, sensor:S.sensor, shiftLayer:!!S.shiftLayer});
    }
    st.groups.push({name, count:g.count, locale, platform});
    used.forEach(nm=>{
      const m = morphs[nm];
      if(m && !st.behaviors.morphs.some(x=>x.name===nm))
        st.behaviors.morphs.push({name:nm, b1:m.u, b2:m.s, mods:['MOD_LSFT','MOD_RSFT'], keepMods:[]});
    });
    return {used, warns};
  }

  const macStart = st.layers.length;
  const mac = addEnv('MAC','us','mac',0);
  const ipadStart = st.layers.length;
  addEnv('IPAD','us','ios',0);

  t('環境が3つ + 共通層になった', st.groups.length===4, st.groups.map(g=>g.name).join(','));
  t('レイヤー数が想定どおり', st.layers.length === baseCount+genCount+baseCount*2, String(st.layers.length));
  t('JIS→US変換でmod-morphが生成された', mac.used.size>0, [...mac.used].join(',')||'0件');
  t('生成したmod-morphが登録されている',
    [...mac.used].every(nm=>st.behaviors.morphs.some(m=>m.name===nm)));

  // macOS と iPadOS は同じ系統。自環境内の参照の差を除けば配置は一致する
  // 自環境内を指す参照だけ相対番号に直す(共通層への参照はそのまま比べる)。
  // 対象は本体と同じ WITHIN_ENV_REFS を使う(&lt_to_layer_0 のような独自ビヘイビアも拾う)
  const rel = (arr, base)=>arr.map(b=>{
    const m = b.trim().match(/^(&\S+)\s+(\d+)(.*)$/);
    if(!m || !C.WITHIN_ENV_REFS.includes(m[1])) return b;
    const v = Number(m[2]);
    return (v>=base && v<base+baseCount)? `${m[1]} 自${v-base}${m[3]}` : b;
  });
  const macB  = rel(st.layers.slice(macStart,  macStart+baseCount ).flatMap(l=>l.bindings), macStart);
  const ipadB = rel(st.layers.slice(ipadStart, ipadStart+baseCount).flatMap(l=>l.bindings), ipadStart);
  t('macOSとiPadOSで配置が一致する', JSON.stringify(macB)===JSON.stringify(ipadB),
    macB.filter((b,i)=>b!==ipadB[i]).slice(0,2).join(' / '));
  t('レイヤー番号は環境ごとにずれている',
    JSON.stringify(st.layers.slice(macStart, macStart+baseCount).flatMap(l=>l.bindings))
    !== JSON.stringify(st.layers.slice(ipadStart, ipadStart+baseCount).flatMap(l=>l.bindings)));
  t('レイヤー参照がすべて有効な範囲',
    st.layers.every(l=>l.bindings.every(b=>{
      const tk = b.trim().split(/\s+/);
      if(!['&mo','&lt','&tog','&sl','&to'].includes(tk[0])) return true;
      const n = Number(tk[1]);
      return !isNaN(n) && n>=0 && n<st.layers.length;
    })));

  // コンボを環境ごとに分ける
  const comboIssues = C.findComboEnvIssues(st.groups, st.combos);
  comboIssues.slice().reverse().forEach(x=>{
    const parts = C.splitComboForEnvs(st.combos[x.ci], st.groups);
    if(parts) st.combos.splice(x.ci, 1, ...parts);
  });
  t('分割後は環境依存のコンボが残らない', C.findComboEnvIssues(st.groups, st.combos).length===0);
  t('コンボ名が重複しない', new Set(st.combos.map(c=>c.name)).size===st.combos.length);

  // OS互換チェック(Windows)
  const scan = os=>{
    const hits=[];
    st.layers.forEach((l,li)=>l.bindings.forEach((b,ki)=>{
      if(C.findOsIssues(b,[os]).length) hits.push({li,ki,b});
    }));
    return hits;
  };
  const bad = scan('win');
  t('Windows非対応キーを検出できる', bad.length>0, bad.length+'箇所');
  bad.forEach(h=>{ st.layers[h.li].bindings[h.ki] = C.fixOsIssues(h.b,['win']); });
  t('一括置換で問題が解消する', scan('win').length===0, scan('win').length+'箇所残');
  t('置換してもキー数は変わらない', st.layers.every(l=>l.bindings.length===KEYS));

  // 書き出しと読み直し
  let out='';
  try{ out = C.generateKeymap(st); }catch(e){ t('書き出しで例外が出ない', false, e.message); }
  t('.keymap を書き出せる', out.length>0);
  t('3環境ぶんのノードが入っている', /WIN_/.test(out) && /MAC_/.test(out) && /IPAD_/.test(out));
  {
    const gen = st.layers.flatMap(l=>l.bindings).join(' ');
    t('壊れたバインディングがない', !/undefined|NaN|&&/.test(gen),
      (gen.match(/\S*(?:undefined|NaN)\S*/)||[''])[0]);
    t('すべてのバインディングが & で始まる',
      st.layers.every(l=>l.bindings.every(b=>/^&\w/.test(b.trim()))));
  }
  if(out){
    const re = C.parseKeymap(out);
    t('読み直してレイヤー数が一致', re.layers.length===st.layers.length, re.layers.length+' vs '+st.layers.length);
    t('読み直して配置が一致',
      JSON.stringify(re.layers.map(l=>l.bindings))===JSON.stringify(st.layers.map(l=>l.bindings)));
    t('読み直してコンボが一致', C.parseCombos(out).length===st.combos.length);
  }

  // 共通層(GEN)が環境より前にあるため、後ろの環境から呼ぶと隠れる
  const shadow = C.findShadowedRefs(st.groups, st.layers);
  t('隠れる参照を検出する', shadow.length>0, JSON.stringify(shadow.map(x=>`${x.groupName}→fw${x.target}`)));
  if(shadow.length){
    const order = C.orderToFixShadowing(st.groups, st.layers);
    t('並べ替え案が出る', Array.isArray(order) && order.length===st.groups.length, JSON.stringify(order));
    t('共通層が最後に回る', order[order.length-1]===1, JSON.stringify(order));
  }
}

section('画面部品の不変条件');
{
  /* 個別に「このidがある」と並べる代わりに、まとめて次を確かめる。
     ・コードが参照するidは、すべてHTMLに実在する(書き忘れと取り違えの両方を検出)
     ・idは重複しない(重複すると getElementById が思わぬ方を返す)
     これだけで全部品を覆えるので、部品を足しても手入れが要らない。 */
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const known = new Set(ids);

  const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  t('idが重複していない', dup.length === 0, dup.join(','));

  const refs = [...new Set([...html.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]))];
  const missingRefs = refs.filter(r => !known.has(r));
  t('参照しているidがすべて実在する', missingRefs.length === 0, missingRefs.join(','));
  t('参照が十分な数ある(検査が空振りしていない)', refs.length > 100, String(refs.length));

  const modals = [...new Set([...html.matchAll(/closeModal\('([^']+)'\)/g)].map(m => m[1]))];
  const missingModals = modals.filter(r => !known.has(r));
  t('closeModal の対象がすべて実在する', missingModals.length === 0, missingModals.join(','));

  const sel = [...new Set([...html.matchAll(/querySelector(?:All)?\('#([\w-]+)'\)/g)].map(m => m[1]))];
  const missingSel = sel.filter(r => !known.has(r));
  t('querySelector の #id もすべて実在する', missingSel.length === 0, missingSel.join(','));

  // 開けるダイアログには閉じる手段があること。
  // 閉じ方は closeModal() と classList.remove('open') の2通りがあるので、どちらでも可とする。
  const opened = [...new Set([...html.matchAll(/getElementById\('([\w-]+)'\)\.classList\.add\('open'\)/g)].map(m => m[1]))];
  const closable = id => html.includes(`closeModal('${id}')`)
    || html.includes(`getElementById('${id}').classList.remove('open')`);
  const noClose = opened.filter(id => !closable(id));
  t('開くダイアログには閉じる手段がある', noClose.length === 0, noClose.join(','));
  t('ダイアログが十分な数ある', opened.length > 8, String(opened.length));
}

section('整合性チェック');
{
  /* 書き出し前の最後の砦。「問題があるのに出ない」と「正常なのに出る」の
     どちらも困るので、両方向を確かめる。 */
  const base = ()=>{
    const st = C.parseKeymap(C.DEFAULT_KEYMAP);
    st.originalText = C.DEFAULT_KEYMAP;
    st.combos = C.parseCombos(C.DEFAULT_KEYMAP);
    st.behaviors = C.parseBehaviors(C.DEFAULT_KEYMAP);
    st.macros = C.parseMacros(C.DEFAULT_KEYMAP);
    st.condLayers = C.parseCondLayers(C.DEFAULT_KEYMAP);
    st.trackball = C.parseTrackball(C.DEFAULT_KEYMAP);
    st.groups = [{name:'MAIN', count:st.layers.length, locale:'us', platform:'mac'}];
    return st;
  };
  const has = (list, word)=>list.some(x=>x.includes(word));

  // 素の状態では騒がない(誤検出しないこと)
  {
    const st = base();
    const v = C.runValidation(st, ['mac']);
    t('正常な設定では存在しない参照を指摘しない', !has(v,'存在しないレイヤー'), v.join(' / ').slice(0,120));
    t('正常な設定では未定義ビヘイビアを指摘しない', !has(v,'未定義のビヘイビア'), v.join(' / ').slice(0,120));
    t('単一環境では順序を指摘しない', !has(v,'無視され'));
    t('単一環境では透過を指摘しない', !has(v,'透過'));
  }

  // 存在しないレイヤーへの参照
  {
    const st = base();
    st.layers[0].bindings[0] = '&mo 99';
    t('存在しないレイヤーを指摘する', has(C.runValidation(st,['mac']),'存在しないレイヤー'));
  }
  // 未定義のビヘイビア
  {
    const st = base();
    st.layers[0].bindings[1] = '&no_such_behavior';
    const v = C.runValidation(st,['mac']);
    t('未定義のビヘイビアを指摘する', has(v,'未定義のビヘイビア'), v.join(' / ').slice(0,120));
  }
  {
    // 自作の定義は未定義扱いしない
    const st = base();
    st.behaviors.morphs.push({name:'my_morph', b1:'&kp A', b2:'&kp B', mods:[], keepMods:[]});
    st.layers[0].bindings[1] = '&my_morph';
    t('自作の定義は未定義扱いしない', !has(C.runValidation(st,['mac']),'未定義のビヘイビア'));
  }
  {
    // 原文のまま残した定義(raws)も未定義扱いしない
    const st = base();
    st.behaviors.raws.push({name:'raw_beh', text:'raw_beh: raw_beh {};'});
    st.layers[0].bindings[1] = '&raw_beh';
    t('原文のまま残した定義も未定義扱いしない', !has(C.runValidation(st,['mac']),'未定義のビヘイビア'));
  }
  // コンボ
  {
    const st = base();
    st.combos.push({name:'x', binding:'&kp A', keyPositions:[0,1], layers:[]});
    st.combos.push({name:'y', binding:'&kp B', keyPositions:[1,0], layers:[]});
    t('キー位置が同じコンボを指摘する', has(C.runValidation(st,['mac']),'重複'));
  }
  {
    const st = base();
    st.combos.push({name:'z', binding:'&kp A', keyPositions:[0, 999], layers:[]});
    t('範囲外のキー位置を指摘する', has(C.runValidation(st,['mac']),'範囲外'));
  }
  {
    const st = base();
    st.combos.push({name:'w', binding:'&kp A', keyPositions:[5,6], layers:[99]});
    t('コンボの存在しないレイヤー指定を指摘する', has(C.runValidation(st,['mac']),'存在しないレイヤー'));
  }
  // 定義の中身が未設定
  {
    const st = base();
    st.behaviors.morphs.push({name:'broken', b1:'', b2:'', mods:[], keepMods:[]});
    t('中身のないmod-morphを指摘する', has(C.runValidation(st,['mac']),'動作が未設定'));
  }
  {
    const st = base();
    st.behaviors.tds.push({name:'td1', term:200, bindings:['&kp A']});
    t('タップ動作が足りないtap-danceを指摘する', has(C.runValidation(st,['mac']),'2つ未満'));
  }
  {
    const st = base();
    st.macros.items.push({name:'m0', steps:[]});
    t('中身のないマクロを指摘する', has(C.runValidation(st,['mac']),'ステップがありません'));
  }
  // トラックボール
  {
    const st = base();
    st.trackball = {automouseLayer:99, scrollLayers:[], snipeLayers:[]};
    t('トラックボールの範囲外レイヤーを指摘する', has(C.runValidation(st,['mac']),'トラックボール'));
  }
  // OS互換
  {
    const st = base();
    st.layers[0].bindings[2] = '&kp K_MUTE';
    const v = C.runValidation(st,['win']);
    t('Windowsで反応しないキーを指摘する', has(v,'反応しません'), v.join(' / ').slice(0,150));
    t('対象OSを外せば指摘しない', !has(C.runValidation(st,['linux']),'K_MUTE'));
    t('対象OS未指定でも既定で点検する', C.runValidation(st, []).length >= 1);
  }
  // 環境まわり
  {
    const st = base();
    st.groups = [{name:'A', count:3, locale:'us', platform:'win'},
                 {name:'B', count:st.layers.length-3, locale:'jis', platform:'win'}];
    st.layers[3].bindings[0] = '&mo 1';   // 後ろの環境から前を呼ぶ
    t('隠れるレイヤー参照を指摘する', has(C.runValidation(st,['win']),'無視され'));
  }
  {
    const st = base();
    st.groups = [{name:'A', count:3}, {name:'B', count:st.layers.length-3}];
    st.layers[3].bindings = st.layers[3].bindings.map(()=>'&trans');
    t('2つ目の環境の先頭が透過だと指摘する', has(C.runValidation(st,['win']),'透過'));
  }
  {
    const st = base();
    st.groups = [{name:'US', count:2, locale:'us', platform:'win'},
                 {name:'JIS', count:st.layers.length-2, locale:'jis', platform:'win'}];
    st.combos.push({name:'dq', binding:'&kp LS(SQT)', keyPositions:[10,11], layers:[]});
    t('環境で変わるコンボを指摘する', has(C.runValidation(st,['win']),'別の入力になります'));
  }
  {
    const st = base();
    st.groups = [{name:'US', count:2, locale:'us', platform:'win'},
                 {name:'JIS', count:st.layers.length-2, locale:'jis', platform:'win'}];
    st.behaviors.morphs.push({name:'q', b1:'&kp SQT', b2:'&kp DQT', mods:[], keepMods:[]});
    st.layers[0].bindings[0] = '&q';
    st.layers[2].bindings[0] = '&q';
    t('環境で変わる自作定義を指摘する', has(C.runValidation(st,['win']),'別の入力になります'));
  }
  // 指摘は文章として読める形で返る
  {
    const st = base();
    st.layers[0].bindings[0] = '&mo 99';
    const v = C.runValidation(st,['win']);
    t('指摘は文字列の配列', Array.isArray(v) && v.every(x=>typeof x==='string'));
    t('指摘に空文字が混じらない', v.every(x=>x.trim().length>0));
    t('指摘にレイヤー名が入る', v.some(x=>/MAIN_\d\d/.test(x)), v[0]);
  }
}

section('壊れた入力への耐性');
{
  /* 利用者が誤ったファイルを選ぶのは普通に起きる。落ちずに理由を返すこと。 */
  const bad = ['', '   ', 'hello world', '{}', '<html></html>',
    '/ { keymap {', 'keymap { compatible = "zmk,keymap";',
    '\0\0\0', 'キーマップ', '{"json":true}'];
  bad.forEach(x=>{
    let r, threw = false;
    try{ r = C.parseKeymap(x); }catch(e){ threw = true; }
    t('壊れた入力で落ちない: '+JSON.stringify(x.slice(0,14)), !threw);
    t('壊れた入力は理由を返す: '+JSON.stringify(x.slice(0,14)), !threw && !!r && !!r.error);
  });
  t('途中で切れたkeymapを検出する', !!C.parseKeymap('/ { keymap { compatible="zmk,keymap"; x { bindings = <&kp A').error);
  t('レイヤーのないkeymapでも落ちない', (()=>{
    let ok = true;
    try{ C.parseKeymap('/ { keymap { compatible = "zmk,keymap"; }; };'); }catch(e){ ok = false; }
    return ok;
  })());

  // 付随するパーサも壊れた入力で落ちないこと
  ['', 'garbage', 'combos {', 'behaviors { x: y {'].forEach(x=>{
    let ok = true;
    try{ C.parseCombos(x); C.parseBehaviors(x); C.parseMacros(x); C.parseCondLayers(x); C.parseTrackball(x); }
    catch(e){ ok = false; }
    t('付随するパーサも落ちない: '+JSON.stringify(x.slice(0,12)), ok);
  });
  t('正しいkeymapはエラーを返さない', !C.parseKeymap(C.DEFAULT_KEYMAP).error);

  // 状態が欠けていても整合性チェックが落ちない
  {
    const thin = {layers:[{name:'a', bindings:['&kp A']}], groups:[{name:'G',count:1}],
      combos:[], behaviors:{morphs:[],tds:[],hts:[],raws:[]}, macros:{items:[],raws:[]}, condLayers:[]};
    let ok = true, v = null;
    try{ v = C.runValidation(thin, ['win']); }catch(e){ ok = false; }
    t('最小限の状態でも整合性チェックが動く', ok && Array.isArray(v));
  }
}

section('全配列の往復');
{
  /* 配列変換は「変換して戻したら元どおり」が成り立たないと信用できない。
     US⇄JIS と同じ水準で、他の配列も全キーで確かめる。 */
  const locales = C.LOCALE_LIST.map(l=>l.id);
  t('対応配列が5種類ある', locales.length===5, locales.join(','));

  locales.forEach(a=>locales.forEach(b=>{
    if(a===b) return;
    const keys = Object.keys(C.LOCALE_CHARS[a]);
    let ng = [], checked = 0;
    keys.forEach(kc=>{
      [kc, 'LS('+kc+')'].forEach(form=>{
        // 文字を出さないキーは往復を問う意味がない
        // (JISのShift+0や半角/全角キーなど、押しても何も入力されない位置)
        const c0 = C.charOfKeycode(form, a);
        if(!c0) return;
        const r1 = C.convBindingLocale('&kp '+form, a, b, false, null);
        if(r1.warns.length) return;                       // 変換先に同じ文字がない場合は対象外
        const r2 = C.convBindingLocale(r1.raw, b, a, false, null);
        const c2 = C.charOfKeycode(r2.raw.replace('&kp ',''), a);
        checked++;
        // 元の表記に戻らなくても、同じ文字が出る表記に落ち着けばよい
        if(c0 !== c2) ng.push(form+'→'+r1.raw+'→'+r2.raw+' ('+c0+' vs '+c2+')');
      });
    });
    t(`${a}⇄${b} が全キーで往復する`, ng.length===0, ng.slice(0,3).join(' / '));
    t(`${a}⇄${b} の検査が空振りしていない`, checked > 20, String(checked));
  }));

  // 変換先に無い文字は、壊さずに警告で知らせる
  {
    const r = C.convBindingLocale('&kp LS(N2)', 'us', 'dvorak', false, null);
    t('変換できない場合もキーを壊さない', /^&kp /.test(r.raw) && !/undefined|NaN/.test(r.raw), r.raw);
  }
  // 文字テーブルの体裁
  locales.forEach(id=>{
    const tbl = C.LOCALE_CHARS[id];
    t('文字テーブルの形式が揃っている: '+id,
      Object.values(tbl).every(v=>Array.isArray(v) && v.length===2 && v.every(x=>typeof x==='string')));
    t('非Shift面に空文字がない: '+id, Object.values(tbl).every(v=>v[0].length>0));
    // Shift面が空なのは「押しても何も入らない」位置。JISのShift+0と半角/全角キーだけ。
    const blank = Object.entries(tbl).filter(([k,v])=>!v[1]).map(([k])=>k);
    t('Shift面が空なのは想定内だけ: '+id,
      id==='jis' ? blank.join(',')==='N0,GRAVE' : blank.length===0, blank.join(','));
  });
  /* 同じ文字を出すキーが複数あるのは正常。JIS配列のキーボードには US には無いキー
     (INT1 / INT3 / NUHS)があり、US の表ではそれらが既存キーと同じ文字を指す。
     ここでは「意図せず増えていないか」だけを見る。 */
  const dupCount = {us:5, jis:2, uk:2, de:0, dvorak:0};
  locales.forEach(id=>{
    const seen = {}, dup = [];
    Object.entries(C.LOCALE_CHARS[id]).forEach(([kc, v])=>{
      v.forEach((ch, i)=>{
        if(!ch) return;
        const k = ch+'@'+i;
        if(seen[k]) dup.push(ch+': '+seen[k]+' / '+kc);
        else seen[k] = kc;
      });
    });
    t('同じ文字を出すキーの数が変わっていない: '+id, dup.length===dupCount[id],
      dup.length+' (想定 '+dupCount[id]+') '+dup.join(' , '));
  });
}

section('メタ');
t('APP_VERSION', typeof C.APP_VERSION==='string' && /^\d+\.\d+\.\d+$/.test(C.APP_VERSION));
t('公開版デフォルト(個人設定を含まない)', C.DEFAULT_KEYMAP.includes('default_layer') && !C.DEFAULT_KEYMAP.includes('comma_morph'));
// 公開物に個人情報が混じらないこと(プレースホルダや例示に実名が残りやすい)
{
  const personal = ['ikooo', 'toyokoji', 'ikoooGit'];
  const hits = personal.filter(w => new RegExp(w, 'i').test(html));
  t('個人を特定する文字列が入っていない', hits.length === 0, hits.join(','));
  const hosts = [...new Set([...html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1].toLowerCase()))];
  const allowed = ['api.github.com','github.com','zmk.dev','zmk.studio','www.w3.org','cdnjs.cloudflare.com'];
  t('通信先が想定どおり(GitHub APIと公式ドキュメントのみ)',
    hosts.every(h => allowed.includes(h)), hosts.filter(h => !allowed.includes(h)).join(','));
}
t('KEYBOARDプロファイル', C.ROBA_PROFILE.id==='roba' && C.ROBA_PROFILE.keys.length===43 && C.ROBA_PROFILE.features.trackball===true);
t('UI側に文字テーブル残存なし', !ui.includes('const US_CHARS'));

/* ---------- 画面の動作テスト ----------
 * ここまでは core層の計算と、HTMLの構造の検査。
 * 実際にボタンを押したときに動くかは jsdom で確かめる(別ファイル)。 */
let uiPass = 0, uiFail = 0, uiRan = false;
{
  const { spawnSync } = require('child_process');
  const uiPath = path.join(__dirname, 'ui-tests.js');
  if (fs.existsSync(uiPath)) {
    const r = spawnSync(process.execPath, [uiPath, htmlPath], { encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    process.stdout.write(out);
    const m = out.match(/画面の動作テスト: (\d+) passed \/ (\d+) failed/);
    if (m) { uiPass = Number(m[1]); uiFail = Number(m[2]); uiRan = true; }
    else if (!/jsdom が入っていない/.test(out)) { uiFail = 1; uiRan = true; }
  }
}

console.log('=====================================');
if (uiRan) console.log(`内訳: 計算と構造 ${pass}/${pass + fail} ・ 画面の動作 ${uiPass}/${uiPass + uiFail}`);
pass += uiPass; fail += uiFail;
console.log(`結果: ${pass} passed / ${fail} failed`);
process.exit(fail? 1 : 0);
