// tools.mjs - A TURN WITH TOOLS, DECIDED BY THE SWARM. An agent (The Crew's Pi, for one) works by tools: each turn its model either
// calls a tool (read a file, edit one, list a folder) or replies. With `tools: "swarm"` (src/config.json; the dashboard's
// Configuration) such a turn is not handed to one model: every drafter proposes the next action, a proposal that is not a call
// the caller offered (a tool it does not have, arguments that are not a JSON object) is left out, the proposals that are the same
// action are one, and where they differ the decider picks. With `tools: "lead"` the turn goes to the model in place a, as it came.
//   actionOf(message, tools)  -> { calls: [{ name, args }] } | { reply } | { bad }     a model's message, read as an action
//   actionText(action)        -> one line per call ("CALL read {"path":"a.js"}"), or the reply: how an action is written down
//   parseAction(text)         -> the action a line of text names (the trainers grade by it)
//   sameAction(a, b)          -> the same calls with the same arguments (strings trimmed, a leading ./ dropped), or both replies
//   answerTools(messages, { tools, tool_choice, briefs, ask, decide, lead }) -> { ok, action, calls, reply, text, path, trace, ms }
const canon = (x) =>
  Array.isArray(x)
    ? x.map(canon)
    : x && typeof x === 'object'
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canon(x[k])]),
        )
      : typeof x === 'string'
        ? x.trim()
        : x;
const loose = (x) =>
  Array.isArray(x)
    ? x.map(loose)
    : x && typeof x === 'object'
      ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, loose(v)]))
      : typeof x === 'string'
        ? x.trim().replace(/^\.\//, '')
        : x;

export const toolNames = (tools) =>
  (Array.isArray(tools) ? tools : []).map((t) => (t && (t.function ? t.function.name : t.name)) || '').filter(Boolean);

export function actionOf(msg, tools) {
  const names = toolNames(tools);
  const calls = (msg && Array.isArray(msg.tool_calls) ? msg.tool_calls : []).map((c) => {
    const f = (c && (c.function || c)) || {};
    let args = f.arguments;
    if (typeof args === 'string') {
      try {
        args = args.trim() ? JSON.parse(args) : {};
      } catch {
        return { bad: 'its arguments to ' + f.name + ' are not JSON' };
      }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args))
      return { bad: 'its arguments to ' + f.name + ' are not an object' };
    if (names.length && !names.includes(f.name))
      return { bad: 'it called ' + f.name + ', which is not one of the tools offered' };
    return { name: String(f.name || ''), args: canon(args) };
  });
  const bad = calls.find((c) => c.bad);
  if (bad) return { bad: bad.bad };
  if (calls.length) return { calls };
  const reply = String((msg && msg.content) || '').trim();
  return reply ? { reply } : { bad: 'it gave neither a call nor a reply' };
}

export const actionText = (a) =>
  a.calls ? a.calls.map((c) => 'CALL ' + c.name + ' ' + JSON.stringify(c.args)).join('\n') : a.reply || '';

export function parseAction(text) {
  const t = String(text || '').trim();
  const lines = t.split('\n').filter((l) => l.trim());
  if (lines.length && lines.every((l) => /^CALL \S+ \{/.test(l.trim()))) {
    const calls = [];
    for (const l of lines) {
      const m = /^CALL (\S+) (\{[\s\S]*\})\s*$/.exec(l.trim());
      try {
        calls.push({ name: m[1], args: canon(JSON.parse(m[2])) });
      } catch {
        return { reply: t };
      }
    }
    return { calls };
  }
  return { reply: t };
}

export function sameAction(a, b) {
  if (!a || !b) return false;
  if (a.calls && b.calls)
    return (
      a.calls.length === b.calls.length &&
      a.calls.every(
        (c, i) =>
          c.name === b.calls[i].name && JSON.stringify(loose(c.args)) === JSON.stringify(loose(b.calls[i].args)),
      )
    );
  return !a.calls && !b.calls && !!a.reply && !!b.reply;
}

let n = 0;
const asCalls = (action) =>
  (action.calls || []).map((c) => ({
    id: 'call_swarm_' + Date.now().toString(36) + '_' + ++n,
    type: 'function',
    function: { name: c.name, arguments: JSON.stringify(c.args) },
  }));

// the turn itself: one proposal from each drafter, the same ones made one, the decider where they differ
export async function answerTools(messages, { tools = [], tool_choice, briefs, ask, decide, lead = 'a' } = {}) {
  const t0 = Date.now();
  const drafters = (briefs.slots || []).filter((s) => s.stage === 'draft');
  const who = drafters.length ? drafters : [{ id: 'lead', member: lead, stage: 'draft', maxTokens: 700 }];
  const trace = [];
  await Promise.all(
    who.map(async (s) => {
      const t1 = Date.now();
      try {
        const r = await ask(s, messages, { tools, ...(tool_choice !== undefined ? { tool_choice } : {}) });
        const action = actionOf({ content: r.content !== undefined ? r.content : r.text, tool_calls: r.calls }, tools);
        trace.push({
          slot: s.id,
          member: s.member,
          stage: 'draft',
          ms: Date.now() - t1,
          tokens: r.tokens || 0,
          ok: !action.bad,
          final: action.bad ? '' : actionText(action),
          out: action.bad ? 'Left out: ' + action.bad + '.' : actionText(action),
          action,
        });
      } catch (e) {
        trace.push({
          slot: s.id,
          member: s.member,
          stage: 'draft',
          ms: Date.now() - t1,
          ok: false,
          final: '',
          out: 'Failed: ' + String((e && e.message) || e).slice(0, 160),
        });
      }
    }),
  );
  // in the order the drafters stand, so that a tie goes to the first (the lead's own drafter first)
  trace.sort((x, y) => who.findIndex((s) => s.id === x.slot) - who.findIndex((s) => s.id === y.slot));
  const good = trace.filter((r) => r.ok);
  if (!good.length) return { ok: false, path: 'none', trace, ms: Date.now() - t0, text: '', reply: '', calls: [] };
  const groups = [];
  for (const r of good) {
    const g = groups.find(
      (x) =>
        sameAction(x.action, r.action) && (!!x.action.calls || x.action.reply === r.action.reply || !r.action.calls),
    );
    if (g) g.rows.push(r);
    else groups.push({ action: r.action, rows: [r] });
  }
  let pick = groups[0];
  let path = 'agreed';
  if (groups.length > 1) {
    const most = [...groups].sort((x, y) => y.rows.length - x.rows.length)[0];
    pick = most;
    path = 'most';
    if (decide) {
      const letters = groups.map((_, i) => String.fromCharCode(65 + i));
      const last = [...messages].reverse().find((m) => m.role === 'user' || m.role === 'tool');
      const k = await decide({
        question:
          'An agent with tools (' +
          toolNames(tools).join(', ') +
          ') is at this point in its work: ' +
          String((last && last.content) || '').slice(0, 1200) +
          '\nWhich next step is right? Each answer is one or more tool calls (CALL name arguments) or a reply.',
        answers: groups.map((g, i) => ({
          letter: letters[i],
          final: actionText(g.action),
          work: g.rows.length + ' of the drafters proposed this',
        })),
        checks: [],
      });
      trace.push({
        slot: 'decide',
        member: 'decider',
        stage: 'decide',
        ms: k.ms || 0,
        ok: !!k.ok,
        final: k.ok ? k.final : '',
        out: k.ok
          ? 'Picked ' + k.letter + '.'
          : 'Decided nothing: ' + (k.why || 'no reason given') + '. The step most drafters proposed stands.',
        probs: k.probs,
        ...(k.retried ? { retried: true } : {}),
      });
      if (k.ok) {
        pick = groups[letters.indexOf(k.letter)] || most;
        path = 'decided';
      }
    }
  }
  const action = pick.action.calls ? pick.action : { reply: pick.rows[0].action.reply };
  return {
    ok: true,
    action,
    calls: asCalls(action),
    reply: action.reply || '',
    text: actionText(action),
    decided: actionText(action),
    path: 'tools-' + path,
    trace: trace.map(({ action: _a, ...r }) => r),
    ms: Date.now() - t0,
  };
}
