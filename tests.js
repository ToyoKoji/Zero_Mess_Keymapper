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

/* ---------- 6.75 レイヤー順序の検査 ---------- */
section('レイヤー順序');
{
  // ZMK: レイヤー0は常に有効 / 番号が大きいレイヤーが優先
  // → 共有レイヤーは全ての環境レイヤーより後ろでなければならない
  const bad  = [{name:'US',count:5},{name:'GEN',count:2},{name:'JIS',count:5}];
  const good = [{name:'US',count:5},{name:'JIS',count:5},{name:'GEN',count:2}];
  t('共有が中間にあると検出', C.findOrderIssues(bad).length===1);
  t('検出内容が正しい', C.findOrderIssues(bad)[0].sharedName==='GEN'
    && JSON.stringify(C.findOrderIssues(bad)[0].blockedBy)==='["JIS"]');
  t('共有が最後なら問題なし', C.findOrderIssues(good).length===0);
  t('共有がない構成でも落ちない', C.findOrderIssues([{name:'US',count:5}]).length===0);
  t('共有が先頭のみでも検出', C.findOrderIssues([{name:'GEN',count:2},{name:'US',count:5}]).length===1);
  t('共有が複数あっても検出', C.findOrderIssues([{name:'GEN',count:1},{name:'US',count:5},{name:'SHARED',count:1}]).length===1);

  // 並べ替え
  t('共有を末尾へ', JSON.stringify(C.orderWithSharedLast(bad))==='[0,2,1]');
  t('既に正しい並びは変えない', JSON.stringify(C.orderWithSharedLast(good))==='[0,1,2]');
  t('並べ替え後は問題が消える', (()=>{
    const perm = C.orderWithSharedLast(bad);
    const reordered = perm.map(i=>bad[i]);
    return C.findOrderIssues(reordered).length===0;
  })());

  // 共有グループの判定
  t('共有判定(名前)', C.isSharedGroup({name:'GEN'}) && C.isSharedGroup({name:'GENERAL'})
    && C.isSharedGroup({name:'SHARED'}) && C.isSharedGroup({name:'共有'}));
  t('共有判定(環境は false)', !C.isSharedGroup({name:'US'}) && !C.isSharedGroup({name:'JIS'}));
  t('共有判定(明示フラグが優先)', C.isSharedGroup({name:'US', shared:true}) && !C.isSharedGroup({name:'GEN', shared:false}));

  // ベース層の透過検出
  const layers = [];
  for(let i=0;i<12;i++) layers.push({name:'L'+i, bindings:Array(43).fill('&kp A')});
  layers[5].bindings[3] = '&trans';
  layers[5].bindings[9] = '&trans';
  const tr = C.findBaseTransIssues(good, layers);
  t('ベース層の透過を検出', tr.length===1 && tr[0].groupName==='JIS' && JSON.stringify(tr[0].positions)==='[3,9]');
  t('レイヤー0自身は対象外', (()=>{
    const l2 = layers.map(x=>({name:x.name, bindings:[...x.bindings]}));
    l2[0].bindings[1] = '&trans';
    return C.findBaseTransIssues(good, l2).every(x=>x.layerIndex!==0);
  })());
  t('共有グループは対象外', (()=>{
    const l3 = layers.map(x=>({name:x.name, bindings:[...x.bindings]}));
    l3[10].bindings[0] = '&trans';   // GEN の先頭
    return C.findBaseTransIssues(good, l3).every(x=>x.groupName!=='GEN');
  })());
  t('透過がなければ検出しない', C.findBaseTransIssues(good,
    Array.from({length:12},(_,i)=>({name:'L'+i, bindings:Array(43).fill('&kp A')}))).length===0);
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
    ['&kp INT_HENKAN','&kp LANG1','かな'],
    ['&kp INT_MUHENKAN','&kp LANG2','英数'],
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
section('メタ');
t('APP_VERSION', typeof C.APP_VERSION==='string' && /^\d+\.\d+\.\d+$/.test(C.APP_VERSION));
t('公開版デフォルト(個人設定を含まない)', C.DEFAULT_KEYMAP.includes('default_layer') && !C.DEFAULT_KEYMAP.includes('comma_morph'));
t('KEYBOARDプロファイル', C.ROBA_PROFILE.id==='roba' && C.ROBA_PROFILE.keys.length===43 && C.ROBA_PROFILE.features.trackball===true);
t('UI側に文字テーブル残存なし', !ui.includes('const US_CHARS'));

console.log('=====================================');
console.log(`結果: ${pass} passed / ${fail} failed`);
process.exit(fail? 1 : 0);
