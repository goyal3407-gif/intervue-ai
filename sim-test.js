// Simulation test: ai-engine.js (v3.0 shared engine — dono pages yahi
// istemal karte hain) ke asli engine functions ko nikaal kar mocked fetch
// ke saath chalata hai — galat key, khali jawab, error JSON, hedge, photo
// sawal, timeout, network fail, 403/500/503, interrupted stream, malformed
// SSE, mid-stream cancel, privacy, retry-after, cache, usage, merge rules.
const fs = require('fs');
const script = fs.readFileSync(__dirname + '/ai-engine.js', 'utf8');

function extract(name) {
  const re = new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = script.match(re);
  if (!m) throw new Error('function not found: ' + name);
  let i = script.indexOf('{', m.index);
  let depth = 0;
  const start = m.index;
  for (; i < script.length; i++) {
    if (script[i] === '{') depth++;
    else if (script[i] === '}') { depth--; if (depth === 0) return script.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function extractConst(name) {
  const idx = script.indexOf('const ' + name + ' = {');
  if (idx < 0) throw new Error('const not found: ' + name);
  let i = script.indexOf('{', idx);
  let depth = 0;
  for (; i < script.length; i++) {
    if (script[i] === '{') depth++;
    else if (script[i] === '}') { depth--; if (depth === 0) return script.slice(idx, i + 1) + ';'; }
  }
  throw new Error('unbalanced const: ' + name);
}

const prelude = `
const settings = { provider: 'groq', fast: false, turbo: false, muted: true, lang: 'en', debugLog: false, theme: 'dark', approved: null, cacheEnabled: false, cacheHours: 24, dailyLimit: 0, warnAt: 0, retentionDays: 30 };
let convo = [];
let lastAiError = '';
let lastWin = { pid: '', model: '' };
let lastBlocked = [];
const cooldowns = {};
const ttftStats = {};
const failCounts = {};
const window = {};
const document = { getElementById: () => null };
const localStorage = { _d: {}, getItem(k) { return k in this._d ? this._d[k] : null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
const AI_HOOKS = { profileText: null, getCustoms: null, getProviders: null, getGroqKeyStr: null, storageRead: null, storageWrite: null, pushShared: null, pullShared: null };
const resultStats = {};
let reqSeq = 0;
const requestLog = [];
function teacherPrompt() { return 'SYS'; }
function updateHealth() {}
function queueScroll() {}
function scheduleShareState() {}
function customProviders() { return []; }
`;

const fns = ['setCooldown', 'keyOrderFor', 'recordTtft', 'avgTtft', 'logCall', 'readSse', 'openAiCall', 'openAiCallInner', 'tryOpenAI', 'tryGemini', 'tryGeminiInner', 'tryCustom', 'answerInto', 'keyCount', 'geminiContents', 'convoDigest', 'runAttempts', 'allowedApiHost', 'apiFetch', 'gateAcquire', 'gateRelease', 'hashStr', 'cacheKeyFor', 'loadCache', 'saveCache', 'cacheGet', 'cacheSet', 'todayStr', 'loadUsage', 'saveUsage', 'recordUsageReq', 'addUsageTokens', 'usageTodayCount', 'engineProfile', 'engineCustom', 'engineCustoms', 'engineProviders', 'storageReadStr', 'storageWriteStr', 'mergeUsageData', 'mergeCacheData', 'mergeCooldownData', 'serializeCooldowns', 'recordResult', 'successRate', 'nextReqId', 'bubbleWrite', 'shareStateNow', 'mergeSharedState']
  .map(extract).join('\n');
const inflight = extractConst('inFlightCount');
const providers = extractConst('PROVIDERS');

const tests = `
const enc = new TextEncoder();
function sseRes(chunks, delayMs, signal) {
  let i = 0;
  return {
    ok: true, status: 200,
    body: { getReader: () => ({
      read: async () => {
        if (signal && signal.aborted) throw new Error('AbortError');
        if (delayMs && i === 0) {
          await new Promise((res2, rej) => {
            const t = setTimeout(res2, delayMs);
            if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('AbortError')); }, { once: true });
          });
        }
        if (i >= chunks.length) return { done: true };
        return { done: false, value: enc.encode(chunks[i++]) };
      },
      cancel: async () => {}
    }) },
    json: async () => null
  };
}
function errRes(status, msg, hdrs) {
  return { ok: false, status: status, body: null, headers: { get: (h) => (hdrs && hdrs[String(h).toLowerCase()]) || null }, json: async () => ({ error: { message: msg } }) };
}
function chunk(t) { return 'data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\\n\\n'; }
const DONE = 'data: [DONE]\\n\\n';
function bubble() { return { _txt: { textContent: '' }, _status: { textContent: '' } }; }
let PASS = 0, FAIL = 0;
function check(name, cond) { if (cond) { PASS++; console.log('PASS', name); } else { FAIL++; console.log('FAIL', name); } }

(async () => {
  // CASE 1: galat key (401) -> agli key, aur galat key session ke liye disable
  globalThis.fetch = async (url, opts) => {
    const auth = opts.headers.Authorization || '';
    if (auth.includes('BADKEY')) return errRes(401, 'Invalid API Key');
    return sseRes([chunk('Hello'), chunk(' world'), DONE]);
  };
  let r = await openAiCall('groq', 'https://api.groq.com/openai/v1', 'Groq', ['m1'], ['BADKEY', 'GOODKEY'], 'sawal', null, bubble(), null, null);
  check('galat key par fallback chala', r === 'Hello world');
  check('galat key session-disable (cooldown Infinity)', cooldowns['groq#0'] === Infinity);
  check('order me disabled key sabse peeche', keyOrderFor('groq', ['BADKEY', 'GOODKEY'])[0] === 1);

  // CASE 2: khali response = failure, agla provider jeeta (hedged runner)
  const attEmpty = { id: 'groq', name: 'Groq', run: async () => {
    globalThis.fetch = async () => sseRes([DONE]);
    return await openAiCall('groq', 'https://api.groq.com/openai/v1', 'Groq', ['m1'], ['K1'], 'sawal', null, bubble(), null, null);
  } };
  const attGood = { id: 'cerebras', name: 'Cerebras', run: async () => {
    globalThis.fetch = async () => sseRes([chunk('Dusra jawab'), DONE]);
    return await openAiCall('cerebras', 'https://api.cerebras.ai/v1', 'Cerebras', ['m1'], ['K2'], 'sawal', null, bubble(), null, null);
  } };
  r = await runAttempts([attEmpty, attGood], bubble(), null);
  check('khali jawab = failure, dusra provider jeeta', r === 'Dusra jawab');

  // CASE 3: stream me error JSON (HTTP 200 ke saath) = failure
  globalThis.fetch = async () => sseRes(['data: ' + JSON.stringify({ error: { message: 'boom' } }) + '\\n\\n']);
  r = await openAiCall('groq', 'https://api.groq.com/openai/v1', 'Groq', ['m1'], ['K1'], 'sawal', null, bubble(), null, null);
  check('error JSON stream = failure', r === null);

  // CASE 4: HEDGE — pehla provider dheere (3s), dusra 2s par start hokar jeeta
  const slow = { id: 'groq', name: 'Groq', run: async (b, race) => {
    globalThis.fetch = async (url, opts) => sseRes([chunk('Dheere jawab'), DONE], 3000, opts.signal);
    return await openAiCall('groq', 'https://api.groq.com/openai/v1', 'Groq', ['m1'], ['K1'], 'sawal', null, b, race, null);
  } };
  const fast = { id: 'cerebras', name: 'Cerebras', run: async (b, race) => {
    globalThis.fetch = async () => sseRes([chunk('Tez jawab'), DONE]);
    return await openAiCall('cerebras', 'https://api.cerebras.ai/v1', 'Cerebras', ['m1'], ['K2'], 'sawal', null, b, race, null);
  } };
  const t0 = Date.now();
  r = await runAttempts([slow, fast], bubble(), null);
  const elapsed = Date.now() - t0;
  check('hedge: tez dusra provider jeeta', r === 'Tez jawab');
  check('hedge: 3s se pehle jawab (' + elapsed + 'ms)', elapsed < 2900);

  // CASE 5: photo sawal — bina-vision provider skip, vision model hi chala
  let fetchCalls = [];
  globalThis.fetch = async (url, opts) => { fetchCalls.push(JSON.parse(opts.body)); return sseRes([chunk('Photo jawab'), DONE]); };
  r = await tryOpenAI('cerebras', 'K1', 'photo kya hai', 'data:image/jpeg;base64,xx', bubble(), null, null);
  check('bina-vision provider photo par skip', r === null && fetchCalls.length === 0);
  r = await tryOpenAI('groq', 'K1', 'photo kya hai', 'data:image/jpeg;base64,xx', bubble(), null, null);
  check('vision model se photo jawab', r === 'Photo jawab' && fetchCalls.length === 1 && /qwen3.8|maverick/.test(fetchCalls[0].model));
  check('photo request me image_url gaya', JSON.stringify(fetchCalls[0].messages).includes('image_url'));

  // CASE 6: normal text sawal — sahi format
  fetchCalls = [];
  r = await tryOpenAI('groq', 'K1', 'normal sawal', null, bubble(), null, null);
  check('text sawal jawab', r === 'Photo jawab');
  check('text request me koi image nahi', !JSON.stringify(fetchCalls[0].messages).includes('image_url'));
  check('max_tokens 2048', fetchCalls[0].max_tokens === 2048);

  // CASE 7: network fail (internet off) — null + cooldown 30s
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const before = Date.now();
  r = await openAiCall('mistral', 'https://api.mistral.ai/v1', 'Mistral', ['m1'], ['K9'], 'sawal', null, bubble(), null, null);
  check('network fail = null (UI error card dikhega)', r === null);
  const cd7 = cooldowns['mistral#0'] - before;
  check('network fail par 30s cooldown (jitter ke saath 24-36s window)', cd7 >= 23000 && cd7 <= 36500);

  // CASE 8: 429 par 60s cooldown
  globalThis.fetch = async () => errRes(429, 'rate limit');
  r = await openAiCall('sambanova', 'https://api.mistral.ai/v1', 'SambaNova', ['m1'], ['K9'], 'sawal', null, bubble(), null, null);
  check('429 = null + ~60s cooldown', r === null && cooldowns['sambanova#0'] > Date.now() + 40000);

  // CASE 9: first-token timeout (7s der) — 6s par abort + fallback null
  globalThis.fetch = async (url, opts) => sseRes([chunk('Bahut der'), DONE], 7000, opts.signal);
  const t9 = Date.now();
  r = await openAiCall('github', 'https://api.mistral.ai/v1', 'GitHub', ['m1'], ['K9'], 'sawal', null, bubble(), null, null);
  const e9 = Date.now() - t9;
  check('first-token timeout par null', r === null);
  check('timeout ~6s par kata (' + e9 + 'ms)', e9 >= 5500 && e9 < 7000);
  check('timeout par 30s cooldown', cooldowns['github#0'] > Date.now());

  // CASE 10: PRIVACY — approved list ke bahar ka provider kabhi try nahi hoga
  settings.approved = ['groq'];
  let cerebrasCalls = 0;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('cerebras')) { cerebrasCalls++; return sseRes([chunk('Cerebras jawab'), DONE]); }
    return errRes(401, 'Invalid API Key');
  };
  r = await answerInto({ gemini: '', providers: { groq: 'BADKEY', cerebras: 'GOODKEY' }, customs: [] }, 'privacy sawal', null, bubble(), null);
  check('privacy: unapproved provider par gaya hi nahi', r === null && cerebrasCalls === 0);
  check('privacy: blocked provider ka naam note hua', lastBlocked.includes('Cerebras'));
  settings.approved = null;

  // CASE 11: Retry-After header — 120s bola to cooldown kam se kam ~120s
  globalThis.fetch = async () => errRes(429, 'rate limit', { 'retry-after': '120' });
  r = await openAiCall('openrouter', 'https://openrouter.ai/api/v1', 'OpenRouter', ['m1'], ['K9'], 'sawal', null, bubble(), null, null);
  check('retry-after: null + lamba cooldown (>=110s)', r === null && (cooldowns['openrouter#0'] - Date.now()) >= 110000);

  // CASE 12: quota wala 429 — aam rate-limit se kahin lamba cooldown (10 min wali shreni)
  globalThis.fetch = async () => errRes(429, 'quota exhausted: billing limit reached');
  r = await openAiCall('github', 'https://api.mistral.ai/v1', 'GitHub', ['m1'], ['K9'], 'sawal', null, bubble(), null, null);
  check('quota 429: cooldown >= 400s', r === null && (cooldowns['github#0'] - Date.now()) >= 400000);

  // CASE 13: cache — set/get, galat sawal par miss, expiry ke baad miss
  settings.cacheEnabled = true;
  lastWin = { pid: 'groq', model: 'm1' };
  cacheSet('mera sawal', 'purana jawab');
  const hit = cacheGet('mera sawal');
  check('cache: wahi sawal par hit + provider yaad', !!hit && hit.a === 'purana jawab' && hit.p === 'groq');
  check('cache: dusra sawal miss', cacheGet('koi aur sawal') === null);
  const cobj = loadCache();
  cobj[cacheKeyFor('mera sawal')].ts = Date.now() - 25 * 3600000;
  localStorage.setItem('ans_cache_v1', JSON.stringify(cobj));
  check('cache: expiry ke baad miss', cacheGet('mera sawal') === null);
  settings.cacheEnabled = false;

  // CASE 14: usage — request ginti + token andaz jama hota hai
  const ub = usageTodayCount();
  recordUsageReq('groq', 'm1');
  recordUsageReq('groq', 'm1');
  addUsageTokens('groq', 'm1', 400, 400);
  check('usage: aaj ki ginti +2', usageTodayCount() === ub + 2);
  const uobj = loadUsage();
  const ukey = Object.keys(uobj).find((x) => x.includes('groq|m1'));
  check('usage: token andaz jama (>=200)', !!ukey && uobj[ukey].t >= 200);

  // CASE 15: host allowlist — anjaan host block, provider host allow
  let blocked = false;
  try { await apiFetch('https://evil.example.com/v1/chat/completions', {}); } catch (e) { blocked = true; }
  check('allowlist: anjaan host block', blocked);
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  const okRes = await apiFetch('https://api.groq.com/openai/v1/chat/completions', {});
  check('allowlist: provider host allow', !!okRes && okRes.ok === true);

  // CASE 16: 403 — key session ke liye band (Infinity cooldown)
  globalThis.fetch = async () => errRes(403, 'Forbidden');
  r = await openAiCall('testp', 'https://api.groq.com/openai/v1', 'TestP', ['m1'], ['K9'], 'sawal', null, bubble(), null, null);
  check('403 = null + key session-disable', r === null && cooldowns['testp#0'] === Infinity);

  // CASE 17: 500 — null + 30s cooldown (jitter window 24-36s)
  globalThis.fetch = async () => errRes(500, 'Internal Server Error');
  const b17 = Date.now();
  r = await openAiCall('testp2', 'https://api.groq.com/openai/v1', 'TestP2', ['m1'], ['K9'], 'sawal', null, bubble(), null, null);
  const cd17 = cooldowns['testp2#0'] - b17;
  check('500 = null + 30s cooldown window', r === null && cd17 >= 23000 && cd17 <= 36500);

  // CASE 18: 503 — pehli key fail, dusri key se fallback jawab
  globalThis.fetch = async (url, opts) => {
    const auth = (opts.headers && opts.headers.Authorization) || '';
    if (auth.includes('K503')) return errRes(503, 'Service Unavailable');
    return sseRes([chunk('Fallback jawab'), DONE]);
  };
  r = await openAiCall('testp3', 'https://api.groq.com/openai/v1', 'TestP3', ['m1'], ['K503', 'KGOOD'], 'sawal', null, bubble(), null, null);
  check('503 par dusri key se fallback', r === 'Fallback jawab' && cooldowns['testp3#0'] > Date.now());

  // CASE 19: interrupted stream — beech me connection tooti = failure (aadha jawab success NAHI)
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    body: { getReader: () => { let n = 0; return {
      read: async () => { n++; if (n === 1) return { done: false, value: enc.encode(chunk('Aadha')) }; throw new Error('connection reset'); },
      cancel: async () => {}
    }; } },
    json: async () => null
  });
  r = await openAiCall('testp4', 'https://api.groq.com/openai/v1', 'TestP4', ['m1'], ['K9'], 'sawal', null, bubble(), null, null);
  check('interrupted stream = failure (null)', r === null);

  // CASE 20: malformed SSE lines — garbage line ignore, sahi chunk se jawab
  globalThis.fetch = async () => sseRes(['garbage line hai ye\\n\\n', ': ping\\n\\n', 'data: {tooti json\\n\\n', chunk('Sahi jawab'), DONE]);
  r = await openAiCall('testp5', 'https://api.groq.com/openai/v1', 'TestP5', ['m1'], ['K9'], 'sawal', null, bubble(), null, null);
  check('malformed SSE ke bawajood jawab', r === 'Sahi jawab');

  // CASE 21: mid-stream cancel — user ne Stop dabaya, jawab null + koi latka request nahi
  globalThis.fetch = async (url, opts) => sseRes([chunk('Der wala'), DONE], 1500, opts.signal);
  const ctx21 = { ctrls: new Set(), stopped: false };
  const p21 = openAiCall('testp6', 'https://api.groq.com/openai/v1', 'TestP6', ['m1'], ['K9'], 'sawal', null, bubble(), null, ctx21);
  await new Promise((res2) => setTimeout(res2, 150));
  ctx21.stopped = true;
  ctx21.ctrls.forEach((c) => { try { c.abort(); } catch (e) {} });
  r = await p21;
  check('mid-stream cancel = null', r === null);

  // CASE 22: merge rules (Phase B) — usage bucket-max (idempotent), cache timestamp, cooldown max
  const mu = mergeUsageData({ 'd|groq|m': { r: 5, t: 100 } }, { 'd|groq|m': { r: 7, t: 80 }, 'd|gemini|g': { r: 2, t: 10 } });
  check('merge usage: zyada wala bucket jeeta + naya bucket juda', mu['d|groq|m'].r === 7 && mu['d|groq|m'].t === 100 && mu['d|gemini|g'].r === 2);
  const mu2 = mergeUsageData(mu, { 'd|groq|m': { r: 7, t: 80 } });
  check('merge usage: dobara merge = double count NAHI', mu2['d|groq|m'].r === 7 && mu2['d|groq|m'].t === 100);
  const mc = mergeCacheData({ k1: { a: 'old', ts: 100 }, k2: { a: 'keep', ts: 50 } }, { k1: { a: 'new', ts: 200 }, k3: { a: 'x', ts: 10 } });
  check('merge cache: nayi timestamp jeeti, purani entry bachi', mc.k1.a === 'new' && mc.k2.a === 'keep' && mc.k3.a === 'x');
  cooldowns['zz#0'] = 1000;
  mergeCooldownData({ 'zz#0': 5000, 'zz#1': 'inf' });
  const cdOk = cooldowns['zz#0'] === 5000 && cooldowns['zz#1'] === Infinity;
  mergeCooldownData({ 'zz#0': 3000 });
  check('merge cooldown: max jeeta, inf samjha', cdOk && cooldowns['zz#0'] === 5000);

  // CASE 23: request lifecycle — har call ka record, ID ke saath, asal key KABHI nahi
  check('lifecycle: requestLog me records hain', requestLog.length > 0);
  const rec0 = requestLog[0] || {};
  check('lifecycle: record me id + provider + key index', typeof rec0.id === 'string' && rec0.id.indexOf('req-') === 0 && typeof rec0.pid === 'string' && typeof rec0.key === 'number');
  check('lifecycle: record me asal key NAHI', !JSON.stringify(requestLog).includes('GOODKEY') && !JSON.stringify(requestLog).includes('BADKEY') && !JSON.stringify(requestLog).includes('KGOOD'));
  const sr = successRate('groq');
  check('lifecycle: successRate number ya null', sr === null || (typeof sr === 'number' && sr >= 0 && sr <= 1));

  console.log('SIM TOTAL PASS=' + PASS + ' FAIL=' + FAIL);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.log('SIM ERROR', e); process.exit(2); });
`;

fs.writeFileSync('/tmp/sim-run.js', prelude + '\n' + providers + '\n' + inflight + '\n' + fns + '\n' + tests);
console.log('sim file ready');
