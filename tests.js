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

/* ---------- 7. バージョン/プロファイル ---------- */
section('メタ');
t('APP_VERSION', typeof C.APP_VERSION==='string' && /^\d+\.\d+\.\d+$/.test(C.APP_VERSION));
t('公開版デフォルト(個人設定を含まない)', C.DEFAULT_KEYMAP.includes('default_layer') && !C.DEFAULT_KEYMAP.includes('comma_morph'));
t('KEYBOARDプロファイル', C.ROBA_PROFILE.id==='roba' && C.ROBA_PROFILE.keys.length===43 && C.ROBA_PROFILE.features.trackball===true);
t('UI側に文字テーブル残存なし', !ui.includes('const US_CHARS'));

console.log('=====================================');
console.log(`結果: ${pass} passed / ${fail} failed`);
process.exit(fail? 1 : 0);
