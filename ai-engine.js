// ============================================================
// Secure Course Player — ai-engine.js (v3.0)
// EK HI authoritative AI engine: main chat (index.html) aur
// floating chat (float.html) dono ISI file ko load karte hain.
// Provider routing, API calls, fallback, cooldown, scheduler —
// sab kuch yahan hai; pages me iski koi dusri copy NAHI hai.
// Page-specific cheezein (settings/keys/storage ke source, UI)
// adapters se ati hain: har page apne script ki shuruaat me
// aiConfigure({...}) call karke apne hooks deta hai.
// ============================================================

  // ============================================================
  // Adapters (page hooks)
  // ============================================================
  const AI_HOOKS = {
    profileText: null,   // () => resume/profile text
    customText: null,    // () => custom detail boxes (JSON string)
    getCustoms: null,    // () => custom providers array
    getProviders: null,  // () => provider->keyString map
    getGroqKeyStr: null, // () => saari Groq keys (string)
    storageRead: null,   // (key: 'usage'|'cache') => string|null
    storageWrite: null,  // (key, string) => void
    pushShared: null,    // (stateObj) => void — main store ko bhejo
    pullShared: null     // async () => storeObj|null — main store se lo
  };
  function aiConfigure(hooks) { if (hooks) { for (const k in hooks) AI_HOOKS[k] = hooks[k]; } }
  window.AIEngine = { version: '1.3.1', configure: aiConfigure, hooks: AI_HOOKS };
  function engineProfile() {
    try { if (AI_HOOKS.profileText) return AI_HOOKS.profileText() || ''; } catch (e) { /* ignore */ }
    try { return localStorage.getItem('my_profile') || ''; } catch (e) { return ''; }
  }
  function engineCustom() {
    let raw = '';
    try { if (AI_HOOKS.customText) raw = AI_HOOKS.customText() || ''; } catch (e) { /* ignore */ }
    if (!raw) { try { raw = localStorage.getItem('my_custom_boxes') || ''; } catch (e) { raw = ''; } }
    if (!raw) return '';
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return '';
      return arr.slice(0, 3).filter((b) => b && String(b.text || '').trim()).map((b) => '[' + (String(b.label || '').trim() || 'Detail') + '] ' + String(b.text).trim()).join('\n');
    } catch (e) { return ''; }
  }
  function engineCustoms() {
    try { if (AI_HOOKS.getCustoms) return AI_HOOKS.getCustoms() || []; } catch (e) { /* ignore */ }
    try { if (typeof customProviders === 'function') return customProviders() || []; } catch (e) { /* ignore */ }
    return [];
  }
  function engineProviders() {
    try { if (AI_HOOKS.getProviders) return AI_HOOKS.getProviders() || {}; } catch (e) { /* ignore */ }
    try { if (typeof providerKeys === 'function') return providerKeys() || {}; } catch (e) { /* ignore */ }
    return {};
  }

  // ============================================================
  // ProviderRegistry
  // ============================================================
  const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
  const TEACHER_PROMPT = 'Tum ek dost jaise teacher ho. Doubts ka jawab simple, aasan shabdon me, saaf aur seedha do; zaroor ho to ek chhota example do. Screenshot bheje to pehle use dekho, phir usi par jawab do.';
  const PROVIDERS = {
    groq:       { name: 'Groq', base: 'https://api.groq.com/openai/v1', fast: 'openai/gpt-oss-20b', mid: 'openai/gpt-oss-120b', smart: 'openai/gpt-oss-120b', vision: ['qwen/qwen3.8-27b', 'meta-llama/llama-4-maverick-17b-128e-instruct'] },
    cerebras:   { name: 'Cerebras', base: 'https://api.cerebras.ai/v1', fast: 'llama3.1-8b', mid: 'llama3.1-70b', smart: 'llama-3.3-70b', vision: [] },
    openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', fast: 'meta-llama/llama-3.3-70b-instruct:free', mid: 'openai/gpt-oss-20b:free', smart: 'deepseek/deepseek-chat-v3.1:free', vision: ['meta-llama/llama-4-scout:free'] },
    github:     { name: 'GitHub Models', base: 'https://models.github.ai/inference', fast: 'openai/gpt-4.1-mini', mid: 'meta/llama-4-scout-17b-16e-instruct', smart: 'openai/gpt-4.1', vision: ['meta/llama-4-scout-17b-16e-instruct', 'openai/gpt-4.1-mini'] },
    mistral:    { name: 'Mistral', base: 'https://api.mistral.ai/v1', fast: 'mistral-small-latest', mid: 'mistral-medium-latest', smart: 'mistral-large-latest', vision: [] },
    sambanova:  { name: 'SambaNova', base: 'https://api.sambanova.ai/v1', fast: 'Meta-Llama-3.1-8B-Instruct', mid: 'Meta-Llama-3.3-70B-Instruct', smart: 'Meta-Llama-3.1-405B-Instruct', vision: [] }
  };

  // ============================================================
  // PromptBuilder
  // ============================================================
  function teacherPrompt() {
    let p = TEACHER_PROMPT + ' Short aur seedha jawab do.' + (settings.fast ? ' Jawab bahut hi chhota rakho - zyada se zyada 4-5 chhoti lines me, bina ghumaye seedha jawab do.' : '');
    const prof = engineProfile().trim();
    if (prof) p += '\n\nUser ki apni profile/resume ye hai (usne ek baar save ki hai). Har jawab iske hisaab se do - uske subject, uski class ke level aur uske kaam ko dhyaan me rakho:\n' + prof.slice(0, settings.turbo ? 1000 : 3000);
    const cust = engineCustom().trim();
    if (cust) p += '\n\nUser ki custom details (usne Settings me save ki hain). Har jawab me inka dhyaan rakho:\n' + cust.slice(0, settings.turbo ? 800 : 2400);
    p += (settings.lang === 'hinglish' && !settings.interviewMode) ? ' Jawab Hinglish me do (Hindi-English mix, simple bhasha me, jaise student bol raha ho).' : ' Answer ONLY in English. Use simple, easy English words. Never use Hindi or Hinglish.';
    p += '\n\nFORMAT RULE (hamesha lagu - jawab ka format sawal ke type ke hisaab se khud decide karo): (1) Agar sawal coding/programming ka hai, to pehle SIRF 1 chhoti si line do - jitni zaroori ho utni hi (jaise: Ye rahi tumhari FastAPI wali API:), uske baad code ek alag code block me do, sahi indentation ke saath. Code ke alawa koi lamba paragraph ya explanation NAHI; agar user ne khaas taur par samjhane ko kaha hai, tab hi code ke baad 1-2 chhoti lines me samjhao. (2) Agar user ne photo/screenshot ke saath uska text nikalne ko kaha hai, to SIRF wahi text do jo photo me dikhai de raha hai - kuch add mat karo, kuch explain mat karo. (3) Baaki sab sawalon par upar wale niyam (short aur seedha jawab) hi lagu rahenge. (4) CODE KA SABSE ZAROORI NIYAM: code hamesha multi-line likho — ``` wali line par SIRF language ka naam ho (jaise ```python), usi line par code bilkul mat likho; code ki har statement apni alag line par, sahi indentation ke saath. Code ko kabhi ek hi line me daba kar (jaise: def f(x): a = 1 return a) BILKUL mat likho — aisa code chalta hi nahi hai. (5) SAMJHANE KA NIYAM: jab kuch samjhao to bilkul aasan shabd use karo, jaise kisi beginner ko samjha rahe ho; mushkil English shabd aaye to bracket me uska simple matlab do. Har point hamesha NAYI LINE par likho — points ko ek hi paragraph me daba kar (jaise: 1. pehla 2. dusra * ye * wo) BILKUL mat likho. List ke andar dusri list (nested bullets) mat banao. Har section aur points ke beech me khali line chhodo taaki jawab khula-khula aur padhne me aasan lage. (6) SAJAWAT: lambe jawab me chhote headings (## wale) do, sabse important shabd aur main points **bold** karo, aur points hamesha saaf list me do — taaki jawab ek nazar me samajh aaye. Lekin chhote jawab (1-3 line) me heading/bold ka tamasha mat karo, wo seedha saada hi do.';
    if (settings.interviewMode) p += '\n\nINTERVIEW MODE (sabse upar ki prathmikta): User abhi ek job interview me hai aur ye jawab use khud BOLNA hai. Isliye: (1) Jawab hamesha pehle vyakti (first person) me do - jaise candidate khud bol raha ho (I have worked on...). Teacher ki tarah samjhane wala andaaz bilkul nahi. (2) Jawab chhote bolne-layak points me do - har point apni chhoti line, koi lamba paragraph nahi, koi heading nahi. (3) Jawab jaan-bujh kar disha aur main shabdon me rakho, pura ghuta-hua essay mat do - candidate apni bhasha me bolega. YE SHORT STYLE SIRF THEORY/BEHAVIOURAL SAWALON KE LIYE HAI. (4) Coding sawal par: pehle 1 line me approach (first person me), phir POORA COMPLETE code block - code hamesha pura aur chalne-layak do, band ``` tak; AADHA YA ADHURA CODE KABHI MAT DO, chahe code lamba ho. Phir 2-3 bolne wale points (jaise time complexity). (5) Profile/resume ka pura istemal karo - jawab candidate ke asal experience se jude hon, aam kitabi jawab nahi. (6) LANGUAGE LOCK: Final answer hamesha SIRF English me do - sawal Hindi ya Hinglish me ho, tab bhi. Simple, spoken English rakho jo candidate aasani se bol sake.';
    if (settings.interviewMode && settings.ivLen === 's30') p += '\n\nLENGTH: Jawab itna chhota rakho ki bolne me lagbhag 30 second lage (60-70 shabd). (Coding sawal par ye lambai lagu nahi - code hamesha pura do.)';
    if (settings.interviewMode && settings.ivLen === 'long') p += '\n\nLENGTH: Jawab thoda detail me do (lagbhag 2 minute bolne layak), par points me hi rakho. (Coding sawal par code hamesha pura do.)';
    if (settings.interviewMode && settings.interviewJd) p += '\n\nIs interview ki Job Description (JD) ye hai - jawab is role ki zarooraton se jodkar do:\n' + String(settings.interviewJd).slice(0, 2400);
    return p;
  }

  // ============================================================
  // SecurityManager — host allowlist
  // ============================================================
  function allowedApiHost(url) {
    try {
      const h = new URL(url).hostname;
      if (h === 'generativelanguage.googleapis.com') return true;
      const bases = Object.keys(PROVIDERS).map((k) => PROVIDERS[k].base);
      try { engineCustoms().forEach((c) => bases.push(c.base)); } catch (e) { /* ignore */ }
      return bases.some((b) => { try { return new URL(b).hostname === h; } catch (e) { return false; } });
    } catch (e) { return false; }
  }
  async function apiFetch(url, opts) {
    if (!allowedApiHost(url)) throw new Error('Blocked: ye API host allowed nahi hai');
    return await fetch(url, opts);
  }

  // ============================================================
  // CooldownManager + KeyRotationManager
  // ============================================================
  const cooldowns = {}; // 'provider#keyIdx' -> expiry timestamp (Infinity = is session ke liye band)
  function setCooldown(id, status, kind, extra) {
    let ms = 0;
    const msg = extra && extra.msg ? String(extra.msg) : '';
    const ra = extra && extra.ra ? extra.ra : 0;
    // 429 do tarah ka hota hai: kuch der ka rate-limit, ya billing/quota khatm — quota par lamba cooldown.
    if (status === 429) ms = /quota|billing|exhausted|insufficient/i.test(msg) ? 600000 : 60000;
    else if (status === 401 || status === 403) ms = Infinity;
    else if ((status && status >= 500) || kind === 'timeout' || kind === 'stall' || kind === 'network' || kind === 'first-token' || kind === 'total-timeout') ms = 30000;
    if (ms && ms !== Infinity) {
      ms = Math.round(ms * (0.8 + Math.random() * 0.4)); // halka jitter — sab keys ek saath na jaagein
      if (ra) ms = Math.max(ms, ra * 1000); // provider ne Retry-After diya ho to uski izzat karo
      cooldowns[id] = Date.now() + ms;
      scheduleShareState();
    } else if (ms === Infinity) {
      cooldowns[id] = Infinity;
      scheduleShareState();
    }
  }
  function keyOrderFor(base, keyList) {
    const now = Date.now();
    return keyList.map((k, i) => i).sort((a, b) => {
      const ca = cooldowns[base + '#' + a];
      const cb = cooldowns[base + '#' + b];
      const ea = ca === Infinity ? 1e18 : (ca || 0);
      const eb = cb === Infinity ? 1e18 : (cb || 0);
      const na = ea > now ? 1 : 0;
      const nb = eb > now ? 1 : 0;
      if (na !== nb) return na - nb;
      return ea - eb;
    });
  }
  function serializeCooldowns() { const cd = {}; for (const k in cooldowns) cd[k] = cooldowns[k] === Infinity ? 'inf' : cooldowns[k]; return JSON.stringify(cd); }
  // Cooldown merge rule: dono windows me se jo expiry zyada door hai wahi jeet-ta hai (max-merge).
  function mergeCooldownData(remoteObj) {
    if (!remoteObj) return;
    for (const k in remoteObj) {
      const rv = remoteObj[k] === 'inf' ? Infinity : remoteObj[k];
      const cv = cooldowns[k];
      if (rv === Infinity || (typeof rv === 'number' && rv > (cv === Infinity ? Infinity : (cv || 0)))) cooldowns[k] = rv;
    }
  }

  // ============================================================
  // ErrorManager — TTFT/success stats, request lifecycle, debug log
  // ============================================================
  const ttftStats = {}; // provider -> last 10 first-token times (ms)
  function recordTtft(pid, ms) {
    if (ms == null) return;
    const a = ttftStats[pid] || (ttftStats[pid] = []);
    a.push(ms);
    if (a.length > 10) a.shift();
  }
  function avgTtft(pid) {
    const a = ttftStats[pid];
    if (!a || !a.length) return null;
    return a.reduce((x, y) => x + y, 0) / a.length;
  }
  const resultStats = {}; // provider -> { ok, fail } — routing ke liye success rate
  function recordResult(pid, ok) {
    const s = resultStats[pid] || (resultStats[pid] = { ok: 0, fail: 0 });
    if (ok) s.ok++; else s.fail++;
  }
  function successRate(pid) {
    const s = resultStats[pid];
    if (!s || (s.ok + s.fail) < 3) return null;
    return s.ok / (s.ok + s.fail);
  }
  const failCounts = {};
  // Request lifecycle: har provider-call ko ek unique ID milta hai; record me
  // sirf provider/model/key INDEX rehta hai — asal key kabhi nahi.
  let reqSeq = 0;
  const requestLog = [];
  try { window.__scpLog = requestLog; } catch (e) { /* ignore */ }
  function nextReqId() { reqSeq += 1; return 'req-' + Date.now().toString(36) + '-' + reqSeq; }
  let lastAiError = '';
  function logCall(pid, model, keyIdx, status, ttft, total, result, reqId) {
    const line = (reqId ? reqId + ' | ' : '') + pid + ' | ' + model + ' | key#' + keyIdx + ' | ' + status + ' | ttft ' + (ttft == null ? '-' : Math.round(ttft) + 'ms') + ' | total ' + Math.round(total) + 'ms | ' + result;
    try { console.log('[AI]', line); } catch (e) { /* ignore */ }
    if (settings.debugLog && window.api && window.api.logDebug) { try { window.api.logDebug(line); } catch (e) { /* ignore */ } }
    recordUsageReq(pid, model);
    recordResult(pid, result === 'ok');
    if (reqId) { requestLog.unshift({ id: reqId, pid: pid, model: model, key: keyIdx, status: status, ttft: ttft == null ? null : Math.round(ttft), total: Math.round(total), result: result, ts: Date.now() }); if (requestLog.length > 50) requestLog.length = 50; } try { window.__scpLast = { id: reqId, pid: pid, model: model, ttft: ttft == null ? null : Math.round(ttft), total: Math.round(total), result: result, ts: Date.now() }; window.__scpAttempts = (window.__scpAttempts || 0) + 1; } catch (e) { /* ignore */ }
    if (result !== 'ok') { failCounts[pid] = (failCounts[pid] || 0) + 1; updateHealth(); }
  }
  function updateHealth() {
    const el = document.getElementById('providerHealth');
    if (!el) return;
    const parts = Object.keys(failCounts).filter((k) => failCounts[k] > 0).map((k) => k + ': ' + failCounts[k] + ' fail');
    const rates = Object.keys(resultStats).filter((k) => (resultStats[k].ok + resultStats[k].fail) >= 3).map((k) => k + ' ' + Math.round(100 * resultStats[k].ok / (resultStats[k].ok + resultStats[k].fail)) + '% ok');
    const segs = [];
    if (parts.length) segs.push('⚠ Provider fails — ' + parts.join(', '));
    if (rates.length) segs.push('Success: ' + rates.join(', '));
    el.textContent = segs.join(' | ');
  }

  // ============================================================
  // UsageTracker — storage adapter ke saath
  // ============================================================
  function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  // Storage adapter: default = localStorage (index ka purana behaviour);
  // float apne hooks se store-backed strings deta hai. Engine hamesha
  // inhi do functions se padhta/likhta hai — ek hi contract dono pages par.
  function storageReadStr(key) {
    try { if (AI_HOOKS.storageRead) { const v = AI_HOOKS.storageRead(key); if (typeof v === 'string') return v; } } catch (e) { /* ignore */ }
    try { return localStorage.getItem(key === 'usage' ? 'usage_v1' : 'ans_cache_v1'); } catch (e) { return null; }
  }
  function storageWriteStr(key, val) {
    try { if (AI_HOOKS.storageWrite) { AI_HOOKS.storageWrite(key, val); return; } } catch (e) { /* ignore */ }
    try { localStorage.setItem(key === 'usage' ? 'usage_v1' : 'ans_cache_v1', val); } catch (e) { /* ignore */ }
  }
  function loadUsage() { try { return JSON.parse(storageReadStr('usage') || '{}') || {}; } catch (e) { return {}; } }
  function saveUsage(u) { storageWriteStr('usage', JSON.stringify(u)); }
  // Usage merge rule: har din|provider|model bucket par max (counters sirf
  // badhte hain; ek hi snapshot dobara merge karne par double-count nahi hota).
  function mergeUsageData(localObj, remoteObj) {
    const out = {};
    for (const k in (localObj || {})) out[k] = { r: (localObj[k] && localObj[k].r) || 0, t: (localObj[k] && localObj[k].t) || 0 };
    for (const k in (remoteObj || {})) {
      const r = remoteObj[k] || {};
      if (!out[k]) out[k] = { r: r.r || 0, t: r.t || 0 };
      else { out[k].r = Math.max(out[k].r, r.r || 0); out[k].t = Math.max(out[k].t, r.t || 0); }
    }
    return out;
  }
  function recordUsageReq(pid, model) {
    const u = loadUsage();
    const k = todayStr() + '|' + pid + '|' + (model || '-');
    const e = u[k] || (u[k] = { r: 0, t: 0 });
    e.r += 1;
    saveUsage(u);
  }
  function addUsageTokens(pid, model, inChars, outChars) {
    const u = loadUsage();
    const k = todayStr() + '|' + pid + '|' + (model || '-');
    const e = u[k] || (u[k] = { r: 0, t: 0 });
    e.t += Math.ceil(((inChars || 0) + (outChars || 0)) / 4);
    saveUsage(u);
  }
  function usageTodayCount() { const u = loadUsage(); const pre = todayStr() + '|'; let n = 0; for (const k in u) if (k.indexOf(pre) === 0) n += u[k].r; return n; }

  // ============================================================
  // CacheStore
  // ============================================================
  let warnedToday = false;
  let lastBlocked = [];
  let lastWin = { pid: '', model: '' };
  function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); }
  function cacheKeyFor(q) { return hashStr(q + '|' + settings.lang + '|' + settings.fast + '|' + settings.turbo + '|' + (settings.interviewMode ? 'iv' : 'tc') + '|' + hashStr(engineProfile()) + '|' + hashStr(engineCustom())); }
  function loadCache() { try { return JSON.parse(storageReadStr('cache') || '{}') || {}; } catch (e) { return {}; } }
  function saveCache(c) { storageWriteStr('cache', JSON.stringify(c)); }
  // Cache merge rule: har entry par jiski timestamp nayi hai wahi jeet-ti hai.
  function mergeCacheData(localObj, remoteObj) {
    const out = {};
    for (const k in (localObj || {})) out[k] = localObj[k];
    for (const k in (remoteObj || {})) {
      if (!out[k] || ((remoteObj[k] && remoteObj[k].ts) || 0) > ((out[k] && out[k].ts) || 0)) out[k] = remoteObj[k];
    }
    return out;
  }
  function cacheGet(q) {
    const c = loadCache(); const e = c[cacheKeyFor(q)];
    if (!e) return null;
    if (Date.now() - e.ts > (settings.cacheHours || 24) * 3600000) return null;
    return e;
  }
  function cacheSet(q, ans) {
    if (!settings.cacheEnabled || !ans) return;
    const c = loadCache();
    c[cacheKeyFor(q)] = { a: ans, p: lastWin.pid || 'AI', m: lastWin.model || '', ts: Date.now() };
    const keys = Object.keys(c);
    if (keys.length > 60) { keys.sort((a, b) => c[a].ts - c[b].ts); keys.slice(0, keys.length - 60).forEach((k) => delete c[k]); }
    saveCache(c);
    scheduleShareState();
  }

  // ============================================================
  // SharedState — dono windows ke beech merge rules ke saath
  // ============================================================
  let shareTimer = null;
  function scheduleShareState() { if (shareTimer) return; shareTimer = setTimeout(() => { shareTimer = null; shareStateNow(); }, 600); }
  function shareStateNow() {
    try {
      if (!AI_HOOKS.pushShared) return;
      AI_HOOKS.pushShared({ cooldowns: serializeCooldowns(), usage: storageReadStr('usage') || '{}', cache: storageReadStr('cache') || '{}' });
    } catch (e) { /* ignore */ }
  }
  // Store se state lekar merge karo — cooldown max-merge, usage bucket-max,
  // cache timestamp-merge. Isi liye ab ek window dusre ki usage/cache
  // contributions ko overwrite NAHI karti (purana clobber bug fix).
  async function mergeSharedState(storeObj) {
    try {
      let s = storeObj || null;
      if (!s && AI_HOOKS.pullShared) s = await AI_HOOKS.pullShared();
      if (!s) return;
      if (s.cooldowns) { try { mergeCooldownData(JSON.parse(s.cooldowns)); } catch (e) { /* ignore */ } }
      if (s.usage) { try { saveUsage(mergeUsageData(loadUsage(), JSON.parse(s.usage))); } catch (e) { /* ignore */ } }
      if (s.cache) { try { saveCache(mergeCacheData(loadCache(), JSON.parse(s.cache))); } catch (e) { /* ignore */ } }
    } catch (e) { /* ignore */ }
  }

  // ============================================================
  // RequestManager — per-provider gate
  // ============================================================
  const inFlightCount = {};
  async function gateAcquire(pid) {
    const t0 = Date.now();
    while ((inFlightCount[pid] || 0) > 0 && Date.now() - t0 < 3000) { await new Promise((r) => setTimeout(r, 150)); }
    inFlightCount[pid] = (inFlightCount[pid] || 0) + 1;
  }
  function gateRelease(pid) { inFlightCount[pid] = Math.max(0, (inFlightCount[pid] || 1) - 1); }

  // ============================================================
  // ContextManager
  // ============================================================
  function persistConvo() {
    try {
      if (convo.length) localStorage.setItem('saved_convo_v1', JSON.stringify({ ts: Date.now(), items: convo.slice(-50) }));
    } catch (e) { /* ignore */ }
  }

  // ChatGPT-jaisi memory: window (20) se purani baat-cheet ka chhota saar,
  // taaki lambi chat me bhi AI ko pura context yaad rahe.
  function convoDigest(win) {
    if (!convo || convo.length <= win) return '';
    const old = convo.slice(0, convo.length - win);
    const lines = [];
    for (let i = 0; i < old.length; i++) {
      const t = old[i];
      lines.push((t.who === 'user' ? 'Student: ' : 'Teacher: ') + String(t.text || '').replace(/\s+/g, ' ').slice(0, 160));
    }
    let d = lines.join('\n');
    if (d.length > 1800) d = d.slice(d.length - 1800);
    return 'Isi chat ki purani baat-cheet ka saar (sirf context ke liye - jawab naye sawal ka hi dena):\n' + d;
  }

  function geminiContents(q, imgDataUrl) {
    const contents = convo.slice(-(settings.turbo ? 12 : 20)).map((t) => ({ role: t.who === 'user' ? 'user' : 'model', parts: [{ text: t.text }] }));
    const _dg = convoDigest(settings.turbo ? 12 : 20);
    if (_dg && contents.length) {
      if (contents[0].role === 'user') contents[0] = { role: 'user', parts: [{ text: _dg + '\n\n' + (contents[0].parts[0].text || '') }] };
      else contents.unshift({ role: 'user', parts: [{ text: _dg }] }, { role: 'model', parts: [{ text: 'Samajh gaya, aage badho.' }] });
    }
    const parts = [{ text: q }];
    if (imgDataUrl) parts.push({ inline_data: { mime_type: 'image/jpeg', data: imgDataUrl.split(',')[1] } });
    contents.push({ role: 'user', parts: parts });
    return contents;
  }

  // ============================================================
  // StreamManager
  // ============================================================
  // Streaming text ko har chunk par DOM me likhne ke bajaye animation
  // frame par batch karke likho — lamba jawab = kam reflow, UI freeze nahi.
  function bubbleWrite(bubble, full) {
    if (!bubble || !bubble._txt) return;
    if (typeof requestAnimationFrame !== 'function') { bubble._txt.textContent = full; return; }
    bubble._pendingFull = full;
    if (bubble._writeScheduled) return;
    bubble._writeScheduled = true;
    requestAnimationFrame(() => {
      bubble._writeScheduled = false;
      if (bubble._txt && typeof bubble._pendingFull === 'string') bubble._txt.textContent = bubble._pendingFull;
    });
  }
  async function readSse(res, extract, onText, ctl) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';
    let error = null;
    let complete = false;
    while (true) {
      let r;
      try {
        let stallTimer = null;
        r = await Promise.race([
          reader.read(),
          new Promise((_, rej) => { stallTimer = setTimeout(() => rej(new Error('stall')), 8000); })
        ]).finally(() => { if (stallTimer) clearTimeout(stallTimer); });
      } catch (e) {
        error = (e && e.message === 'stall') ? 'stall' : ((ctl && ctl.failKind) || 'network');
        try { reader.cancel(); } catch (err) { /* ignore */ }
        break;
      }
      if (r.done) { complete = true; break; }
      buf += decoder.decode(r.value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const js = line.slice(5).trim();
        if (!js || js === '[DONE]') continue;
        try {
          const parsed = JSON.parse(js);
          if (parsed && parsed.error) { error = 'errorjson'; break; }
          const d = extract(parsed);
          if (d) {
            if (ctl && !ctl.sawToken) { ctl.sawToken = true; ctl.firstTokenAt = Date.now(); }
            full += d;
            if (onText) onText(full);
          }
        } catch (e) { /* partial line - ignore */ }
      }
      if (error) { try { reader.cancel(); } catch (err) { /* ignore */ } break; }
    }
    return { text: full, complete: complete && !error, error: error };
  }

  // ============================================================
  // ProviderAdapters
  // ============================================================

  async function tryGemini(key, q, imgDataUrl, bubble, race, askCtx) {
    await gateAcquire('gemini');
    try { return await tryGeminiInner(key, q, imgDataUrl, bubble, race, askCtx); } finally { gateRelease('gemini'); }
  }
  async function tryGeminiInner(key, q, imgDataUrl, bubble, race, askCtx) {
    const reqId = nextReqId();
    const _logCall = (a, b, c, d, e2, f, g) => logCall(a, b, c, d, e2, f, g, reqId);
    const bodyObj = {
      system_instruction: { parts: [{ text: teacherPrompt() }] },
      contents: geminiContents(q, imgDataUrl),
      generationConfig: { maxOutputTokens: settings.fast ? 1024 : (settings.turbo ? 1536 : 2048) }
    };
    const models = settings.turbo ? ['gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'] : GEMINI_MODELS;
    for (const model of models) {
      if (race && race.gate.winner && race.gate.winner !== race.provider) return null;
      if (askCtx && askCtx.stopped) return null;
      const started = Date.now();
      const ctl = { sawToken: false, firstTokenAt: 0, failKind: '' };
      const ctrl = new AbortController();
      if (race) race.ctrlRef.ctrl = ctrl;
      if (askCtx) askCtx.ctrls.add(ctrl);
      const ftTimer = setTimeout(() => { if (!ctl.sawToken) { ctl.failKind = 'first-token'; try { ctrl.abort(); } catch (e) { /* ignore */ } } }, 6000);
      const totTimer = setTimeout(() => { ctl.failKind = 'total-timeout'; try { ctrl.abort(); } catch (e) { /* ignore */ } }, 25000);
      try {
        const res = await apiFetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':streamGenerateContent?alt=sse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(bodyObj),
          signal: ctrl.signal
        });
        if (!res.ok) {
          clearTimeout(ftTimer); clearTimeout(totTimer);
          const data = await res.json().catch(() => null);
          const m = (data && data.error && data.error.message) ? data.error.message : ('HTTP ' + res.status);
          const ra = parseInt((res.headers && res.headers.get && res.headers.get('retry-after')) || '0', 10) || 0;
          const isQuota = /quota|billing|exhausted|insufficient/i.test(m);
          lastAiError = 'Gemini: ' + m;
          _logCall('gemini', model, 0, res.status, null, Date.now() - started, isQuota ? 'quota' : 'http-' + res.status);
          setCooldown('gemini#0', res.status, null, { ra: ra, msg: m });
          const tryNext = res.status === 404 || res.status === 429 || res.status === 503 || (res.status === 400 && !!imgDataUrl) ||
            /no longer available|not found|high demand|overloaded|unavailable|spike/i.test(m);
          if (!tryNext) return null;
          continue;
        }
        const onText = (full) => {
          if (race) {
            if (!race.gate.winner) race.gate.winner = race.provider;
            if (race.gate.winner !== race.provider) return;
          }
          bubbleWrite(bubble, full);
          queueScroll();
        };
        const out = await readSse(res, (j) => {
          const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
          return parts ? parts.map((p) => p.text || '').join('') : '';
        }, onText, ctl);
        clearTimeout(ftTimer); clearTimeout(totTimer);
        const ttft = ctl.sawToken ? ctl.firstTokenAt - started : null;
        if (out.complete && out.text.trim()) {
          recordTtft('gemini', ttft);
          lastWin = { pid: 'gemini', model: model };
          addUsageTokens('gemini', model, q.length, out.text.length);
          _logCall('gemini', model, 0, 200, ttft, Date.now() - started, 'ok');
          return out.text;
        }
        const kind = out.error || 'empty';
        _logCall('gemini', model, 0, kind, ttft, Date.now() - started, kind);
        setCooldown('gemini#0', 0, kind);
        continue;
      } catch (e) {
        clearTimeout(ftTimer); clearTimeout(totTimer);
        const kind = ctl.failKind || 'network';
        _logCall('gemini', model, 0, kind, null, Date.now() - started, kind);
        setCooldown('gemini#0', 0, kind);
        continue;
      }
    }
    return null;
  }
  async function openAiCall(pid, base, label, models, keyList, q, imgDataUrl, bubble, race, askCtx) {
    await gateAcquire(pid);
    try { return await openAiCallInner(pid, base, label, models, keyList, q, imgDataUrl, bubble, race, askCtx); } finally { gateRelease(pid); }
  }
  async function openAiCallInner(pid, base, label, models, keyList, q, imgDataUrl, bubble, race, askCtx) {
    const reqId = nextReqId();
    const _logCall = (a, b, c, d, e2, f, g) => logCall(a, b, c, d, e2, f, g, reqId);
    const messages = [{ role: 'system', content: teacherPrompt() }];
    convo.slice(-(settings.turbo ? 12 : 20)).forEach((t) => messages.push({ role: t.who === 'user' ? 'user' : 'assistant', content: t.text }));
    const _dg2 = convoDigest(settings.turbo ? 12 : 20);
    if (_dg2) messages.splice(1, 0, { role: 'system', content: _dg2 });
    if (imgDataUrl) {
      messages.push({ role: 'user', content: [
        { type: 'text', text: q },
        { type: 'image_url', image_url: { url: imgDataUrl } }
      ] });
    } else {
      messages.push({ role: 'user', content: q });
    }
    const maxTok = settings.fast ? 1024 : (settings.turbo ? 1536 : 2048);
    const order = keyOrderFor(pid, keyList);
    for (const ki of order) {
      const key = keyList[ki];
      const cdId = pid + '#' + ki;
      for (const model of models) {
        if (race && race.gate.winner && race.gate.winner !== race.provider) return null;
        if (askCtx && askCtx.stopped) return null;
        const started = Date.now();
        const ctl = { sawToken: false, firstTokenAt: 0, failKind: '' };
        const ctrl = new AbortController();
        if (race) race.ctrlRef.ctrl = ctrl;
        if (askCtx) askCtx.ctrls.add(ctrl);
        const ftTimer = setTimeout(() => { if (!ctl.sawToken) { ctl.failKind = 'first-token'; try { ctrl.abort(); } catch (e) { /* ignore */ } } }, 6000);
        const totTimer = setTimeout(() => { ctl.failKind = 'total-timeout'; try { ctrl.abort(); } catch (e) { /* ignore */ } }, 25000);
        try {
          const res = await apiFetch(base.replace(/\/$/, '') + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify(Object.assign({ model: model, messages: messages, stream: true, max_tokens: maxTok }, String(model).indexOf('gpt-oss') >= 0 ? { reasoning_effort: 'low' } : {})),
            signal: ctrl.signal
          });
          if (!res.ok) {
            clearTimeout(ftTimer); clearTimeout(totTimer);
            const data = await res.json().catch(() => null);
            const m = (data && data.error && data.error.message) ? data.error.message : ('HTTP ' + res.status);
            const ra = parseInt((res.headers && res.headers.get && res.headers.get('retry-after')) || '0', 10) || 0;
            const isQuota = /quota|billing|exhausted|insufficient/i.test(m);
            lastAiError = label + ': ' + m;
            _logCall(pid, model, ki, res.status, null, Date.now() - started, isQuota ? 'quota' : 'http-' + res.status);
            setCooldown(cdId, res.status, null, { ra: ra, msg: m });
            if (res.status === 401) break; // ye key galat hai — agli key
            const tryNext = res.status === 404 || res.status === 429 || res.status === 503 || (res.status === 400 && !!imgDataUrl) ||
              /not found|rate limit|overloaded|unavailable|high demand|invalid model|no endpoints/i.test(m);
            if (!tryNext) return null;
            continue;
          }
          const onText = (full) => {
            if (race) {
              if (!race.gate.winner) race.gate.winner = race.provider;
              if (race.gate.winner !== race.provider) return;
            }
            bubbleWrite(bubble, full);
            queueScroll();
          };
          const out = await readSse(res, (j) => {
            const c = j && j.choices && j.choices[0] && j.choices[0].delta;
            return c && c.content ? c.content : '';
          }, onText, ctl);
          clearTimeout(ftTimer); clearTimeout(totTimer);
          const ttft = ctl.sawToken ? ctl.firstTokenAt - started : null;
          if (out.complete && out.text.trim()) {
            recordTtft(pid, ttft);
            lastWin = { pid: pid, model: model };
            addUsageTokens(pid, model, q.length, out.text.length);
            _logCall(pid, model, ki, 200, ttft, Date.now() - started, 'ok');
            return out.text;
          }
          const kind = out.error || 'empty';
          _logCall(pid, model, ki, kind, ttft, Date.now() - started, kind);
          setCooldown(cdId, 0, kind);
          continue;
        } catch (e) {
          clearTimeout(ftTimer); clearTimeout(totTimer);
          const kind = ctl.failKind || 'network';
          _logCall(pid, model, ki, kind, null, Date.now() - started, kind);
          setCooldown(cdId, 0, kind);
          continue;
        }
      }
    }
    return null;
  }

  async function tryOpenAI(pid, keyStr, q, imgDataUrl, bubble, race, askCtx) {
    const P = PROVIDERS[pid];
    if (!P) return null;
    const keyList = String(keyStr || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (!keyList.length) return null;
    let models;
    if (imgDataUrl) { if (!P.vision.length) return null; models = P.vision; }
    else models = settings.turbo ? [P.fast, P.mid, P.smart] : [P.mid, P.fast, P.smart];
    return await openAiCall(pid, P.base, P.name, models, keyList, q, imgDataUrl, bubble, race, askCtx);
  }

  async function tryCustom(c, q, imgDataUrl, bubble, race, askCtx) {
    if (imgDataUrl && !c.vision) return null;
    return await openAiCall('custom:' + c.name, c.base, c.name, [c.model], [c.key], q, imgDataUrl, bubble, race, askCtx);
  }

  async function whisperCall(blob, groqKey, kind, model, lang) {
    const form = new FormData();
    form.append('file', blob, 'listen.webm');
    form.append('model', model);
    form.append('response_format', 'json');
    if (lang) form.append('language', lang);
    form.append('temperature', '0');
    const res = await apiFetch('https://api.groq.com/openai/v1/audio/' + kind, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + groqKey },
      body: form
    });
    const data = await res.json().catch(() => null);
    const txt = (res.ok && data && data.text) ? data.text.trim() : '';
    if (!txt) return '';
    const cjk = (txt.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    if (txt.length >= 4 && cjk / txt.length > 0.3) return '';
    return txt;
  }
  // Saari saved Groq keys — rotation ke liye (ek ki limit khatm, dusri chalegi).
  function groqKeys() {
    let s = '';
    try { if (AI_HOOKS.getGroqKeyStr) s = AI_HOOKS.getGroqKeyStr() || ''; } catch (e) { /* ignore */ }
    if (!s) { try { s = engineProviders().groq || ''; } catch (e) { /* ignore */ } }
    return String(s || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
  }

  async function whisperAny(blob, kind) {
    if (!blob || blob.size < 1200) return '';
    const models = kind === 'translations' ? ['whisper-large-v3'] : ['whisper-large-v3-turbo', 'whisper-large-v3'];
    const langPasses = kind === 'transcriptions' ? ['', 'hi'] : [''];
    for (const lang of langPasses) {
      for (const key of groqKeys()) {
        for (const model of models) {
          try { const t = await whisperCall(blob, key, kind, model, lang); if (t) return t; } catch (e) { /* next */ }
        }
      }
    }
    return '';
  }

  // ============================================================
  // ModelRouter + FallbackManager
  // ============================================================
  async function runAttempts(attempts, bubble, askCtx) {
    if (!attempts.length) return null;
    const gate = { winner: null };
    return await new Promise((resolve) => {
      let launched = 0;
      let finished = 0;
      let settled = false;
      let hedgeTimer = null;
      const refs = [];
      const cleanup = () => {
        if (hedgeTimer) { clearTimeout(hedgeTimer); hedgeTimer = null; }
        refs.forEach((r, j) => {
          if (r && r.ctrl && gate.winner !== 'A' + j) { try { r.ctrl.abort(); } catch (e) { /* ignore */ } }
        });
      };
      const launch = () => {
        if (settled || launched >= attempts.length) return;
        const i = launched++;
        const att = attempts[i];
        const ref = { ctrl: null };
        refs[i] = ref;
        if (i > 0 && bubble._status && !gate.winner) bubble._status.textContent = 'Doosre provider se try kar raha hoon... (' + att.name + ')';
        att.run(bubble, { gate: gate, provider: 'A' + i, ctrlRef: ref }, askCtx)
          .then((t) => {
            finished++;
            if (settled) return;
            if (t && (!gate.winner || gate.winner === 'A' + i)) {
              settled = true;
              gate.winner = 'A' + i;
              cleanup();
              resolve(t);
              return;
            }
            if (!t && gate.winner === 'A' + i) {
              // Jeetne wala beech me fail ho gaya — mauka dusro ko do.
              gate.winner = null;
              if (bubble._txt) bubble._txt.textContent = '';
            }
            if (launched < attempts.length) launch();
            else if (finished >= launched) { settled = true; cleanup(); resolve(null); }
          })
          .catch(() => {
            finished++;
            if (settled) return;
            if (launched < attempts.length) launch();
            else if (finished >= launched) { settled = true; cleanup(); resolve(null); }
          });
      };
      const armHedge = () => {
        hedgeTimer = setTimeout(() => {
          if (settled) return;
          if (!gate.winner && launched < attempts.length) { launch(); armHedge(); }
        }, 2000);
      };
      launch();
      if (attempts.length > 1) {
        if (settings.provider === 'race') launch();
        armHedge();
      }
    });
  }
  async function answerInto(keyBag, q, imgDataUrl, bubble, askCtx) {
    const attempts = [];
    const seen = new Set();
    const pushGemini = () => {
      if (keyBag.gemini && !seen.has('gemini')) {
        seen.add('gemini');
        attempts.push({ id: 'gemini', name: 'Gemini', run: (b, r, ctx) => tryGemini(keyBag.gemini, q, imgDataUrl, b, r, ctx) });
      }
    };
    const pushProv = (pid) => {
      const ks = keyBag.providers[pid];
      if (!ks || !keyCount(ks) || seen.has(pid)) return;
      if (imgDataUrl && !PROVIDERS[pid].vision.length) return;
      seen.add(pid);
      attempts.push({ id: pid, name: PROVIDERS[pid].name, run: (b, r, ctx) => tryOpenAI(pid, ks, q, imgDataUrl, b, r, ctx) });
    };
    const pushCustom = (c) => {
      const id = 'custom:' + c.name;
      if (seen.has(id) || (imgDataUrl && !c.vision)) return;
      seen.add(id);
      attempts.push({ id: id, name: c.name, run: (b, r, ctx) => tryCustom(c, q, imgDataUrl, b, r, ctx) });
    };
    const sel = settings.provider;
    let first = null;
    if (sel === 'gemini') { pushGemini(); first = attempts[0] || null; }
    else if (PROVIDERS[sel]) { pushProv(sel); first = attempts[0] || null; }
    else if (sel && sel.indexOf('custom:') === 0) {
      const c = keyBag.customs.find((x) => 'custom:' + x.name === sel);
      if (c) { pushCustom(c); first = attempts[0] || null; }
    }
    ['cerebras', 'groq', 'openrouter', 'github', 'mistral', 'sambanova'].forEach(pushProv);
    keyBag.customs.forEach(pushCustom);
    pushGemini();
    if (!attempts.length) return null;
    // Baaki providers speed ke hisaab se: pehle measured average (last 10),
    // warna default priority — Cerebras, Groq, Gemini, phir baaki.
    const DEFAULT_ORDER = ['cerebras', 'groq', 'gemini', 'openrouter', 'github', 'mistral', 'sambanova'];
    // Routing score: measured TTFT (na ho to 1500ms andaz) + jo provider
    // bar-bar fail ho raha ho (success < 50%, kam se kam 3 calls) us par
    // 2000ms penalty — tez lekin naakami wale provider se bacho.
    const scoreOf = (att) => {
      let s = avgTtft(att.id);
      if (s == null) s = 1500;
      const sr = successRate(att.id);
      if (sr != null && sr < 0.5) s += 2000;
      return s;
    };
    const rest = attempts.slice(first ? 1 : 0).sort((a, b) => {
      const dscore = scoreOf(a) - scoreOf(b);
      if (dscore !== 0) return dscore;
      const ia = DEFAULT_ORDER.indexOf(a.id);
      const ib = DEFAULT_ORDER.indexOf(b.id);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const ordered = first ? [first].concat(rest) : rest;
    // PRIVACY: fallback sirf unhi providers par jayega jo user ne approve kiye hain.
    // Chuna hua provider hamesha allowed hai. Approved list na ho (null) to sab allowed (purana behaviour).
    lastBlocked = [];
    if (Array.isArray(settings.approved)) {
      const chosenId = first ? first.id : null;
      const kept = ordered.filter((a) => a.id === chosenId || settings.approved.indexOf(a.id) >= 0);
      lastBlocked = ordered.filter((a) => kept.indexOf(a) < 0).map((a) => a.name);
      if (!kept.length) return null;
      return await runAttempts(kept, bubble, askCtx);
    }
    return await runAttempts(ordered, bubble, askCtx);
  }

  // ============================================================
  // RequestManager — scheduler (dedupe + queue)
  // ============================================================
  let askInFlight = false;
  let lastAskKey = '';
  let lastAskAt = 0;
  const askQueue = [];
  async function askAI(forcedQ) {
    try { window.__scpAttempts = 0; } catch (e) { /* ignore */ }
    const peekQ = (typeof forcedQ === 'string' ? forcedQ : chatText.value.trim());
    const dkey = peekQ + '|' + (pendingImage ? 'img' : '');
    if (askInFlight && dkey === lastAskKey && Date.now() - lastAskAt < 4000) { addMsg('sys', 'Ye sawal abhi chal raha hai — duplicate nahi bheja gaya.'); return; }
    if (askInFlight) {
      if (askQueue.length < 2) { askQueue.push({ q: peekQ, img: pendingImage }); addMsg('sys', '⏳ Line me laga diya hai — pehle jawab ke baad ye chalega.'); }
      else addMsg('sys', 'Line bhari hai — pehle jawab ane do.');
      return;
    }
    askInFlight = true;
    lastAskKey = dkey; lastAskAt = Date.now();
    try { await askAIInner(forcedQ); }
    finally {
      askInFlight = false;
      const nxt = askQueue.shift();
      if (nxt) { pendingImage = nxt.img; askAI(nxt.q); }
    }
  }
  function stopCurrentAsk() {
    askQueue.length = 0;
    if (!currentAskCtx) return;
    currentAskCtx.stopped = true;
    currentAskCtx.ctrls.forEach((c) => { try { c.abort(); } catch (e) { /* ignore */ } });
  }
  function keyCount(str) { return String(str || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).length; }
  function anyKey(keyBag) {
    if (keyBag.gemini) return true;
    for (const pid in keyBag.providers) if (keyCount(keyBag.providers[pid])) return true;
    return keyBag.customs.length > 0;
  }
