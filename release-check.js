#!/usr/bin/env node
/* =====================================================================
 * Zero Mess Keymapper — 出荷前チェック
 *
 *   使い方: node release-check.js [HTMLファイルパス]
 *
 * tests.js / ui-tests.js は「作った機能が期待どおり動くか」を見る。
 * こちらは「人に渡してよい状態か」を見る。重なりを避け、
 * 次の層だけを担当する。
 *
 *   1. 出荷物と表記のずれ(版番号・個人情報・必要ファイル)
 *   2. 通信先と危ないAPI
 *   3. 書き出した .keymap がZMKの文法として成立しているか
 *   4. 内蔵キーボード全機種の往復
 *   5. 配列 × OS を総当たりした往復
 *   6. 壊れた入力への耐性(ファジング)
 *   7. 重い構成での速さ
 *   8. 表示言語を切り替えたときの通し(jsdom)
 *
 * 時間はかかってよい。落ちたら公開しない。
 * ===================================================================== */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const htmlPath = process.argv[2] || path.join(DIR, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script(?: id="core")?>([\s\S]*?)<\/script>/g)];
const ui = scripts[1][1];

const corePath = '/tmp/zmk-core-release.js';
fs.writeFileSync(corePath, scripts[0][1]);
const C = require(corePath);

let pass = 0, fail = 0, warn = 0;
const failures = [], warnings = [];
function t(name, cond, detail) {
  if (cond) pass++;
  else { fail++; failures.push(name + (detail !== undefined ? ' → ' + detail : '')); console.log('  ✗ NG:', name, detail !== undefined ? '→ ' + detail : ''); }
}
function w(name, cond, detail) {
  if (cond) pass++;
  else { warn++; warnings.push(name + (detail !== undefined ? ' → ' + detail : '')); console.log('  △ 注意:', name, detail !== undefined ? '→ ' + detail : ''); }
}
function section(s) { console.log('\n--- ' + s); }

/* 種を固定した乱数。落ちたときに同じ入力を作り直せるように */
let seed = 20260901;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = a => a[Math.floor(rnd() * a.length)];

/* ============================================================
 * 1. 出荷物と表記
 * ============================================================ */
section('1. 出荷物と表記');
{
  const need = ['index.html', 'README.md', 'README.en.md', 'tests.js', 'ui-tests.js',
    'sample-roba.keymap', 'LICENSE'];
  need.forEach(f => t('公開ファイルがある: ' + f, fs.existsSync(path.join(DIR, f))));

  const ver = (ui.match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1]
    || (scripts[0][1].match(/APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
  t('版番号が読める', !!ver, ver);
  t('版番号の形が正しい', /^\d+\.\d+\.\d+$/.test(ver || ''), ver);

  const steps = fs.existsSync(path.join(DIR, '公開までの手順.md'))
    ? fs.readFileSync(path.join(DIR, '公開までの手順.md'), 'utf8') : '';
  t('手順書の版番号が一致', steps.includes('v' + ver), ver);

  /* 公開するファイルに、外に出したくない文字列が混じっていないか。
     ToyoKoji / ikoooGit / kumamuk-git は公開しているGitHubの名前なので対象外。
     見るのは、手元の環境が漏れるものと連絡先。 */
  /* leak-scan:off */
  const LEAK = [
    [/[\w.+-]+@[\w-]+\.[\w.]+/, 'メールアドレス'],
    [/C:\\Users\\[\w.-]+/i, 'Windowsの個人フォルダ'],
    [/\/Users\/(?!\w*\b(name|you|user)\b)[\w.-]+\//, 'macOSの個人フォルダ'],
    [/AppData/i, 'AppData のパス'],
    [/\/sessions\/[\w-]+/, '作業環境のパス'],
    [/\bikooo(?!Git)\b/i, '手元のユーザー名']
  ];
  /* leak-scan:on */
  ['index.html', 'README.md', 'README.en.md', 'tests.js', 'ui-tests.js',
   'sample-roba.keymap', 'release-check.js']
    .filter(f => fs.existsSync(path.join(DIR, f)))
    .forEach(f => {
      const body = fs.readFileSync(path.join(DIR, f), 'utf8');
      // 検査そのものを書いた場所(見本の文字列)は数えない
      const target = body
        .replace(/\/\* ?leak-scan:off ?\*\/[\s\S]*?\/\* ?leak-scan:on ?\*\//g, '')
        .split('\n').filter(l => !/const personal|LEAK\.forEach/.test(l)).join('\n');
      LEAK.forEach(([re, label]) => {
        const hit = target.match(re);
        t(`外に出せない文字列が無い(${label}): ` + f, !hit,
          hit && target.slice(Math.max(0, hit.index - 30), hit.index + 40).replace(/\n/g, ' '));
      });
    });

  // 単一ファイルで動くこと(外部の読み込みが無いこと)
  t('外部スクリプトを読まない', !/<script[^>]+src=/i.test(html));
  t('外部スタイルを読まない', !/<link[^>]+rel=["']?stylesheet/i.test(html));
  t('画像の外部参照が無い', !/<img[^>]+src=["']https?:/i.test(html));
}

/* ============================================================
 * 2. 通信先と危ないAPI
 * ============================================================ */
section('2. 通信先と危ないAPI');
{
  const ALLOW_FETCH = ['https://api.github.com', 'https://raw.githubusercontent.com'];
  const ALLOW_LINK = ['api.github.com', 'raw.githubusercontent.com', 'github.com',
    'zmk.dev', 'zmk.studio', 'www.w3.org', 'docs.zmk.dev', 'opensource.org'];

  const urls = [...html.matchAll(/https?:\/\/[^\s"'`<>)]+/g)].map(m => m[0]);
  const hosts = [...new Set(urls.map(u => { try { return new URL(u).host; } catch (e) { return u; } }))];
  hosts.forEach(h => t('知っている宛先: ' + h, ALLOW_LINK.includes(h)));

  // 実際に通信する箇所
  const calls = [...html.matchAll(/\bfetch\s*\(([^)]{0,120})/g)].map(m => m[1].trim());
  t('通信は2箇所だけ', calls.length === 2, String(calls.length) + ': ' + calls.map(c => c.slice(0, 40)).join(' | '));
  calls.forEach((c, i) => {
    const ok = ALLOW_FETCH.some(a => c.includes(a)) || /GH_API|RAW_BASE|ghFetch|url/.test(c);
    t('通信先が追える: fetch#' + i, ok, c.slice(0, 60));
  });
  ['XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'importScripts']
    .forEach(k => t('使っていない: ' + k, !html.includes(k)));

  // 文字列からコードを作る手口
  [['eval(', /\beval\s*\(/], ['new Function', /new\s+Function\s*\(/],
   ['document.write', /document\.write\s*\(/], ['insertAdjacentHTML', /insertAdjacentHTML/],
   ['innerHTML +=', /innerHTML\s*\+=/], ['outerHTML =', /outerHTML\s*=/],
   ['setTimeout(文字列)', /setTimeout\s*\(\s*['"]/]]
    .forEach(([name, re]) => t('使っていない: ' + name, !re.test(html)));

  // 保存するもの
  const keys = [...new Set([...html.matchAll(/localStorage\.(?:get|set|remove)Item\('([^']+)'/g)].map(m => m[1]))];
  t('保存キーはすべて zmm_ 接頭辞', keys.every(k => k.startsWith('zmm_')), keys.join(','));
  /* GitHubの鍵。持ち出されていないことを、使っている行を数えて確かめる。
     Authorization ヘッダに載せる以外の使い道があってはいけない。 */
  const tokenLines = ui.split('\n').filter(l => /ghState\.token|gh-token/.test(l)).map(l => l.trim());
  t('鍵の使い道は限られている', tokenLines.length <= 5,
    tokenLines.length + '箇所: ' + tokenLines.map(l => l.slice(0, 40)).join(' | '));
  t('鍵をURLに入れていない',
    !tokenLines.some(l => /https?:\/\/|[?&]\w+=|encodeURI|searchParams|URLSearchParams/.test(l)),
    tokenLines.filter(l => /https?:\/\/|[?&]\w+=/.test(l)).join(' | '));
  t('鍵はAuthorizationヘッダで送る', ui.includes("headers['Authorization'] = 'Bearer '+ghState.token"));
  t('通信先は組み立てたGitHub APIだけ', ui.includes('fetch(GH_API+path'));
  t('鍵は書き出しに含めない', !C.STATE_KEYS.includes('github') && !C.STATE_KEYS.includes('token'),
    C.STATE_KEYS.join(','));

  /* 人が名前を付けられるもの(利用環境・レイヤー・コンボ・ファイル名)を
     HTMLへ埋めるときに esc() を通しているか。番号や固定文は対象外。 */
  const USER = /\bgname(?:For)?\(|\.name\b|\.label\b|\.path\b|\bsrcName\b/;
  const htmlChunks = [
    ...[...ui.matchAll(/innerHTML\s*\+?=\s*([\s\S]{0,700}?);\s*\n/g)].map(m => m[1]),
    ...[...ui.matchAll(/`[^`]*<[a-zA-Z][^`]*`/g)].map(m => m[0])
  ];
  const rawHits = [];
  htmlChunks.forEach(ch => {
    [...ch.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)].forEach(x => {
      const expr = x[1];
      if (USER.test(expr) && !/\besc\(/.test(expr) && !/\b(tr|trText|msgText|msgHtml)\(/.test(expr))
        rawHits.push(expr.trim().slice(0, 46));
    });
  });
  t('人が付けた名前はescを通してHTMLへ入れる', rawHits.length === 0,
    [...new Set(rawHits)].slice(0, 6).join(' / '));
  // 検査そのものの検算
  t('escの検査が抜けを見つけられる',
    (() => { const probe = 'x.innerHTML = `<b>${g.name}</b>`;\n';
      return /\$\{([^{}]*)\}/.test(probe) && USER.test('g.name'); })());
}

/* ============================================================
 * 3. 書き出した .keymap の文法
 * ============================================================ */
section('3. 書き出した .keymap の文法');

/** ZMKの .keymap として最低限成立しているかを見る簡易チェッカ */
function lintKeymap(src) {
  const bad = [];
  /* コメントは文法の対象外。設定ファイルには「使っていない設定を
     コメントにして残す」書き方がよくあり、そこまで見ると誤検出になる */
  const text = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // 波括弧・山括弧の対応
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth < 0) { bad.push('} が余分'); break; } }
  }
  if (depth > 0) bad.push('{ が閉じていない (' + depth + ')');
  // ノード名の文字種
  [...text.matchAll(/^\s*([A-Za-z0-9_@\-]+)\s*\{/gm)].forEach(m => {
    if (!/^[A-Za-z_][A-Za-z0-9_@-]*$/.test(m[1])) bad.push('ノード名が不正: ' + m[1]);
  });
  // keymap 直下のレイヤー名の重複
  const km = text.match(/keymap\s*\{([\s\S]*?)\n\s{4}\};/);
  if (km) {
    const names = [...km[1].matchAll(/^\s{8}([A-Za-z_][A-Za-z0-9_-]*)\s*\{/gm)].map(m => m[1]);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    if (dup.length) bad.push('レイヤー名が重複: ' + [...new Set(dup)].join(','));
  }
  /* bindings の中身。hold-tap のように <&mo>, <&to_layer_0> と
     2セル並べる書き方もあるので、< > の組ごとに見る */
  [...text.matchAll(/(?:^|\s)(?:sensor-)?bindings\s*=\s*([^;]*);/g)].forEach(m => {
    const val = m[1];
    const outside = val.replace(/<[^>]*>/g, '').replace(/,/g, '').trim();
    if (outside) bad.push('bindings の外に余分な字: ' + outside.slice(0, 30));
    const cells = [...val.matchAll(/<([^>]*)>/g)].map(x => x[1]);
    if (!cells.length) bad.push('bindings が < > で囲まれていない');
    cells.forEach(body => {
      const toks = body.trim().split(/\s+/).filter(Boolean);
      if (toks.length && !toks[0].startsWith('&')) bad.push('bindings が & で始まっていない: ' + toks[0]);
      toks.forEach(x => { if (/[^\w&:()|,#-]/.test(x)) bad.push('bindings に妙な字: ' + x); });
    });
  });
  // 属性の終端
  [...text.matchAll(/^\s*(compatible|label|display-name|flavor)\s*=\s*[^;\n]*$/gm)]
    .forEach(m => bad.push('; が無い: ' + m[0].trim().slice(0, 40)));
  return [...new Set(bad)];
}

function stateFor(profile) {
  C.setKeyboard(profile);
  const km = C.makeDefaultKeymap(profile);
  const p = C.parseKeymap(km);
  return {
    originalText: km, layers: p.layers,
    groups: [{ name: 'Default', count: p.layers.length }],
    keyboard: profile, links: [],
    combos: C.parseCombos(km), behaviors: C.parseBehaviors(km),
    macros: C.parseMacros(km), condLayers: C.parseCondLayers(km),
    trackball: C.parseTrackball(km), conf: null, holdtap: null
  };
}

const saved = C.getKeyboard();
{
  const st = stateFor(C.BUILTIN_PROFILES[0]);
  const out = C.generateKeymap(st);
  const bad = lintKeymap(out);
  t('既定の書き出しが文法として通る', bad.length === 0, bad.join(' / '));
  t('見本の設定ファイルも文法として通る', (() => {
    const s = path.join(DIR, 'sample-roba.keymap');
    return !fs.existsSync(s) || lintKeymap(fs.readFileSync(s, 'utf8')).length === 0;
  })());
  // わざと壊した入力を、チェッカが見逃さないこと(チェッカの検算)
  t('チェッカが閉じ忘れを見つける', lintKeymap(out.replace('};', ';')).length > 0);
  t('チェッカがノード名の不正を見つける',
    lintKeymap(out.replace(/keymap \{/, '9keymap {')).length > 0);
  t('チェッカが山括弧の壊れを見つける',
    lintKeymap(out.replace('bindings = <', 'bindings = ')).length > 0);
  t('チェッカがレイヤー名の重複を見つける', (() => {
    const names = [...out.matchAll(/^\s{8}([A-Za-z_][A-Za-z0-9_-]*)\s*\{/gm)].map(x => x[1]);
    if (names.length < 2) return true;
    return lintKeymap(out.replace(names[1] + ' {', names[0] + ' {')).length > 0;
  })());
  t('正しい入力を誤って咎めない', lintKeymap(out).length === 0, lintKeymap(out).join(' / '));
}

/* ============================================================
 * 4. 内蔵キーボード全機種の往復
 * ============================================================ */
section('4. 内蔵キーボード全機種の往復');
C.BUILTIN_PROFILES.forEach(p => {
  const st = stateFor(p);
  t('キー数が合う: ' + p.id, st.layers.every(l => l.bindings.length === p.keyCount),
    st.layers.map(l => l.bindings.length).join(','));
  let out = '';
  try { out = C.generateKeymap(st); } catch (e) { t('書き出せる: ' + p.id, false, e.message); return; }
  const bad = lintKeymap(out);
  t('文法が通る: ' + p.id, bad.length === 0, bad.join(' / '));
  const re = C.parseKeymap(out);
  t('読み直せる: ' + p.id, !re.error, re.error);
  t('中身が変わらない: ' + p.id,
    JSON.stringify(re.layers.map(l => l.bindings)) === JSON.stringify(st.layers.map(l => l.bindings)));
  // 参照先が範囲内
  const n = st.layers.length;
  const oob = [];
  st.layers.forEach((l, li) => l.bindings.forEach((b, ki) => {
    const m = b.trim().match(/^&(?:mo|to|tog|sl|lt)\s+(\d+)/);
    if (m && (Number(m[1]) < 0 || Number(m[1]) >= n)) oob.push(`${li}:${ki}=${b}`);
  }));
  t('参照先が範囲内: ' + p.id, oob.length === 0, oob.slice(0, 3).join(' '));
});
C.setKeyboard(saved);

/* ============================================================
 * 5. 配列 × OS の総当たり
 * ============================================================ */
section('5. 配列 × OS の総当たり');
{
  const locales = C.LOCALE_LIST.map(l => l.id);
  const oses = C.OS_LIST.map(o => o.id || o);
  const base = stateFor(C.BUILTIN_PROFILES[0]);
  let cases = 0, bad = [];
  locales.forEach(l1 => locales.forEach(l2 => oses.forEach(o1 => oses.forEach(o2 => {
    cases++;
    base.layers[0].bindings.forEach(b => {
      const r = C.convBindingFull(b, l1, l2, o1, o2, true, () => {}, null);
      if (!r || typeof r.raw !== 'string') bad.push(`${l1}->${l2}/${o1}->${o2}: ${b}`);
      else if (/undefined|NaN|\[object/.test(r.raw)) bad.push(`${l1}->${l2}/${o1}->${o2}: ${b} => ${r.raw}`);
      else if (!r.raw.startsWith('&')) bad.push(`${l1}->${l2}/${o1}->${o2}: ${b} => ${r.raw}`);
    });
  }))));
  t('総当たりで壊れた出力が無い', bad.length === 0, `${cases}通り中 ${bad.length}件: ` + bad.slice(0, 3).join(' | '));
  console.log(`    (${cases} 通り × ${base.layers[0].bindings.length} キーを確認)`);

  // 同じ配列・同じOSなら何も変えない
  let noop = [];
  locales.forEach(l => oses.forEach(o => {
    base.layers[0].bindings.forEach(b => {
      const r = C.convBindingFull(b, l, l, o, o, true, () => {}, null);
      if (C.canonBinding(r.raw) !== C.canonBinding(b)) noop.push(`${l}/${o}: ${b} => ${r.raw}`);
    });
  }));
  t('同じ設定なら変換しない', noop.length === 0, noop.slice(0, 3).join(' | '));
}

/* ============================================================
 * 6. 壊れた入力への耐性(ファジング)
 * ============================================================ */
section('6. 壊れた入力への耐性(ファジング)');
{
  const seeds = [];
  const s1 = path.join(DIR, 'sample-roba.keymap');
  if (fs.existsSync(s1)) seeds.push(fs.readFileSync(s1, 'utf8'));
  seeds.push(C.makeDefaultKeymap(C.BUILTIN_PROFILES[0]));
  seeds.push(C.generateKeymap(stateFor(C.BUILTIN_PROFILES[1])));

  const JUNK = ['\0', '}', '{', '<', '>', ';', '&', '"', '\\', '&&&', '<<<>>>',
    'bindings = <', 'keymap {', '// zmk-links: 99=99', '// zmk-order: x;y',
    '// zmk-env: =', '\uD800', '𩸽', '\u202e'];
  const mutate = src => {
    const k = Math.floor(rnd() * 6);
    const at = Math.floor(rnd() * src.length);
    if (k === 0) return src.slice(0, at);                                  // 途中で切る
    if (k === 1) return src.slice(0, at) + pick(JUNK) + src.slice(at);      // ごみを差し込む
    if (k === 2) return src.slice(0, at) + src.slice(at + Math.floor(rnd() * 200)); // 抜く
    if (k === 3) return src.replace(/\d+/g, m => String(Math.floor(rnd() * 1e6)));  // 数字を荒らす
    if (k === 4) return src.split('\n').sort(() => rnd() - 0.5).join('\n'); // 行を入れ替える
    return src.slice(at) + src.slice(0, at);                               // ずらす
  };

  const runAll = text => {
    const p = C.parseKeymap(text);
    C.parseCombos(text); C.parseBehaviors(text); C.parseTrackball(text);
    C.parseMacros(text); C.parseCondLayers(text);
    const layers = (p && p.layers) || [];
    const groups = layers.length ? [{ name: 'Default', count: layers.length }] : [];
    C.parseLinks(text, layers, groups);
    C.parseOrder(text, layers, groups);
    C.applyEnvNames(text, groups);
    if (layers.length) {
      C.linkColumns([[0, layers.length - 1]], groups, layers.length);
      C.normalizeLinks([[0, 1], [1, 2], [-5, 99]], groups, layers.length);
      C.fwOrderIfNeeded(groups, layers);
      C.runValidation({ layers, groups, combos: [], behaviors: { morphs: [], tds: [], hts: [], raws: [] },
        macros: { items: [], raws: [] }, condLayers: [], links: [], originalText: text });
    }
  };

  let crashes = [];
  const N = 600;
  for (let i = 0; i < N; i++) {
    const text = mutate(pick(seeds));
    try { runAll(text); }
    catch (e) { crashes.push({ i, msg: e.message, head: text.slice(0, 60).replace(/\n/g, '\\n') }); }
  }
  t('壊れた入力で例外が出ない', crashes.length === 0,
    `${N}回中 ${crashes.length}件: ` + crashes.slice(0, 3).map(c => `#${c.i} ${c.msg}`).join(' | '));
  console.log(`    (${N} 通りの壊し方を確認 / 種=${20260901})`);

  // 極端な入力
  [['空文字', ''], ['空白だけ', '   \n\t '], ['巨大な数', '&mo 99999999999'],
   ['深い入れ子', '{'.repeat(500) + '}'.repeat(500)], ['長い1行', 'a'.repeat(200000)]]
    .forEach(([name, text]) => {
      let ok = true, msg = '';
      try { runAll(text); } catch (e) { ok = false; msg = e.message; }
      t('極端な入力で落ちない: ' + name, ok, msg);
    });
}

/* ============================================================
 * 7. 重い構成での速さ
 * ============================================================ */
section('7. 重い構成での速さ');
{
  const KEYS = 60, ENV = 6, PER = 6;
  const layers = [];
  for (let g = 0; g < ENV; g++) for (let k = 0; k < PER; k++)
    layers.push({ name: 'L' + g + '_' + k, displayName: null, sensor: null, shiftLayer: k === 0,
      bindings: Array.from({ length: KEYS }, (_, i) => i % 7 === 0 ? '&mo ' + ((g * PER + 1) % (ENV * PER)) : '&kp A') });
  const groups = Array.from({ length: ENV }, (_, g) =>
    ({ name: 'E' + g, count: PER, locale: g % 2 ? 'jis' : 'us', platform: g % 3 ? 'win' : 'mac' }));
  const links = Array.from({ length: PER }, (_, k) => Array.from({ length: ENV }, (_, g) => g * PER + k));
  const st = { originalText: C.makeDefaultKeymap(C.BUILTIN_PROFILES[0]), layers, groups, links,
    combos: [], behaviors: { morphs: [], tds: [], hts: [], raws: [] },
    macros: { items: [], raws: [] }, condLayers: [], trackball: null, conf: null, holdtap: null };

  const ms = (name, fn, limit) => {
    fn(); // 1回目は準備
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 5; i++) fn();
    const d = Number(process.hrtime.bigint() - t0) / 5e6;
    console.log(`    ${name}: ${d.toFixed(2)} ms`);
    w(name + ' が ' + limit + 'ms 以内', d < limit, d.toFixed(2) + 'ms');
    return d;
  };
  console.log(`    (${ENV}利用環境 × ${PER}レイヤー × ${KEYS}キー = ${layers.length}レイヤー)`);
  ms('リンクの列割り当て', () => C.linkColumns(links, groups, layers.length), 20);
  ms('差異の判定', () => C.linksWithDiffs(st), 120);
  ms('書き出し前の点検', () => C.runValidation(st), 60);
  ms('fw順への並べ替え', () => C.stateInFwOrder(st), 30);
  ms('書き出し', () => C.generateKeymap(st), 120);
  const out = C.generateKeymap(st);
  ms('読み込み', () => C.parseKeymap(out), 60);
  w('書き出しが大きくなりすぎない', out.length < 900000, (out.length / 1024).toFixed(0) + 'KB');
  w('本体が1MBを超えない', html.length < 1024 * 1024, (html.length / 1024).toFixed(0) + 'KB');
}

/* ============================================================
 * 8. 表示言語を切り替えたときの通し(jsdom)
 * ============================================================ */
section('8. 表示言語を切り替えたときの通し');
{
  let JSDOM = null;
  try { JSDOM = require('jsdom').JSDOM; }
  catch (e) { try { JSDOM = require('/tmp/node_modules/jsdom').JSDOM; } catch (e2) {} }
  if (!JSDOM) {
    w('jsdom があれば画面も通す', false, 'jsdom が無いので省略');
  } else {
    const errors = [];
    const dom = new JSDOM(html, {
      runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.invalid/',
      beforeParse(wd) {
        wd.alert = () => {}; wd.confirm = () => true; wd.prompt = () => null;
        wd.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
        wd.URL.createObjectURL = () => 'blob:x'; wd.URL.revokeObjectURL = () => {};
        wd.HTMLCanvasElement.prototype.getContext = () => null;
        wd.scrollTo = () => {}; wd.print = () => {}; wd.open = () => null;
        wd.Element.prototype.scrollIntoView = () => {};
        wd.fetch = () => Promise.reject(new Error('通信は行わない'));
        wd.addEventListener('error', e => errors.push(String(e.error || e.message)));
      }
    });
    const wd = dom.window;
    wd.eval('console.error = m => { throw new Error("console.error: " + m); }');

    const modals = [...html.matchAll(/class="modal-bg"\s+id="([^"]+)"/g)].map(m => m[1]);
    const run = lang => {
      try {
        wd.setLang(lang);
        wd.renderAll();
        wd.i18nWalk(wd.document.body);
        // 主要な画面をひととおり開いて閉じる
        modals.forEach(id => {
          const el = wd.document.getElementById(id);
          if (!el) return;
          el.classList.add('open');
          wd.closeModal(id);
        });
        // 描き直しの入り口をひととおり
        ['renderLayers', 'renderBoard', 'renderPicker', 'renderCombos', 'renderBehs',
         'renderMacros', 'renderHts', 'renderLinkList']
          .forEach(f => { if (typeof wd[f] === 'function') wd[f](); });
        return null;
      } catch (e) { return e.message; }
    };
    console.log(`    (画面 ${modals.length} 枚 + 描き直し8種 を 日本語→英語→日本語 で通す)`);
    t('日本語で通る', run('ja') === null, run('ja'));
    t('英語で通る', run('en') === null, run('en'));
    t('日本語へ戻せる', run('ja') === null);
    t('切替中にエラーが出ない', errors.length === 0, errors.slice(0, 2).join(' | '));

    // 英語表示に日本語が残っていないか(主要なボタンとメニューだけ)
    wd.setLang('en'); wd.renderAll(); wd.i18nWalk(wd.document.body);
    const jp = /[ぁ-んァ-ヶ一-龥]/;
    const leftover = [...wd.document.querySelectorAll('#hmenu button, header button')]
      .map(b => b.textContent.trim()).filter(s => jp.test(s));
    w('英語表示のメニューに日本語が残らない', leftover.length === 0, leftover.slice(0, 5).join(' / '));
    wd.setLang('ja');
    dom.window.close();
  }
}

/* ============================================================
 * まとめ
 * ============================================================ */
console.log('\n=====================================');
console.log(`出荷前チェック: ${pass} 件合格 / ${fail} 件不合格 / ${warn} 件注意`);
if (failures.length) { console.log('\n■ 直すべきもの'); failures.forEach(f => console.log('  ・' + f)); }
if (warnings.length) { console.log('\n■ 見ておくべきもの'); warnings.forEach(f => console.log('  ・' + f)); }
console.log('\n※ 実機での打鍵と画面の目視は、この検査では代われない。');
process.exit(fail ? 1 : 0);
