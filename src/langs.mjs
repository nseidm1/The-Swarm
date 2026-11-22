// langs.mjs - A FUNCTION A MODEL WROTE, RUN IN THE LANGUAGE IT WAS WRITTEN IN. behave.mjs groups drafts by what they do, and
// sandbox.mjs runs JavaScript only: a request for a function in Python, Go, Swift, Dart or Kotlin had its drafts compared as
// text, so no two were the same answer (measured 2026-11-22: two small models, 0 of 40 on HumanEval and MBPP, both Python).
//   langOf(question, codes)                 -> 'js' | 'ts' | 'python' | 'go' | 'swift' | 'dart' | 'kotlin'
//   callsIn(lang, code, name, calls)        -> [{ v } | { e }] for each call, or null where the code does not run at all
//   langReady(lang)                         -> can this language be run here, boxed? (asked once: a function that returns 1)
//   nameIn(lang, codes, question)           -> the function the drafts define
//   paramsIn / callsFor                     -> calls built with no model, from the function's own parameters and their types
// TypeScript has its types taken off (Node) and runs where JavaScript does (sandbox.mjs). Flutter is compiled against Flutter
// and run in Flutter's own tester, which needs no screen: a function is called, and a widget is built and known by what it shows.
// THE BOX. Every other language runs under the machine's own sandbox (macOS sandbox-exec) with a profile that refuses the
// network, refuses every write but to a folder made for the run, and refuses to read the person's folders. Where there is no
// such sandbox (another system), or a language's tools are not installed, the language is not run and the drafts are compared
// as text, as before. Nothing is installed by this file. Each call is a process of its own where starting one is cheap, so a
// call that never ends or stops the program costs that call and no other.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import nodeModule from 'node:module';
import { callsOf as jsCallsOf, sandboxReady } from './sandbox.mjs';

const MARK = '@@swoa@@';
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const BASE = path.join(fs.realpathSync(os.tmpdir()), 'swoa-box');

// ---- which language -------------------------------------------------------------------------------------------------------
// the question's own word for it comes first (it is what was asked for); then the marks of the drafts; then JavaScript
const ASKED = [
  ['ts', /\btypescript\b|\bin ts\b/i],
  ['python', /\bpython\b/i],
  ['go', /\bgolang\b|\b(?:in|using|a) go\b|\bgo (?:function|program|code)\b/i],
  ['swift', /\bswift\b/i],
  ['kotlin', /\bkotlin\b/i],
  ['flutter', /\bflutter\b|\bwidget\b/i],
  ['dart', /\bdart\b/i],
  ['js', /\bjavascript\b|\bnode(?:\.js)?\b/i],
];
const MARKS = {
  python: /^\s*(?:async\s+)?def\s+\w+\s*\([^)]*\)[^:\n]*:|^\s*(?:from\s+[\w.]+\s+)?import\s+[\w.,* ]+$/m,
  // (Go and Swift both write `func`: Swift's parameters hold a colon or its head an arrow, Go's hold neither)
  go: /^\s*package\s+\w+\s*$|^\s*func\s+(?:\([^)]*\)\s*)?\w+\s*\([^):]*\)(?![^{\n]*->)[^{\n]*\{|:=|\bfmt\.\w/m,
  swift:
    /^\s*(?:public\s+|private\s+|static\s+)*func\s+\w+\s*(?:<[^>]*>)?\s*\((?:[^)]*:[^)]*\)|[^)]*\)\s*(?:throws\s*)?->)|\bguard\s+let\b|^\s*let\s+\w+\s*:\s*\[?[A-Z]/m,
  kotlin: /^\s*(?:private\s+|internal\s+|public\s+|suspend\s+)*fun\s+(?:<[^>]*>\s*)?[\w.]+\s*\([^)]*\)/m,
  flutter: /package:flutter\/|\bextends\s+(?:Stateless|Stateful)Widget\b/,
  dart: /^\s*(?:List|Map|Set|String|int|double|bool|num|void|dynamic|Future)(?:<[^>\n]*>)?\??\s+\w+\s*\([^)]*\)\s*(?:async\s*)?(?:\{|=>)/m,
  ts: /\)\s*:\s*[A-Za-z_][\w<>[\]| ]*\s*(?:=>|\{)|\b\w+\s*:\s*(?:number|string|boolean)\b|^\s*(?:interface|type)\s+\w+/m,
};
export function langOf(question = '', codes = []) {
  const q = String(question || '');
  for (const [id, re] of ASKED) if (re.test(q)) return id;
  const count = {};
  for (const c of codes)
    for (const id of ['python', 'kotlin', 'swift', 'go', 'flutter', 'dart', 'ts'])
      if (MARKS[id].test(String(c || ''))) {
        count[id] = (count[id] || 0) + 1;
        break;
      }
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : 'js';
}
// the name a fence is given where code of this language goes out
export const FENCE = {
  js: 'js',
  ts: 'ts',
  python: 'python',
  go: 'go',
  swift: 'swift',
  dart: 'dart',
  flutter: 'dart',
  kotlin: 'kotlin',
};
// has a text the marks of code in one of these languages? (read.mjs isCode asks, beside JavaScript's own marks)
export const hasMarks = (text) =>
  ['python', 'go', 'swift', 'kotlin', 'flutter', 'dart'].some((id) => MARKS[id].test(String(text || '')));
export const marksOf = (text) =>
  ['python', 'kotlin', 'swift', 'go', 'flutter', 'dart', 'ts'].find((id) => MARKS[id].test(String(text || ''))) || '';

// ---- the function the drafts define, and its parameters -------------------------------------------------------------------
const HEAD = {
  python: /^[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm,
  go: /^[ \t]*func\s+([A-Za-z_]\w*)\s*\(/gm,
  swift: /^[ \t]*(?:public\s+|private\s+|static\s+)*func\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/gm,
  kotlin: /^[ \t]*(?:private\s+|internal\s+|public\s+|suspend\s+)*fun\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*)\s*\(/gm,
  dart: /^[ \t]*(?:[A-Za-z_][\w<>,? ]*\s+)([A-Za-z_]\w*)\s*\([^;{]*\)\s*(?:async\s*)?(?:\{|=>)/gm,
};
const NOT_A_NAME = new Set([
  'main',
  'if',
  'for',
  'while',
  'switch',
  'return',
  'catch',
  'init',
  'build',
  'createState',
  'initState',
  'dispose',
  'setState',
]);
const WIDGET = /\bclass\s+([A-Za-z_]\w*)\s+extends\s+(?:Stateless|Stateful)Widget\b/g;
export function nameIn(lang, codes, question = '') {
  // (Flutter: the thing a draft makes is a widget where it declares one, and the widget is what is built and looked at)
  const widgets = lang === 'flutter' && codes.some((c) => new RegExp(WIDGET.source).test(String(c || '')));
  const re = widgets ? WIDGET : HEAD[lang === 'flutter' ? 'dart' : lang];
  if (!re) return '';
  const count = new Map();
  for (const c of codes) {
    const names = new Set([...String(c || '').matchAll(re)].map((m) => m[1]).filter((n) => !NOT_A_NAME.has(n)));
    for (const n of names) count.set(n, (count.get(n) || 0) + 1);
  }
  const inQuestion = (n) => (new RegExp('\\b' + n + '\\b').test(question) ? 1 : 0);
  return ([...count.entries()].sort((a, b) => b[1] - a[1] || inQuestion(b[0]) - inQuestion(a[0]))[0] || [''])[0];
}
// the text between a function's brackets: from the first `name(` to the bracket that closes it
function between(code, name) {
  const s = String(code || '');
  const at = s.search(new RegExp('\\b' + name + '\\s*(?:<[^>]*>)?\\s*\\('));
  if (at < 0) return null;
  let depth = 0;
  for (let i = s.indexOf('(', at); i < s.length; i++) {
    if ('([{<'.includes(s[i])) depth++;
    else if (')]}>'.includes(s[i]) && --depth === 0) return s.slice(s.indexOf('(', at) + 1, i);
  }
  return null;
}
const splitTop = (text) => {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) (out.push(cur), (cur = ''));
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
};
// -> [{ name, label, type }]: label is what a call must write before the value ('' where it writes none)
// Dart and Flutter: positional parameters, then the named ones a call MUST give (`{required this.title}`); the others are left
// to their defaults. `this.name` takes its type from the field of that name (`final String name;`); a key is never given.
function dartParams(code, inside) {
  const open = inside.search(/[{[]/);
  const positional = splitTop(open < 0 ? inside : inside.slice(0, open));
  const named = open >= 0 && inside[open] === '{' ? splitTop(inside.slice(open + 1).replace(/}\s*$/, '')) : [];
  const one = (p, isNamed) => {
    const d = p
      .replace(/=.*$/, '')
      .replace(/^(?:required|final|covariant)\s+/g, '')
      .trim();
    if (/^super\.|\bkey$/.test(d)) return null;
    const viaThis = d.match(/^this\.(\w+)$/);
    const m = d.match(/^(.*?)\s*(\w+)$/) || [];
    const n = viaThis ? viaThis[1] : m[2] || d;
    const field =
      viaThis && String(code).match(new RegExp('(?:final|late|var)?\\s*([A-Za-z_][\\w<>?, ]*?)\\s+' + n + '\\s*[;=]'));
    return {
      name: n,
      label: isNamed ? n : '',
      type: viaThis ? (field ? field[1].replace(/^(?:final|late)\s+/, '').trim() : '') : (m[1] || '').trim(),
    };
  };
  return [
    ...positional.map((p) => one(p, false)),
    ...named.filter((p) => /^\s*required\b/.test(p)).map((p) => one(p, true)),
  ].filter(Boolean);
}
export function paramsIn(lang, codes, name) {
  for (const c of codes) {
    const inside = between(c, name);
    if (inside === null) continue;
    if (lang === 'dart' || lang === 'flutter') return dartParams(c, inside);
    return splitTop(inside).map((p) => {
      const bare = p.replace(/=.*$/, '').trim();
      if (lang === 'python') {
        const [n, t = ''] = bare.split(':').map((x) => x.trim());
        return { name: n.replace(/^\*+/, ''), label: '', type: t };
      }
      if (lang === 'go') {
        const m = bare.match(/^(\w+)\s*(.*)$/) || [];
        return { name: m[1] || '', label: '', type: (m[2] || '').trim() };
      }
      if (lang === 'swift') {
        const [left, t = ''] = bare.split(/:(.*)/s).map((x) => (x || '').trim());
        const words = left.split(/\s+/);
        const label = words.length > 1 ? (words[0] === '_' ? '' : words[0]) : words[0];
        return { name: words[words.length - 1], label, type: t.replace(/^inout\s+/, '') };
      }
      if (lang === 'kotlin') {
        const [n, t = ''] = bare.split(/:(.*)/s).map((x) => (x || '').trim());
        return { name: n.replace(/^(?:vararg|val|var)\s+/, ''), label: '', type: t };
      }
      // dart: `List<int> xs`, `int n`; a parameter with no type is dynamic (named ones are read by dartParams)
      const d = bare
        .replace(/[{}[\]]/g, '')
        .replace(/^(?:required|final|covariant)\s+/, '')
        .trim();
      const m = d.match(/^(.*?)\s*(\w+)$/) || [];
      return { name: m[2] || d, label: '', type: (m[1] || '').trim() };
    });
  }
  return [];
}
// what kind of value a parameter takes, from its type where it has one and else from its name
const KIND_BY_NAME = [
  [
    /text|str|string|word|sentence|line|name|^s$|input|message|title|code|path|url|char|^ch$|^c$|sep|delim|prefix|suffix|pattern|letter/i,
    'string',
  ],
  [/list|arr|array|items|numbers|nums|values|^xs$|data|elements|scores|rows/i, 'ints'],
  [/^n$|num|count|^k$|size|amount|index|limit|times|steps|^x$|^y$|^a$|^b$|year|day|month|width|height|length/i, 'int'],
];
export function kindOf(p) {
  const t = String(p.type || '');
  if (
    /^\s*(?:\[\]|List<|list\[|\[|Array<|MutableList<|IntArray|Slice)\s*(?:string|String|str)\b|^\s*\[String\]|^list\[str\]/.test(
      t,
    )
  )
    return 'strings';
  if (
    /\[\]\s*(?:int|float)|List<\s*(?:int|Int|num|double|Double)|list\[\s*(?:int|float)|^\s*\[\s*(?:Int|Double)\s*\]|IntArray|Array<\s*Int|\[\]int/.test(
      t,
    )
  )
    return 'ints';
  if (/^\s*(?:List|list|\[\]|Array|\[)/.test(t)) return 'ints';
  if (/\b(?:float|float32|float64|double|Double|Float|num)\b/.test(t)) return 'float';
  if (/\b(?:int|int64|int32|Int|Long|uint|number)\b/.test(t)) return 'int';
  if (/\b(?:str|string|String|Character|Char|rune|byte)\b/.test(t)) return 'string';
  if (/\b(?:bool|Bool|Boolean)\b/.test(t)) return 'bool';
  if (/VoidCallback|Function\b|\)\s*\??$/.test(t)) return 'callback';
  if (/^Widget\??$/.test(t.trim())) return 'widget';
  if (/^Color\??$/.test(t.trim())) return 'color';
  if (t) return '';
  const byName = KIND_BY_NAME.find(([re]) => re.test(p.name || ''));
  return byName ? byName[1] : '';
}
const VALUES = {
  int: [0, 1, 2, -3, 10],
  float: [0.0, 1.5, -2.25, 10.0, 3.0],
  string: ['', 'a', 'aaabcc', 'Hello, World', '  two  words '],
  bool: [true, false, true, false, true],
  ints: [[], [1], [1, 2, 3, 4, 5], [3, 1, 2, 2, 3], [-2, 0, 7]],
  strings: [[], ['a'], ['b', 'a', 'c'], ['x', 'x'], ['Hello', 'World']],
  // (Flutter: something to press, something to show, a colour; one of each is enough)
  callback: ['() {}'],
  widget: ['const SizedBox()'],
  color: ['const Color(0xFF2196F3)', 'const Color(0xFF000000)'],
};
// a value written as this language writes it
export function literalIn(lang, kind, v, type = '') {
  const one = (x, k) =>
    k === 'string'
      ? JSON.stringify(x)
      : k === 'bool'
        ? lang === 'python'
          ? x
            ? 'True'
            : 'False'
          : String(x)
        : k === 'float'
          ? Number.isInteger(x)
            ? x.toFixed(1)
            : String(x)
          : String(x);
  if (kind === 'callback' || kind === 'widget' || kind === 'color') return String(v);
  if (kind !== 'ints' && kind !== 'strings') return one(v, kind);
  const k = kind === 'ints' ? (/float|double|Double/.test(type) ? 'float' : 'int') : 'string';
  const items = v.map((x) => one(x, k)).join(', ');
  if (lang === 'go')
    return (
      (type && /^\[\]/.test(type.trim())
        ? type.trim()
        : k === 'string'
          ? '[]string'
          : k === 'float'
            ? '[]float64'
            : '[]int') +
      '{' +
      items +
      '}'
    );
  if (lang === 'kotlin') {
    const of = k === 'string' ? 'String' : k === 'float' ? 'Double' : 'Int';
    if (/IntArray/.test(type)) return 'intArrayOf(' + items + ')';
    if (/^Array</.test(type.trim())) return 'arrayOf<' + of + '>(' + items + ')';
    return 'listOf<' + of + '>(' + items + ')';
  }
  if (lang === 'dart' || lang === 'flutter')
    return '<' + (k === 'string' ? 'String' : k === 'float' ? 'double' : 'int') + '>[' + items + ']';
  return '[' + items + ']';
}
// CALLS WITH NO MODEL: every parameter's kind is known (a parameter whose kind is not, and no call can be written), and each call
// takes the i-th value of each kind. The question's own quoted strings come first for a parameter that takes a string.
export function callsFor(lang, question, codes, name, { most = 8 } = {}) {
  const params = paramsIn(lang, codes, name);
  // (a function, or a widget, that takes nothing has one call)
  if (!params.length) return codes.some((c) => between(c, name) !== null) ? [name + '()'] : [];
  const kinds = params.map(kindOf);
  if (kinds.some((k) => !k)) return [];
  const own = [...String(question || '').matchAll(/"((?:[^"\\\n]|\\.){0,60})"/g)].map((m) => m[1]);
  const out = [];
  for (let i = 0; i < most; i++) {
    const args = params.map((p, k) => {
      const pool = kinds[k] === 'string' ? [...new Set([...own, ...VALUES.string])] : VALUES[kinds[k]];
      // (each parameter starts one further on, so two parameters of a kind are not given the same value every time)
      const lit = literalIn(lang, kinds[k], pool[(i + k) % pool.length], p.type);
      return (p.label ? p.label + ': ' : '') + lit;
    });
    const call = name + '(' + args.join(', ') + ')';
    if (!out.includes(call)) out.push(call);
  }
  return out;
}
export const takesNothing = (lang, codes, name) =>
  codes.some((c) => between(c, name) !== null) && paramsIn(lang, codes, name).length === 0;
// the words a literal call may hold beside its values, by language (anything else names a thing that is not a value)
export const CALL_WORDS = {
  python: ['True', 'False', 'None'],
  go: ['int', 'int64', 'float64', 'string', 'bool', 'byte', 'rune', 'map', 'nil', 'true', 'false'],
  swift: ['nil', 'true', 'false'],
  kotlin: [
    'listOf',
    'mutableListOf',
    'arrayOf',
    'intArrayOf',
    'setOf',
    'mapOf',
    'to',
    'null',
    'true',
    'false',
    'Int',
    'String',
    'Double',
  ],
  dart: ['null', 'true', 'false', 'int', 'String', 'double'],
  flutter: ['null', 'true', 'false', 'int', 'String', 'double', 'const'],
  ts: [],
  js: [],
};

// ---- the box --------------------------------------------------------------------------------------------------------------
const which = (cmd) => {
  for (const dir of (process.env.PATH || '')
    .split(':')
    .concat(['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/usr/local/go/bin'])) {
    const p = path.join(dir, cmd);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return fs.realpathSync(p);
    } catch {
      /* the next folder */
    }
  }
  return '';
};
const firstThere = (...ps) => ps.find((p) => p && fs.existsSync(p)) || '';
// THE TOOLS OF EACH LANGUAGE, WHERE THIS MACHINE HAS THEM (found once; '' where it has none). Dart's own program is taken, not the
// wrapper Flutter puts in front of it (the wrapper writes to Flutter's folder, which the box refuses). Kotlin's compiler is the
// one Android Studio carries where there is no other.
let tools = null;
export function toolsOf() {
  if (tools) return tools;
  const dartWrap = which('dart');
  const flutter = which('flutter');
  const javaHome = (() => {
    try {
      return execFileSync('/usr/libexec/java_home', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return process.env.JAVA_HOME || '';
    }
  })();
  const xcrun = (args) => {
    try {
      return execFileSync('/usr/bin/xcrun', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  };
  tools = {
    python: which('python3'),
    go: which('go'),
    // (the compiler itself and the system's library folder, found once out of the box: the wrapper in front of them keeps a
    // note of where they are in a folder the box refuses)
    swift: xcrun(['-f', 'swiftc']) || which('swiftc'),
    swiftSdk: xcrun(['--show-sdk-path']),
    dart: firstThere(
      flutter && path.join(path.dirname(flutter), 'cache/dart-sdk/bin/dart'),
      dartWrap && path.join(path.dirname(dartWrap), 'cache/dart-sdk/bin/dart'),
      dartWrap && !/flutter/.test(dartWrap) ? dartWrap : '',
    ),
    kotlin: firstThere(
      which('kotlinc'),
      '/Applications/Android Studio.app/Contents/plugins/Kotlin/kotlinc/bin/kotlinc',
    ),
    javaHome,
    flutter: (() => {
      if (!flutter) return null;
      const root = path.dirname(path.dirname(flutter));
      const engine = path.join(root, 'bin/cache/artifacts/engine');
      const f = {
        bin: flutter,
        root,
        tester: path.join(engine, 'darwin-x64/flutter_tester'),
        frontend: path.join(engine, 'darwin-x64/frontend_server_aot.dart.snapshot'),
        sdkRoot: path.join(engine, 'common/flutter_patched_sdk') + '/',
        aot: path.join(root, 'bin/cache/dart-sdk/bin/dartaotruntime'),
      };
      return [f.tester, f.frontend, f.sdkRoot, f.aot].every((x) => fs.existsSync(x)) ? f : null;
    })(),
  };
  return tools;
}
const boxThere = () => process.platform === 'darwin' && fs.existsSync(SANDBOX_EXEC);
// THE PROFILE: nothing is allowed but what is named. No network. Writes only to the run's folder. Nothing of /Users is read but
// the run's folder and the tools that live there (a compiler kept in the person's folder).
function profileFor(dir, extraRead = []) {
  const q = (p) => '"' + p.replace(/"/g, '\\"') + '"';
  const reads = [dir, BASE, ...extraRead.filter((p) => p && p.startsWith('/Users/'))];
  return [
    '(version 1)',
    '(deny default)',
    '(allow process-fork)',
    '(allow process-exec)',
    '(allow signal (target same-sandbox))',
    '(allow sysctl-read)',
    '(allow mach-lookup)',
    '(allow ipc-posix-shm)',
    '(allow file-read*)',
    '(deny file-read* (subpath "/Users"))',
    '(allow file-read-metadata (subpath "/Users"))',
    '(allow file-read* ' + reads.map((p) => '(subpath ' + q(p) + ')').join(' ') + ')',
    '(allow file-write* (subpath ' +
      q(dir) +
      ') (subpath ' +
      q(path.join(BASE, 'cache')) +
      ') (literal "/dev/null") (literal "/dev/dtracehelper"))',
    '(deny network*)',
  ].join('\n');
}
// one command in the box: -> { code, out } ; killed with all it started when its time is up
function boxed(dir, argv, { timeoutMs = 8000, env = {}, extraRead = [] } = {}) {
  return new Promise((done) => {
    const prof = path.join(dir, 'box.sb');
    if (!fs.existsSync(prof)) fs.writeFileSync(prof, profileFor(dir, extraRead));
    let child;
    try {
      child = spawn(SANDBOX_EXEC, ['-f', prof, ...argv], {
        cwd: dir,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin',
          HOME: dir,
          TMPDIR: path.join(dir, 'tmp'),
          LANG: 'en_US.UTF-8',
          ...env,
        },
      });
    } catch {
      return done({ code: -1, out: '', err: '' });
    }
    let out = '';
    let err = '';
    const stop = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* it had ended */
      }
    };
    const timer = setTimeout(stop, timeoutMs);
    child.stdout.on('data', (c) => out.length < 200000 && (out += c));
    child.stderr.on('data', (c) => err.length < 20000 && (err += c));
    child.on('error', () => done({ code: -1, out, err }));
    child.on('close', (code) => {
      clearTimeout(timer);
      stop();
      if (process.env.SWOA_BOX_DEBUG)
        console.error('[box]', argv.slice(0, 4).join(' '), '->', code, (err + out).slice(0, 1200));
      done({ code, out, err });
    });
  });
}
// what a run printed for each call: lines `MARK i v <text>` and `MARK i e`
function readMarks(out, n, into = new Array(n).fill(null)) {
  for (const line of String(out || '').split(/\r?\n/)) {
    const at = line.indexOf(MARK);
    if (at < 0) continue;
    const m = line.slice(at + MARK.length).match(/^ (\d+) (v|e) ?(.*)$/s);
    if (!m || Number(m[1]) >= n) continue;
    into[Number(m[1])] = m[2] === 'e' ? { e: true } : { v: m[3].slice(0, 4000) };
  }
  return into;
}
// the calls a compiler refused, by the lines of the file they were written on ({ line: index of the call })
const refused = (err, file, lineOf) => {
  const bad = new Set();
  for (const m of String(err || '').matchAll(new RegExp(file.replace('.', '\\.') + ':(\\d+)', 'g')))
    if (lineOf[m[1]] !== undefined) bad.add(lineOf[m[1]]);
  return bad;
};
// a function called main in the draft is renamed: the run has a main of its own
const noMain = (code, re, to) => String(code).replace(re, to);

// ---- each language: the files of a run, how it is made ready, and how a call is run ----------------------------------------
// files(code, calls, skip) -> { name: text, lineOf: { line: call index } } ; skip: calls the compiler refused, left out
const PY_RUN = `import sys, json, io, contextlib
MARK = ${JSON.stringify(MARK)}
def canon(v):
    def d(o):
        if isinstance(o, (set, frozenset)):
            return sorted(o, key=repr)
        if isinstance(o, (bytes, bytearray)):
            return o.decode('utf8', 'replace')
        return repr(o)
    try:
        return json.dumps(v, default=d, sort_keys=True)
    except Exception:
        return json.dumps(repr(v))
code = open('draft.py').read()
calls = json.load(open('calls.json'))
i = int(sys.argv[1])
ns = {'__name__': '__draft__'}
real = sys.stdout
try:
    with contextlib.redirect_stdout(io.StringIO()):
        exec(compile(code, 'draft.py', 'exec'), ns)
        v = eval(calls[i], ns)
    real.write(MARK + ' %d v %s\\n' % (i, canon(v)))
except BaseException:
    real.write(MARK + ' %d e\\n' % i)
`;
const numbered = (head, lines, tail) => {
  const lineOf = {};
  const at = head.split('\n').length;
  lines.forEach((l, k) => l.call !== undefined && (lineOf[at + 1 + k] = l.call));
  return { text: head + '\n' + lines.map((l) => l.text).join('\n') + '\n' + tail, lineOf };
};
const SPECS = {
  python: {
    perCall: true,
    files: (code, calls) => ({ 'draft.py': code, 'calls.json': JSON.stringify(calls), 'run.py': PY_RUN }),
    ready: async () => true,
    run: (t, i) => [t.python, '-I', '-B', 'run.py', String(i)],
  },
  go: {
    perCall: true,
    main: 'main.go',
    files(code, calls, skip) {
      const draft = noMain(
        String(code).replace(/^\s*package\s+\w+\s*$/m, ''),
        /\bfunc\s+main\s*\(\s*\)/,
        'func draftMain()',
      );
      const head =
        'package main\nimport (\n\t"encoding/json"\n\t"fmt"\n\t"os"\n\t"strconv"\n)\n' +
        'func emitAt(i int, v ...any) {\n\tfor k, x := range v {\n\t\tif e, ok := x.(error); ok && e != nil {\n\t\t\tv[k] = e.Error()\n\t\t}\n\t}\n' +
        '\tvar x any = v\n\tif len(v) == 1 {\n\t\tx = v[0]\n\t}\n\tb, err := json.Marshal(x)\n\tif err != nil {\n\t\tb, _ = json.Marshal(fmt.Sprintf("%#v", x))\n\t}\n' +
        `\tfmt.Println(${JSON.stringify(MARK)}, i, "v", string(b))\n}\n` +
        'var at int\nfunc emit(v ...any) { emitAt(at, v...) }\n' +
        `func main() {\n\tat, _ = strconv.Atoi(os.Args[1])\n\tdefer func() {\n\t\tif r := recover(); r != nil {\n\t\t\tfmt.Println(${JSON.stringify(MARK)}, at, "e")\n\t\t}\n\t}()\n\tswitch at {`;
      const m = numbered(
        head,
        calls.map((c, i) => ({ text: skip.has(i) ? '\t// refused' : '\tcase ' + i + ': emit(' + c + ')', call: i })),
        '\t}\n}\n',
      );
      return {
        'go.mod': 'module box\n\ngo 1.21\n',
        'draft.go': 'package main\n' + draft + '\n',
        'main.go': m.text,
        lineOf: m.lineOf,
      };
    },
    env: (dir) => ({
      GOCACHE: path.join(BASE, 'cache', 'go'),
      GOPATH: path.join(dir, 'gopath'),
      GOFLAGS: '-mod=mod',
      GOPROXY: 'off',
      GOTOOLCHAIN: 'local',
      GONOSUMDB: '*',
      CGO_ENABLED: '0',
    }),
    build: (t) => [t.go, 'build', '-o', 'box-bin', '.'],
    buildMs: 60000,
    run: () => ['./box-bin'],
  },
  swift: {
    perCall: true,
    main: 'main.swift',
    files(code, calls, skip) {
      const draft = String(code).replace(/^\s*@main\s*$/m, '');
      const head =
        'import Foundation\n' +
        `func __emit<T>(_ i: Int, _ v: T) { print("${MARK} \\(i) v " + String(reflecting: v)) }\n` +
        draft +
        '\nlet __i = Int(CommandLine.arguments[1])!\nswitch __i {';
      const m = numbered(
        head,
        calls.map((c, i) => ({
          text: skip.has(i)
            ? '// refused'
            : 'case ' + i + ': do { __emit(' + i + ', try ' + c + ') } catch { print("' + MARK + ' ' + i + ' e") }',
          call: i,
        })),
        'default: break\n}\n',
      );
      return { 'main.swift': m.text, lineOf: m.lineOf };
    },
    build: (t) => [
      t.swift,
      '-suppress-warnings',
      ...(t.swiftSdk ? ['-sdk', t.swiftSdk] : []),
      '-module-cache-path',
      path.join(BASE, 'cache', 'swift'),
      '-o',
      'box-bin',
      'main.swift',
    ],
    buildMs: 90000,
    run: () => ['./box-bin'],
  },
  dart: {
    perCall: true,
    main: 'main.dart',
    files(code, calls, skip) {
      const src = noMain(code, /\bmain\s*\(/, 'draftMain(');
      const imports = [...src.matchAll(/^\s*import\s+['"][^'"]+['"][^;]*;\s*$/gm)].map((m) => m[0].trim());
      const body = src.replace(/^\s*import\s+['"][^'"]+['"][^;]*;\s*$/gm, '');
      const head =
        [...new Set(["import 'dart:convert';", ...imports])].join('\n') +
        '\n' +
        'String __t(dynamic v) { try { return jsonEncode(v); } catch (_) { return jsonEncode(v.toString()); } }\n' +
        body +
        '\nvoid main(List<String> __a) {\n  final __i = int.parse(__a[0]);\n  final __f = <int, dynamic Function()>{';
      const m = numbered(
        head,
        calls.map((c, i) => ({ text: skip.has(i) ? '    // refused' : '    ' + i + ': () => ' + c + ',', call: i })),
        `  };\n  try { print('${MARK} $__i v ' + __t(__f[__i]!())); } catch (_) { print('${MARK} $__i e'); }\n}\n`,
      );
      return { 'main.dart': m.text, lineOf: m.lineOf };
    },
    // (made ready by a first run that calls nothing: what it says of the file is what a compiler would)
    build: (t) => [t.dart, 'compile', 'kernel', '-o', 'box.dill', 'main.dart'],
    buildMs: 60000,
    run: (t) => [t.dart, 'run', 'box.dill'],
  },
  // FLUTTER: compiled against Flutter itself and run in Flutter's own tester, which has no screen and needs none. A call that
  // gives a widget has the widget built, and what stands for it is what it shows: its texts and the widgets under it.
  flutter: {
    perCall: false,
    main: 'main.dart',
    files(code, calls, skip) {
      const src = noMain(code, /\bmain\s*\(/, 'draftMain(');
      const imports = [...src.matchAll(/^\s*import\s+['"][^'"]+['"][^;]*;\s*$/gm)].map((m) => m[0].trim());
      const body = src.replace(/^\s*import\s+['"][^'"]+['"][^;]*;\s*$/gm, '');
      const head =
        [
          ...new Set([
            "import 'dart:convert';",
            "import 'dart:io';",
            "import 'package:flutter/material.dart';",
            "import 'package:flutter_test/flutter_test.dart';",
            ...imports,
          ]),
        ].join('\n') +
        '\n' +
        'String __t(dynamic v) { try { return jsonEncode(v); } catch (_) { return jsonEncode(v.toString()); } }\n' +
        body +
        '\nvoid main() {\n  final __f = <int, dynamic Function()>{';
      const m = numbered(
        head,
        calls.map((c, i) => ({ text: skip.has(i) ? '    // refused' : '    ' + i + ': () => ' + c + ',', call: i })),
        '  };\n' +
          '  tearDownAll(() async { await stdout.flush(); exit(0); });\n' +
          '  for (final __e in __f.entries) {\n' +
          "    testWidgets('c${__e.key}', (tester) async {\n" +
          '      try {\n' +
          '        final v = __e.value();\n' +
          '        if (v is Widget) {\n' +
          '          await tester.pumpWidget(MaterialApp(home: Material(child: v)));\n' +
          '          final ex = tester.takeException();\n' +
          '          if (ex != null) throw ex;\n' +
          '          final under = find.descendant(of: find.byWidget(v), matching: find.bySubtype<Widget>());\n' +
          "          final types = tester.widgetList(under).map((w) => w.runtimeType.toString()).where((t) => !t.startsWith('_')).toList();\n" +
          "          final texts = tester.widgetList<Text>(find.descendant(of: find.byWidget(v), matching: find.byType(Text))).map((t) => t.data ?? t.textSpan?.toPlainText() ?? '').toList();\n" +
          `          print('${MARK} \${__e.key} v ' + jsonEncode({'texts': texts, 'widgets': types}));\n` +
          '        } else {\n' +
          `          print('${MARK} \${__e.key} v ' + __t(v));\n` +
          '        }\n' +
          '      } catch (_) {\n' +
          `        print('${MARK} \${__e.key} e');\n` +
          '      }\n' +
          '    });\n' +
          '  }\n}\n',
      );
      return { 'main.dart': m.text, lineOf: m.lineOf };
    },
    build: (t) => [
      t.flutter.aot,
      t.flutter.frontend,
      '--sdk-root',
      t.flutter.sdkRoot,
      '--target=flutter',
      '--packages',
      flutterPackagesOf(),
      '--output-dill',
      'box.dill',
      'main.dart',
    ],
    buildMs: 90000,
    failed: (b, dir) => !fs.existsSync(path.join(dir, 'box.dill')) || /: Error: /.test(b.out + b.err),
    all: (t, dir) => [
      t.flutter.tester,
      '--non-interactive',
      '--run-forever',
      '--disable-vm-service',
      '--use-test-fonts',
      '--flutter-assets-dir=' + dir,
      'box.dill',
    ],
    allMs: 40000,
  },
  kotlin: {
    perCall: false,
    main: 'main.kts',
    files(code, calls, skip) {
      const head =
        'fun __t(v: Any?): String = when (v) {\n  is IntArray -> v.toList().toString()\n  is LongArray -> v.toList().toString()\n  is DoubleArray -> v.toList().toString()\n' +
        '  is BooleanArray -> v.toList().toString()\n  is CharArray -> v.toList().toString()\n  is Array<*> -> v.toList().toString()\n  is String -> "\\"" + v + "\\""\n  else -> v.toString()\n}\n' +
        String(code) +
        '\nval __calls = mapOf<Int, () -> Any?>(';
      const m = numbered(
        head,
        calls.map((c, i) => ({ text: skip.has(i) ? '  // refused' : '  ' + i + ' to { ' + c + ' },', call: i })),
        `)\nfor ((i, c) in __calls) { try { println("${MARK} $i v " + __t(c())) } catch (e: Throwable) { println("${MARK} $i e") } }\n`,
      );
      return { 'main.kts': m.text, lineOf: m.lineOf };
    },
    env: (dir, t) => ({
      JAVA_HOME: t.javaHome,
      JAVA_OPTS: '-Djava.io.tmpdir=' + path.join(dir, 'tmp') + ' -Duser.home=' + dir + ' -Xmx512m',
    }),
    all: (t) => [t.kotlin, '-nowarn', '-script', 'main.kts'],
    allMs: 90000,
  },
};
const toolOf = (lang) =>
  lang === 'kotlin'
    ? toolsOf().kotlin && toolsOf().javaHome
    : lang === 'flutter'
      ? toolsOf().flutter && flutterPackagesOf()
      : toolsOf()[lang];

let flutterPackages = null;
function flutterPackagesOf() {
  if (flutterPackages !== null) return flutterPackages;
  const t = toolsOf().flutter;
  const dir = path.join(BASE, 'cache', 'flutter-template');
  const file = path.join(dir, '.dart_tool', 'package_config.json');
  flutterPackages = '';
  if (!t) return '';
  try {
    if (!fs.existsSync(file)) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'pubspec.yaml'),
        'name: box\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n',
      );
      execFileSync(t.bin, ['pub', 'get', '--offline'], { cwd: dir, stdio: 'ignore', timeout: 120000 });
    }
    if (fs.existsSync(file)) flutterPackages = file;
  } catch {
    /* Flutter's packages are not all on this machine: Flutter code is not run */
  }
  return flutterPackages;
}
// what was run is remembered, as sandbox.mjs remembers (the same function on the same calls gives the same answers)
const seen = new Map();
let runs = 0;
// -> [{ v } | { e }] for each call, or null: the code does not run at all (it does not compile, or no call gave anything)
async function runBoxed(lang, code, calls, { callMs = 3000 } = {}) {
  const spec = SPECS[lang];
  const t = toolsOf();
  if (!spec || !toolOf(lang) || !boxThere()) return null;
  const dir = path.join(
    BASE,
    'run-' +
      process.pid +
      '-' +
      ++runs +
      '-' +
      createHash('sha1')
        .update(lang + code)
        .digest('hex')
        .slice(0, 8),
  );
  fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(BASE, 'cache'), { recursive: true });
  const env = spec.env ? spec.env(dir, t) : {};
  const extraRead = [
    typeof t[lang] === 'string' ? t[lang] : '',
    t.javaHome,
    lang === 'kotlin' ? path.dirname(path.dirname(t.kotlin)) : '',
    ...(lang === 'flutter' ? [t.flutter.root, path.join(os.homedir(), '.pub-cache')] : []),
  ].filter(Boolean);
  const opts = { env, extraRead };
  try {
    let skip = new Set();
    let out = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const files = spec.files(code, calls, skip);
      for (const [name, text] of Object.entries(files))
        if (name !== 'lineOf') fs.writeFileSync(path.join(dir, name), text);
      if (spec.build) {
        fs.rmSync(path.join(dir, 'box.dill'), { force: true });
        const b = await boxed(dir, spec.build(t), { ...opts, timeoutMs: spec.buildMs });
        if (spec.failed ? spec.failed(b, dir) : b.code !== 0) {
          const bad = refused(b.err + b.out, spec.main, files.lineOf || {});
          // (the draft itself does not compile, or the same calls were refused again: it does not run)
          if (!bad.size || attempt) return null;
          skip = bad;
          continue;
        }
      }
      if (spec.all) {
        const r = await boxed(dir, spec.all(t, dir), { ...opts, timeoutMs: spec.allMs });
        out = readMarks(r.out, calls.length);
        if (out.some(Boolean)) break;
        const bad = refused(r.err + r.out, spec.main, files.lineOf || {});
        if (!bad.size || attempt) return null;
        skip = bad;
        continue;
      }
      out = new Array(calls.length).fill(null);
      await Promise.all(
        calls.map(async (_, i) => {
          if (skip.has(i)) return;
          const r = await boxed(dir, [...spec.run(t, i), ...(spec.build ? [String(i)] : [])], {
            ...opts,
            timeoutMs: callMs,
          });
          readMarks(r.out, calls.length, out);
        }),
      );
      break;
    }
    if (!out) return null;
    const rows = out.map((o) => o || { e: true });
    return rows.some((o) => !o.e) ? rows : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
// TypeScript: its types are taken off, and it runs where JavaScript runs
const stripTypes = (code) => {
  try {
    return typeof nodeModule.stripTypeScriptTypes === 'function' ? nodeModule.stripTypeScriptTypes(String(code)) : null;
  } catch {
    return null;
  }
};
export function callsIn(lang, code, name, calls, opts = {}) {
  if (lang === 'js') return jsCallsOf(code, name, calls, opts);
  if (lang === 'ts') {
    const js = stripTypes(code);
    return js === null ? Promise.resolve(null) : jsCallsOf(js, name, calls, opts);
  }
  // (Dart that is Flutter's is run as Flutter, and Flutter's that needs nothing of Flutter still runs there)
  if (lang === 'dart' && MARKS.flutter.test(String(code))) lang = 'flutter';
  const key = lang + '\n' + code + '\n' + calls.join('\n');
  if (seen.has(key)) return seen.get(key);
  if (seen.size >= 200) seen.clear();
  const p = runBoxed(lang, String(code), calls, opts);
  seen.set(key, p);
  return p;
}
// WHAT A WHOLE PYTHON PROGRAM PRINTS, run once in the box as it stands: { text } (what it printed, trimmed), or null where
// Python cannot be run here, the program fails or runs out of time, or it prints nothing. (A slot that answers by a program.)
export async function printedByPython(code, { timeoutMs = 6000 } = {}) {
  const t = toolsOf();
  if (!t.python || !boxThere() || !String(code || '').trim()) return null;
  const dir = path.join(BASE, 'print-' + process.pid + '-' + ++runs);
  fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  try {
    fs.writeFileSync(path.join(dir, 'prog.py'), String(code));
    const r = await boxed(dir, [t.python, '-I', '-B', 'prog.py'], { timeoutMs, extraRead: [t.python] });
    const text = String(r.out || '').trim();
    return r.code === 0 && text ? { text: text.slice(0, 4000) } : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
// CAN THIS LANGUAGE BE RUN HERE? Asked once for each: a function that returns 1, run in the box.
const ONE = {
  python: ['def one():\n    return 1\n', 'one()'],
  go: ['func one() int { return 1 }\n', 'one()'],
  swift: ['func one() -> Int { return 1 }\n', 'one()'],
  dart: ['int one() { return 1; }\n', 'one()'],
  kotlin: ['fun one(): Int { return 1 }\n', 'one()'],
  flutter: ['int one() { return 1; }\n', 'one()'],
};
const readyBy = {};
export function langReady(lang) {
  if (lang === 'js') return sandboxReady();
  if (lang === 'ts') return sandboxReady().then((ok) => ok && stripTypes('const a: number = 1;') !== null);
  if (!ONE[lang]) return Promise.resolve(false);
  readyBy[lang] =
    readyBy[lang] || runBoxed(lang, ONE[lang][0], [ONE[lang][1]]).then((o) => !!(o && o[0] && o[0].v === '1'));
  return readyBy[lang];
}
export const LANGS = ['js', 'ts', 'python', 'go', 'swift', 'dart', 'flutter', 'kotlin'];
