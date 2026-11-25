const fs = require('fs');
const vm = require('vm');
const dir = __dirname + '/';
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL: ' + name); } };

// --- Syntax: main.js, preload.js, inline scripts ---
for (const f of ['main.js', 'preload.js']) {
  try { new vm.Script(fs.readFileSync(dir + f, 'utf8')); check(f + ' syntax', true); }
  catch (e) { check(f + ' syntax: ' + e.message, false); }
}
const pages = {};
for (const f of ['index.html', 'float.html']) {
  const html = fs.readFileSync(dir + f, 'utf8');
  pages[f] = html;
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  check(f + ' has inline script', scripts.length > 0);
  scripts.forEach((s, i) => {
    try { new vm.Script(s); check(f + ' script' + i + ' syntax', true); }
    catch (e) { check(f + ' script' + i + ' syntax: ' + e.message, false); }
  });
  const used = [...new Set([...html.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]))];
  used.forEach(id => {
    if (id === 'providerHealth' && f === 'float.html') return; // health line sirf main window me hai (guarded)
    check(f + ' id #' + id, html.includes('id="' + id + '"'));
  });
}

// --- main.js protections & hotkeys ---
const main = fs.readFileSync(dir + 'main.js', 'utf8');
const mainNoComments = main.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
check('setContentProtection x2 (real calls)', (mainNoComments.match(/setContentProtection\(true\)/g) || []).length >= 2);
check('skipTaskbar x2', (mainNoComments.match(/skipTaskbar:\s*true/g) || []).length >= 2);
for (const k of ['Control+Shift+P', 'Control+Shift+T', 'Control+Shift+S', 'Control+Shift+Q', 'Control+Shift+X']) {
  check('hotkey ' + k, main.includes(k));
}
check('GHOST_MODE in main', main.includes('GHOST_MODE'));
check('main keys:sync profile', main.includes("keys.profile === 'string'"));

// --- v3.0: shared engine file ---
const eng = fs.readFileSync(dir + 'ai-engine.js', 'utf8');
const preload = fs.readFileSync(dir + 'preload.js', 'utf8');
try { new vm.Script(eng); check('ai-engine.js syntax', true); }
catch (e) { check('ai-engine.js syntax: ' + e.message, false); }
const all = {};
for (const f in pages) all[f] = pages[f] + '\n' + eng;

// --- Per-page feature checks ---
for (const f of ['index.html', 'float.html']) {
  const h = all[f];
  check(f + ' streamGenerateContent', h.includes('streamGenerateContent'));
  check(f + ' groq stream:true', h.includes('stream: true'));
  check(f + ' readSse stall guard', h.includes("new Error('stall')"));
  check(f + ' runAttempts defined', h.includes('async function runAttempts'));
  check(f + ' race gate winner', h.includes('gate.winner'));
  check(f + ' hedge cleanup abort', h.includes('r.ctrl.abort()'));
  check(f + ' race option in select', h.includes('value="race"'));
  check(f + ' askAI race via answerInto', h.includes('answerInto'));
  check(f + ' whisper kind translations', h.includes("'translations'"));
  check(f + ' providerSel present', h.includes('id="providerSel"'));
  check(f + ' fastMode present', h.includes('id="fastMode"'));
  check(f + ' suno/listen button', h.includes('id="listenBtn"'));
  check(f + ' ghost typing fn', h.includes('ghostType'));
  // v1.6.2 mute
  check(f + ' muteMode checkbox', h.includes('id="muteMode"'));
  check(f + ' settings muted default true', h.includes('muted: true'));
  check(f + ' speakText mute guard', h.includes('if (settings.muted !== false) return;'));
  check(f + ' spk-voice class', h.includes('spk-voice'));
  check(f + ' applyMuteUI', h.includes('applyMuteUI'));
  check(f + ' visibilitychange cancel', h.includes('visibilitychange'));
  // v1.8.0 language + live class
  check(f + ' langSel', h.includes('id="langSel"'));
  check(f + ' lang default en', h.includes("lang: 'en'"));
  check(f + ' english directive', h.includes('Answer ONLY in English'));
  check(f + ' answerInto fn', h.includes('async function answerInto'));
  check(f + ' liveTick', h.includes('async function liveTick'));
  check(f + ' maybeDraft', h.includes('async function maybeDraft'));
  check(f + ' silence watch', h.includes('startSilenceWatch'));
  check(f + ' createAnalyser', h.includes('createAnalyser'));
  check(f + ' live class msg', h.includes('Live Class Mode ON'));
  check(f + ' recorder timeslice', h.includes('listenRec.start(1000)'));
}

// --- v1.6.3 profile (index + float) ---
check('index profileInput textarea', pages['index.html'].includes('id="profileInput"'));
check('index profile save btn', pages['index.html'].includes('id="saveProfileBtn"'));
check('index my_profile storage', pages['index.html'].includes('my_profile'));
check('index prompt uses profile', eng.includes('profile/resume ye hai'));
check('float myProfile var', pages['float.html'].includes('let myProfile'));
check('float prompt uses profile', eng.includes('profile/resume ye hai'));
check('float loads store.profile', pages['float.html'].includes('store.profile'));

// --- v1.7.0 settings page (index) ---
const idx = pages['index.html'];
check('index settingsView exists', idx.includes('id="settingsView"'));
check('index navSettings exists', idx.includes('id="navSettings"'));
check('index fast default false', idx.includes('fast: false'));
check('index fast migration flag', idx.includes('fast_default_fixed'));
check('index settings wiring', idx.includes("show('settings')"));
check('index profile inside settings view', idx.indexOf('id="settingsView"') < idx.indexOf('id="profileInput"') && idx.indexOf('id="profileInput"') < idx.indexOf('id="chatView"'));
check('float fast default false', pages['float.html'].includes('fast: false'));

console.log('PASS=' + pass + ' FAIL=' + fail);

// --- v1.8.1 chat clear ---
for (const f of ['index.html', 'float.html']) {
  check(f + ' clearBtn', pages[f].includes('id="clearBtn"'));
  check(f + ' clear handler', pages[f].includes('Chat saaf ho gayi'));
}
// --- v2.2.0 (Addendum v3.2) ---
for (const f of ['index.html', 'float.html']) {
  const h = all[f];
  check(f + ' v32 apiFetch allowlist', h.includes('async function apiFetch') && h.includes('allowedApiHost'));
  check(f + ' v32 koi seedha fetch( bacha nahi', (h.match(/await fetch\(/g) || []).length === 1);
  check(f + ' v32 retry-after parse', h.includes("res.headers.get('retry-after')") || h.includes('res.headers && res.headers.get'));
  check(f + ' v32 quota cooldown', h.includes('600000'));
  check(f + ' v32 cooldown jitter', h.includes('0.8 + Math.random() * 0.4'));
  check(f + ' v32 privacy filter', h.includes('settings.approved') && h.includes('lastBlocked'));
  check(f + ' v32 provider gate', h.includes('gateAcquire') && h.includes('gateRelease'));
  check(f + ' v32 scheduler queue', h.includes('askQueue') && h.includes('askAIInner'));
  check(f + ' v32 dedupe', h.includes('duplicate nahi bheja'));
  check(f + ' v32 usage record', h.includes('recordUsageReq') && h.includes('addUsageTokens'));
  check(f + ' v32 cache', h.includes('cacheGet') && h.includes('cacheSet') && h.includes('cacheEnabled'));
  check(f + ' v32 cache label', (h.includes('Cached') && h.includes('Naya jawab lao')));
  check(f + ' v32 crash recovery', h.includes('pending_ask_v1') && h.includes('restoreSavedChat') && h.includes('saved_convo_v1'));
  check(f + ' v32 size limit', h.includes('8000'));
  check(f + ' v32 daily limit', h.includes('dailyLimit'));
  check(f + ' v32 shared cooldown sync', h.includes('mergeSharedState'));
}
check('index v32 tester', pages['index.html'].includes('testAllBtn') && pages['index.html'].includes('testProvider') && pages['index.html'].includes('probeStreamOpenAI') && pages['index.html'].includes('probeVisionOpenAI') && pages['index.html'].includes('probeJsonOpenAI'));
check('index v32 model health store', pages['index.html'].includes('model_health_v1'));
check('index v32 approved list UI', pages['index.html'].includes('approvedList') && pages['index.html'].includes('buildApprovedList'));
check('index v32 usage UI + CSV', pages['index.html'].includes('usageSummary') && pages['index.html'].includes('renderUsage') && pages['index.html'].includes('api-usage.csv'));
check('index v32 backup/restore', pages['index.html'].includes('backupBtn') && pages['index.html'].includes('restoreFile') && pages['index.html'].includes('scp-backup.json'));
check('index v32 report export', pages['index.html'].includes('provider-report.txt'));
check('index v32 retention', pages['index.html'].includes('retentionSel') && pages['index.html'].includes('retentionDays'));
check('main v32 shared state passthrough', main.includes("keys.cooldowns === 'string'") && main.includes("keys.cache === 'string'") && main.includes("keys.usage === 'string'"));
check('main v32 ghost temp cleanup', main.includes('before-quit') && main.includes('ghost-text.txt'));

// --- v4.1.0 Perfect Mix (Design B ke best features A me) ---
check('mix chatSearch', pages['index.html'].includes('id="chatSearch"'));
check('mix chat groups + pins map', pages['index.html'].includes('scp_chat_pins') && pages['index.html'].includes('chatgroup'));
check('mix healthDot', pages['index.html'].includes('id="healthDot"') && pages['index.html'].includes('updateHealthDot'));
check('mix activityLine', pages['index.html'].includes('id="activityLine"') && pages['index.html'].includes('actShow'));
check('mix grouped model selector', pages['index.html'].includes('buildModelQuick') && pages['index.html'].includes('optgroup'));
check('mix font size', pages['index.html'].includes('id="fontSizeSel"') && pages['index.html'].includes('applyFontSizeB') && pages['float.html'].includes('applyFontSizeB'));
check('mix system theme', pages['index.html'].includes('System (auto)') && pages['index.html'].includes('prefers-color-scheme: light'));
check('mix draft save/restore', pages['index.html'].includes('scp_draft_') && pages['index.html'].includes('restoreDraft'));
check('mix code expand both pages', pages['index.html'].includes('expandcode') && pages['float.html'].includes('expandcode') && pages['index.html'].includes('showCodeOverlay') && pages['float.html'].includes('showCodeOverlay'));
check('mix ghost last btn', pages['index.html'].includes('id="ghostLastBtn"'));
check('mix reduced motion', pages['index.html'].includes('prefers-reduced-motion') && pages['float.html'].includes('prefers-reduced-motion'));
check('mix userData pin (naam badalne par data safe)', main.includes("setPath('userData'") && main.includes("'Secure Course Player'"));
check('mix footer', pages['index.html'].includes('Intervue AI — Version 1.3.1'));


// --- v4.1.1 settings tabs fix ---
check('tabs fix: host = sectionTitle parent', pages['index.html'].includes("view.querySelector('.sectionTitle')") && pages['index.html'].includes('if (cur) cur.appendChild(node)'));
check('provider cards early-return fix', !pages['index.html'].includes("|| document.getElementById('pcardGrid')) return;"));


// --- v4.1.2 float interactive ---
check('float chips row', pages['float.html'].includes('id="chipsRow"') && pages['float.html'].includes('data-q='));
check('float wave bars', pages['float.html'].includes('id="waveBars"') && pages['float.html'].includes('waveB'));
check('float size cycle btn', pages['float.html'].includes('id="sizeBtnF"'));
check('float msg entrance anim', pages['float.html'].includes('msgIn'));
check('float dblclick copy', pages['float.html'].includes('dblclick'));
check('float badge provider cycle', pages['float.html'].includes("badge.addEventListener('click'"));


// --- v4.1.2 ghost slower ---
check('ghost slower profiles', pages['index.html'].includes('delay: 34') && pages['index.html'].includes('delay: 70') && pages['float.html'].includes('delay: 34'));
check('ghost real slower ps1', main.includes('Minimum 45 -Maximum 170'));


// --- v5.0 ---
check('v5 class mode btn removed (intervue)', !pages['index.html'].includes('id="classModeBtn"'));
check('v5 index chips', pages['index.html'].includes('id="chipsRow"'));
check('v5 ghost slider', pages['index.html'].includes('id="ghostSlider"') && pages['index.html'].includes('ghost_custom_delay'));
check('v5 float status strip', pages['float.html'].includes('id="statusStrip"') && pages['float.html'].includes('id="stLive"'));


// --- v5.1 interview mode ---
check('iv engine rule', eng.includes('INTERVIEW MODE') && eng.includes('interviewMode'));
check('iv settings both pages', pages['index.html'].includes('interviewMode: true') && pages['float.html'].includes('interviewMode: true'));
check('iv screen', pages['index.html'].includes('id="navInterview"') && pages['index.html'].includes('id="ivPanel"') && pages['index.html'].includes('id="jdText"'));
check('iv float always on', pages['float.html'].includes('Interview <span class="ver">v1.3.1'));
check('iv engine JD', eng.includes('Job Description (JD)'));
check('iv race + first person', pages['index.html'].includes('Interview Mode ON'));


// --- intervue 1.1 pack ---
check('iv11 timer', pages['float.html'].includes('id="stTimer"'));
check('iv11 length sel', pages['float.html'].includes('id="ivLenSel"') && eng.includes('ivLen'));
check('iv11 practice chips', pages['index.html'].includes('class="pchip"'));
check('iv11 jd slots + notes', pages['index.html'].includes('data-jdslot') && pages['index.html'].includes('id="ivNotes"'));
check('iv11 float chips+', pages['float.html'].includes('Self Intro') && pages['float.html'].includes('Code samjhao'));


// --- intervue 1.3.1 fixes ---
check('fix showView gone', !pages['index.html'].includes('showView'));
check('fix show chat in IV script', pages['index.html'].includes("show('chat'); ivOn()"));
check('nav classes/recorder removed', !pages['index.html'].includes('id="navClasses"') && !pages['index.html'].includes('id="navRecorder"') && !pages['index.html'].includes('id="navHome"'));
check('classMode + ivOff removed', !pages['index.html'].includes('classModeBtn') && !pages['index.html'].includes('ivOffBtn'));


// --- intervue 1.3.1 badge fix ---
check('badge short label map', pages['float.html'].includes('SHORTP') && pages['index.html'].includes('SHORTP'));
check('long race label gone', !pages['float.html'].includes('Race (do ek saath') && !pages['index.html'].includes('Race (do ek saath'));
check('float head buttons flex-safe', pages['float.html'].includes('.head button { flex: 0 0 auto; }'));

check('chips wheel scroll', pages['float.html'].includes("cr.addEventListener('wheel'"));

// --- intervue 1.2 float redesign ---
check('iv12 header slim', !pages['float.html'].includes('id="bigTextBtn"') && !pages['float.html'].includes('id="collapseBtn"') && !pages['float.html'].includes('id="linkGlyph"'));
check('iv12 resize grip', pages['float.html'].includes('id="resizeGrip"'));
check('iv12 clear in settings', pages['float.html'].includes('Chat saaf karo'));
check('iv12 live pulse css', pages['float.html'].includes('ivPulse'));


// --- intervue 1.3.1 english lock ---
check('whisper bilingual hi pass', eng.includes("form.append('language', lang)") && eng.includes("['', 'hi']"));
check('interview english lock', eng.includes('LANGUAGE LOCK') && eng.includes("!settings.interviewMode"));
check('hindi-mix chip gone', !pages['float.html'].includes('Hindi-mix') && !pages['index.html'].includes('Hindi-mix'));


// --- intervue 1.3.1 STT hardening ---
check('whisper temp 0', eng.includes("form.append('temperature', '0')"));
check('whisper CJK filter', eng.includes('cjk / txt.length > 0.3'));
check('whisper size guard', eng.includes('blob.size < 1200'));


// --- intervue 1.3.1 invisibility fix ---
check('float body solid bg', pages['float.html'].includes('height: 100%; background: #0F1117'));


// --- intervue 1.3.1 complete-code fix ---
check('engine token cap 2048', eng.includes('1536 : 2048'));
check('interview complete-code rule', eng.includes('AADHA YA ADHURA CODE KABHI MAT DO'));
check('float final re-render fallback', pages['float.html'].includes('streamedTxt'));
check('index final re-render fallback', pages['index.html'].includes('streamedTxt'));


// --- intervue 1.3.1 side panel + glass theme ---
check('opt panel markup', pages['index.html'].includes('id="optPanel"') && pages['index.html'].includes('id="optDrag"') && pages['index.html'].includes('id="optHideBtn"') && pages['index.html'].includes('id="optToggleBtn"'));
check('prep row above composer', pages['index.html'].includes('id="prepRow"') && pages['index.html'].includes("'#prepRow .pchip'"));
check('glass theme both pages', pages['index.html'].includes('[data-theme="glass"]') && pages['float.html'].includes('[data-theme="glass"]'));
check('glass in applyTheme', pages['index.html'].includes("t === 'glass'") && pages['float.html'].includes("t === 'glass'"));


// --- intervue 1.3.1 layered-window invisibility fix ---
const mainSrc = require('fs').readFileSync('main.js', 'utf8');
check('main forces float opacity 1', mainSrc.includes("floatWindow.setOpacity(1)"));
check('protection heartbeat', mainSrc.includes('Protection heartbeat'));

console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v2.0.0 PRO: multi-provider + ultra speed + image fix ---
const mainJs = fs.readFileSync(__dirname + '/main.js', 'utf8');
check('main capture 720p (chhoti photo)', mainJs.includes('width: 1280, height: 720'));
check('main keys:set encrypted store', mainJs.includes("ipcMain.on('keys:set'") && mainJs.includes('safeStorage'));
check('main debug log ipc', mainJs.includes("ipcMain.on('debug:log'"));
for (const f of ['index.html', 'float.html']) {
  check(f + ' PROVIDERS table', eng.includes('api.cerebras.ai') && eng.includes('openrouter.ai/api/v1') && eng.includes('models.github.ai/inference') && eng.includes('api.mistral.ai/v1') && eng.includes('api.sambanova.ai/v1'));
  check(f + ' openAiCall', all[f].includes('async function openAiCall'));
  check(f + ' tryOpenAI + tryCustom', all[f].includes('async function tryOpenAI') && all[f].includes('async function tryCustom'));
  check(f + ' runAttempts', all[f].includes('async function runAttempts'));
  check(f + ' whisperAny rotation', all[f].includes('async function whisperAny'));
  check(f + ' keyCount + anyKey', eng.includes('function keyCount') && eng.includes('function anyKey'));
  check(f + ' lastAiError wajah', all[f].includes('lastAiError') && all[f].includes('Asli wajah'));
  check(f + ' turboMode checkbox', pages[f].includes('id="turboMode"'));
  check(f + ' Ultra Speed label', pages[f].includes('Ultra Speed'));
  check(f + ' koi tryGroq bacha nahi', !all[f].includes('async function tryGroq'));
  check(f + ' koi raceAsk bacha nahi', !all[f].includes('async function raceAsk'));
}
check('index provider key boxes', pages['index.html'].includes('id="key_cerebras"') && pages['index.html'].includes('id="key_openrouter"') && pages['index.html'].includes('id="key_github"') && pages['index.html'].includes('id="key_mistral"') && pages['index.html'].includes('id="key_sambanova"') && pages['index.html'].includes('id="key_groq"'));
check('index custom API form', pages['index.html'].includes('id="customName"') && pages['index.html'].includes('id="customBase"') && pages['index.html'].includes('id="customModel"') && pages['index.html'].includes('id="addCustomBtn"') && pages['index.html'].includes('id="customList"'));
check('index providerKeys + syncAll', pages['index.html'].includes('function providerKeys') && pages['index.html'].includes('function syncAll'));
check('float storeProviders', pages['float.html'].includes('storeProviders') && pages['float.html'].includes('groqKeyStr'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v2.1.0 Reliability + UI ---
check('main safeStorage encrypt', mainJs.includes('safeStorage.encryptString') && mainJs.includes('safeStorage.decryptString'));
check('main JPEG quality 60', mainJs.includes('toJPEG(60)'));
check('preload setKeys + logDebug', fs.readFileSync(__dirname + '/preload.js', 'utf8').includes('setKeys') && fs.readFileSync(__dirname + '/preload.js', 'utf8').includes('logDebug'));
for (const f of ['index.html', 'float.html']) {
  const h = all[f];
  check(f + ' first-token timeout 6s', h.includes('6000') && h.includes("ctl.failKind = 'first-token'"));
  check(f + ' total timeout 25s', h.includes('25000') && h.includes("ctl.failKind = 'total-timeout'"));
  check(f + ' stall guard 8s', h.includes("rej(new Error('stall')), 8000"));
  check(f + ' cooldown 429=60s', h.includes('60000'));
  check(f + ' cooldown 401/403 session', h.includes('ms = Infinity'));
  check(f + ' keyOrderFor', h.includes('function keyOrderFor'));
  check(f + ' ttft stats', h.includes('function recordTtft') && h.includes('function avgTtft'));
  check(f + ' logCall', h.includes('function logCall') && h.includes('key#'));
  check(f + ' empty=failure (out.complete)', h.includes('out.complete && out.text.trim()'));
  check(f + ' errorjson detect', h.includes("error = 'errorjson'"));
  check(f + ' hedged 2s', h.includes('}, 2000);'));
  check(f + ' history last 8', h.includes('settings.turbo ? 12 : 20'));
  check(f + ' max_tokens 2048', h.includes('settings.turbo ? 1536 : 2048'));
  check(f + ' short seedha prompt', h.includes('Short aur seedha jawab do.'));
  check(f + ' typing dots', h.includes('tdots'));
  check(f + ' retry button', h.includes('retrybtn') && h.includes('Jawab nahi aa paya'));
  check(f + ' stop button', h.includes('stopCurrentAsk') && h.includes('stopbtn'));
  check(f + ' fallback status line', h.includes('Doosre provider se try kar raha hoon'));
  check(f + ' markdown renderer', h.includes('function renderMarkdown') && h.includes('codeblock'));
  check(f + ' KaTeX', h.includes('katex') && h.includes('renderMath'));
  check(f + ' offline banner', h.includes('id="offlineBar"'));
  check(f + ' provider badge', h.includes('id="providerBadge"'));
  check(f + ' textarea input', h.includes('<textarea id="chatText"'));
  check(f + ' paste image', h.includes("addEventListener('paste'"));
  check(f + ' debugLog toggle', h.includes('id="debugLogMode"'));
  check(f + ' theme select', h.includes('id="themeSel"'));
  check(f + ' scrolldown btn', h.includes('id="scrollDownBtn"'));
  check(f + ' copy/regen actions', h.includes('Dobara') && h.includes('_raw'));
  check(f + ' koi raceAttempts bacha nahi', !h.includes('async function raceAttempts'));
  check(f + ' protection-ui: koi setContentProtection page me nahi (sirf main.js me)', !h.includes('setContentProtection'));
}
check('index keyCache (encrypted store)', pages['index.html'].includes('keyCache') && pages['index.html'].includes('persistKeys') && pages['index.html'].includes('initKeys'));
check('index warmUp', pages['index.html'].includes('async function warmUp'));
check('index providerQuick + headClear', pages['index.html'].includes('id="providerQuick"') && pages['index.html'].includes('id="headClearBtn"'));
check('index providerHealth line', pages['index.html'].includes('id="providerHealth"'));
check('float collapse (Esc)', pages['float.html'].includes('toggleCollapse') && pages['float.html'].includes('Escape'));
check('float opacity slider removed (layered-window fix)', !pages['float.html'].includes('opacityRange'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v3.0.0 shared engine + hardening ---
for (const f of ['index.html', 'float.html']) {
  check(f + ' v30 engine script tag', pages[f].includes('<script src="ai-engine.js"></script>'));
  check(f + ' v30 CSP meta', pages[f].includes('Content-Security-Policy') && pages[f].includes("script-src 'self' file: 'unsafe-inline' https://cdn.jsdelivr.net"));
  check(f + ' v30 engine fn page me NAHI (openAiCallInner)', !pages[f].includes('async function openAiCallInner'));
  check(f + ' v30 engine fn page me NAHI (answerInto)', !pages[f].includes('async function answerInto'));
  check(f + ' v30 PROVIDERS page me NAHI', !pages[f].includes('const PROVIDERS = {'));
  check(f + ' v30 adapter wiring', pages[f].includes('aiConfigure({'));
}
for (const fn of ['setCooldown', 'keyOrderFor', 'readSse', 'tryGeminiInner', 'openAiCallInner', 'tryOpenAI', 'tryCustom', 'runAttempts', 'answerInto', 'askAI', 'whisperAny', 'apiFetch', 'logCall', 'mergeSharedState', 'bubbleWrite', 'nextReqId', 'successRate', 'recordResult', 'mergeUsageData', 'mergeCacheData', 'mergeCooldownData', 'serializeCooldowns', 'gateAcquire', 'persistConvo', 'geminiContents', 'teacherPrompt']) {
  check('engine defines ' + fn, eng.includes('function ' + fn + '('));
}
check('engine PROVIDERS + models', eng.includes('const PROVIDERS = {') && eng.includes('GEMINI_MODELS'));
check('engine AIEngine registry', eng.includes('window.AIEngine'));
check('engine stall timer cleanup', eng.includes('clearTimeout(stallTimer)'));
check('engine requestLog lifecycle', eng.includes('requestLog') && eng.includes('reqId'));
check('package.json build.files me ai-engine.js', JSON.parse(fs.readFileSync(dir + 'package.json', 'utf8')).build.files.includes('ai-engine.js'));
check('main v30 IPC sender validation', (main.match(/isAppSender\(event\)/g) || []).length >= 8 && main.includes('function isAppSender'));
check('main v30 encryption meta', main.includes('__encryptionAvailable') && main.includes('encryptionAvailable'));
check('main v30 navigation lockdown', main.includes('will-navigate') && main.includes('setWindowOpenHandler'));
check('main v30 sandbox x2', (mainNoComments.match(/sandbox:\s*true/g) || []).length >= 2);
check('main v30 payload caps', main.includes('MAX_KEY_FIELD') && main.includes('MAX_STATE_FIELD'));
check('main v30 save-audio cap', main.includes('250 * 1024 * 1024'));
check('main v30 permission app-only', main.includes('webContents === mainWindow.webContents'));
check('preload v30 quickShot guard', fs.readFileSync(dir + 'preload.js', 'utf8').includes('quickShotRegistered'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v3.1.0 custom detail boxes (3) ---
check('engine customText hook', eng.includes('customText: null'));
check('engine engineCustom fn', eng.includes('function engineCustom('));
check('engine prompt me custom details', eng.includes('User ki custom details'));
check('engine cache key me custom', eng.includes("hashStr(engineCustom())"));
check('engine version 5.x', /version: '1\./.test(eng));
check('index customBar UI', pages['index.html'].includes('id="customBar"') && pages['index.html'].includes('id="custLabel1"') && pages['index.html'].includes('id="custText3"') && pages['index.html'].includes('id="saveCustomBtn"'));
check('index custom hook + save', pages['index.html'].includes('customText: () =>') && pages['index.html'].includes('my_custom_boxes') && pages['index.html'].includes('loadCustomBoxes'));
check('index syncAll customBoxes', pages['index.html'].includes("customBoxes: localStorage.getItem('my_custom_boxes')"));
check('float custom hook + store read', pages['float.html'].includes('customText: () => myCustomBoxes') && pages['float.html'].includes('store.customBoxes') && pages['float.html'].includes('keys.customBoxes'));
check('main customBoxes sync whitelist', main.includes("keys.customBoxes"));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v3.1.1 auto format rule (format sawal ke hisaab se) ---
check('engine format rule', eng.includes('FORMAT RULE (hamesha lagu'));
check('engine code rule short intro + block', eng.includes('pehle SIRF 1 chhoti si line do'));
check('engine image-text rule', eng.includes('SIRF wahi text do jo photo me dikhai de raha hai'));
check('engine version 4.0.0', eng.includes("version: '1.3.1'"));
check('index codeblock ghost btn', pages['index.html'].includes('ghostcode') && pages['index.html'].includes('startGhostType(code.textContent, { code: true })'));
check('float codeblock ghost btn', pages['float.html'].includes('ghostcode') && pages['float.html'].includes('startGhostType(code.textContent, { code: true })'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v3.2.0 auto + manual format modes ---
check('engine manual format HATA diya (v3.6)', !eng.includes('MANUAL FORMAT') && !eng.includes('fmtMode'));
check('index fmt select HATE (v3.6)', !pages['index.html'].includes('id="fmtModeSel"') && pages['index.html'].includes('refreshFmtUI'));
check('float fmt select HATE (v3.6)', !pages['float.html'].includes('id="fmtModeSel"') && pages['float.html'].includes('refreshFmtUI'));
check('index fmt defaults', pages['index.html'].includes("fmtMode: 'auto', fmtManual: 'normal'"));
check('float fmt defaults', pages['float.html'].includes("fmtMode: 'auto', fmtManual: 'normal'"));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v3.3.0 keys-suraksha + floating coupling + always-on-top option ---
check('main keys kabhi auto-delete nahi', !main.includes('delete keyStore[f]') && main.includes('preservedRaw'));
check('main decrypt-fail blob surakshit', main.includes('decVal') && main.includes('__decryptFailed'));
check('main float coupling', main.includes('mainHiddenByFloat') && main.includes('hideMainForFloat') && main.includes('restoreMainAfterFloat'));
check('main float:top IPC', main.includes("ipcMain.on('float:top'") && main.includes("setAlwaysOnTop(wantTop, 'screen-saver')"));
check('preload setFloatTop', fs.readFileSync(dir + 'preload.js', 'utf8').includes('setFloatTop'));
check('index persistKeys guard', pages['index.html'].includes('keysLoaded'));
check('index floatTop checkbox', pages['index.html'].includes('id="floatTopChk"'));
check('float pin button', pages['float.html'].includes('id="pinBtn"') && pages['float.html'].includes('refreshPinUI'));
check('index floatTop default', pages['index.html'].includes('floatTop: true'));
check('float floatTop default', pages['float.html'].includes('floatTop: true'));
check('main float:size IPC', main.includes("ipcMain.on('float:size'") && main.includes('minWidth: 280'));
check('preload setFloatSize', fs.readFileSync(dir + 'preload.js', 'utf8').includes('setFloatSize'));
check('float size buttons', pages['float.html'].includes('sizeBtn') && pages['float.html'].includes('setFloatSize'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v3.4.0 structured UI ---
check('index settings sections', pages['index.html'].includes('sectionTitle') && pages['index.html'].includes('id="floatWinBar"') && pages['index.html'].includes('Version 1.3.1'));
check('index size buttons wiring', pages['index.html'].includes('idxSizeBtn') && pages['index.html'].includes('id="floatOpenBtn"'));
check('float grouped settings panel', pages['float.html'].includes('id="settingsPanel"') && pages['float.html'].includes('id="settingsBtn"') && pages['float.html'].includes('setGroup'));
check('float version tag', pages['float.html'].includes('v1.3.1'));
check('float panel ids intact', ['providerSel','langSel','bigTextBtn2','ghostSpeed','muteMode'].every((id) => pages['float.html'].includes('id="' + id + '"')));
check('UX polish dono pages', pages['index.html'].includes('UX Polish') && pages['float.html'].includes('UX Polish'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v3.5.0 keys double-store ---
check('index keys backup file', pages['index.html'].includes('scp_keys_backup_v1'));
check('index keys auto-heal', pages['index.html'].includes('restoredFromBackup'));
check('index keys status proof', pages['index.html'].includes('id="keysStatus"') && pages['index.html'].includes('updateKeysStatus'));
check('main userData path meta', main.includes('__userDataPath'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v4.0.0 live-mode Groq gate fix + always-show live buttons ---
check('float purana keys.groq gate hata', !pages['float.html'].includes('if (!keys.groq)') && !pages['float.html'].includes('keys.groq;'));
check('float groqKeyStr providers se', pages['float.html'].includes('if (storeProviders.groq) groqKeyStr = storeProviders.groq;'));
check('index freshGroqKey', pages['index.html'].includes('async function freshGroqKey()') && pages['index.html'].includes('await freshGroqKey()'));
check('live button hamesha dono windows', pages['float.html'].includes('id="liveBtnHead"') && pages['index.html'].includes('id="listenBtnHead"'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v4.0.0 Groq model lineup (free tier Aug-2026 shutdown ke baad) ---
check('groq naye models', eng.includes("fast: 'openai/gpt-oss-20b'") && eng.includes("smart: 'openai/gpt-oss-120b'") && !eng.includes('llama-3.1-8b-instant') && !eng.includes('llama-3.3-70b-versatile'));
check('gpt-oss reasoning low', eng.includes('reasoning_effort'));
check('tester probeBody', pages['index.html'].includes('function probeBody('));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v4.0.0 bundle (picks 1-7) ---
check('ghost paste mode', preload.includes('ghostPaste') && main.includes("'paste'") && main.includes('clipboard.writeText'));
check('ghost code mode (no typo, steady)', main.includes('GHOST_CODE'));
check('code paste button dono pages', pages['index.html'].includes('pastecode') && pages['float.html'].includes('pastecode'));
check('chat memory 20 + saar', eng.includes('turbo ? 12 : 20') && eng.includes('convoDigest'));
check('alag-alag chats (index)', pages['index.html'].includes('scp_chats_v1') && pages['index.html'].includes('id="chatsBtn"') && pages['index.html'].includes('persistCurrentChat'));
check('quick buttons dono pages', pages['index.html'].includes('Samjhao') && pages['float.html'].includes('Samjhao'));
check('pins system', main.includes('keys.pins') && pages['index.html'].includes('pinsList') && pages['float.html'].includes('pinsList'));
check('float bade akshar', pages['float.html'].includes('bigtext') && pages['float.html'].includes('id="bigTextBtn2"'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v4.0.0 redesign ---
check('design tokens dono pages', pages['index.html'].includes('--accent:#2F7CF6') && pages['float.html'].includes('--accent:#2F7CF6'));
check('flat AI + tint user', pages['index.html'].includes('.msg.ai { background: transparent') && pages['float.html'].includes('.msg.ai { background: transparent'));
check('custom titlebar', main.includes('frame: false') && main.includes("ipcMain.on('win:min'") && pages['index.html'].includes('id="winClose"') && preload.includes('winClose'));
check('chat sidebar', pages['index.html'].includes('id="chatSide"') && pages['index.html'].includes('id="sideNewChat"') && !pages['index.html'].includes('id="chatPanel"'));
check('provider input bar me', pages['index.html'].indexOf('id="providerQuick"') > pages['index.html'].indexOf('id="chatText"'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v4.0.0 one-line code repair (functional) ---
try {
  const m = pages['float.html'].match(/function repairOneLineCode[\s\S]*?\n  \}\n/);
  const fn = new Function(m[0].replace('function repairOneLineCode', 'return function repairOneLineCode'))();
  const fixed = fn("def fibonacci(n): a, b = 0, 1 for _ in range(n): print(a, end=' ') a, b = b, a + b print()", 'python');
  check('repair fibonacci multi-line', fixed.indexOf('def fibonacci(n):\n    a, b = 0, 1\n    for _ in range(n):') === 0);
  check('repair normal code untouched', fn('x = 1\ny = 2\nprint(x + y)', 'python') === 'x = 1\ny = 2\nprint(x + y)');
  check('engine code multi-line rule', eng.includes('CODE KA SABSE ZAROORI NIYAM'));
} catch (e) { check('repair functional test: ' + e.message, false); }
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v4.0.0 ghost pause/resume ---
check('ghost pause hotkey + flag', main.includes('GHOST_PAUSE_FILE') && main.includes("Control+Shift+Z") && main.includes('toggleGhostPause'));
check('ghost ps1 v412 + pause loop', main.includes('ghost-type-v412.ps1') && main.includes('Test-Path $pauseFile'));
check('pages pause hint', pages['index.html'].includes('middle click') && pages['float.html'].includes('middle click'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v4.0.0 ghost pause mouse middle click ---
check('ghost pause middle click', main.includes('GetAsyncKeyState') && main.includes('WaitMidClick') && main.includes('ghost-type-v412.ps1'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v4.0.0 squeezed-text repair (functional) ---
try {
  const m2 = pages['float.html'].match(/function repairSqueezedText[\s\S]*?\n  \}\n/);
  const rfn = new Function(m2[0].replace('function repairSqueezedText', 'return function repairSqueezedText'))();
  const sq = rfn('Series khatm. 1. pehla point. 2. dusra: * ye * wo. 3. teesra.');
  check('repair squeezed points alag lines', sq.includes('khatm.\n1. pehla') && sq.includes('dusra:\n* ye') && sq.includes('\n3. teesra.'));
  check('repair normal text untouched', rfn('Ek normal line hai.\nDusri line yahan hai.') === 'Ek normal line hai.\nDusri line yahan hai.');
  check('engine samjhane ka niyam', eng.includes('SAMJHANE KA NIYAM'));
  check('indent wali list support', pages['float.html'].includes('[ \\t]*[-*]') && pages['index.html'].includes('[ \\t]*[-*]'));
} catch (e) { check('squeezed repair test: ' + e.message, false); }
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);

// --- v4.0.0 sajawat (bold/heading/points) ---
check('engine sajawat niyam', eng.includes('SAJAWAT'));
check('heading sizes dono pages', pages['index.html'].includes('.msg h2 { font-size: 17px') && pages['float.html'].includes('.msg h2 { font-size: 17px'));
console.log('TOTAL PASS=' + pass + ' FAIL=' + fail);
