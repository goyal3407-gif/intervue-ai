// Secure Course Player - Phase 1 (outer model / shell)
// ----------------------------------------------------
// Core idea: every window is protected with Electron's
// setContentProtection(true). On Windows 10 (2004+) / Windows 11 the
// windows are completely ABSENT from screenshots, screen recordings,
// OBS, Zoom / Teams / Meet screen-share and screencast / mirroring -
// the normal desktop behind them shows through. Everything still
// works normally on the user's own screen.
//
// Hidden presence:
// - NO taskbar icon and NO Alt+Tab entry (skipTaskbar) on any window.
// - NO system-tray icon. The app leaves no visible trace.
// - Global hotkeys:
//     Ctrl+Shift+P  -> show / hide the main player window
//     Ctrl+Shift+T  -> show / hide the transparent floating chat
//     Ctrl+Shift+S  -> screenshot + AI answer popup (floating chat)
//     Ctrl+Shift+Q  -> quit the app completely
// - Closing a window only hides it; the app keeps running in the
//   background until Ctrl+Shift+Q is pressed.
//
// Screenshot rule: whenever a screenshot is taken from inside the
// app, ALL app windows are hidden first, then the rest of the screen
// is captured, then the windows come back. So the software itself
// can never appear in a captured picture - on top of the content
// protection, which already excludes it.
//
// API keys: the main window keeps its keys in its own local storage
// and mirrors them to a small store here (userData/keys.json), so
// the floating chat window can use the same keys.

const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, session, dialog, safeStorage, clipboard } = require('electron');
// userData PIN: app ka naam badalne ke baad bhi purana data (keys/settings/profile) wahi mile,
// isliye userData hamesha purani jagah 'Secure Course Player' par pin hai.
try { const _path = require('path'); app.setPath('userData', _path.join(app.getPath('appData'), 'Intervue AI')); } catch (e) { /* ignore */ }
try { const _fs = require('fs'); const _pp = require('path'); const _nd = app.getPath('userData'); const _of = _pp.join(app.getPath('appData'), 'Secure Course Player', 'keys.json'); const _nf = _pp.join(_nd, 'keys.json'); if (!_fs.existsSync(_nf) && _fs.existsSync(_of)) { _fs.mkdirSync(_nd, { recursive: true }); _fs.copyFileSync(_of, _nf); } } catch (e) { /* ignore */ }

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let floatWindow = null;
let isQuitting = false;

// ---------------- API key store (shared with the floating chat) ----------------
// Keys safeStorage se ENCRYPT karke save hoti hain — plain file me kabhi nahi.
// keyStore (memory me) hamesha decrypted roop me rehta hai; disk par sirf
// encrypted blob jata hai. Purani plain keys pehli baar me migrate ho jati hain.
const keysFile = () => path.join(app.getPath('userData'), 'keys.json');
const ENC_FIELDS = ['gemini', 'groq', 'providers', 'customs'];
// safeStorage uplabdh hai ya nahi — renderer ko keys:get ke meta me batate
// hain taaki UI warning de sake (chup-chaap plain save NAHI hota).
const encryptionAvailable = !!(safeStorage && safeStorage.isEncryptionAvailable());
let plainWarned = false;
function encVal(v) {
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return { enc: safeStorage.encryptString(String(v)).toString('base64') };
    }
  } catch (e) { /* ignore */ }
  if (!plainWarned) {
    plainWarned = true;
    try { console.warn('[SecureCoursePlayer] safeStorage encryption uplabdh NAHI hai — API keys is PC par PLAIN save hongi. Settings me iski warning dikhegi.'); } catch (e) { /* ignore */ }
  }
  return { plain: String(v) };
}
function decVal(v) {
  if (v == null || typeof v === 'string') return v;
  if (v.enc) {
    try { return safeStorage.decryptString(Buffer.from(v.enc, 'base64')); } catch (e) { return null; }
  }
  if (typeof v.plain === 'string') return v.plain;
  return v;
}
let keyStore = {};
const preservedRaw = {}; // decrypt fail hue fields ka raw blob — ye KABHI overwrite/delete nahi hoga
try {
  const raw = JSON.parse(fs.readFileSync(keysFile(), 'utf8')) || {};
  for (const k of Object.keys(raw)) {
    const dv = ENC_FIELDS.includes(k) ? decVal(raw[k]) : raw[k];
    if (dv === null) { preservedRaw[k] = raw[k]; keyStore[k] = ''; try { console.warn('[SecureCoursePlayer] Ek saved key decrypt nahi ho payi (' + k + ') — uska encrypted data surakshit rakha hai, delete NAHI kiya.'); } catch (e) { /* ignore */ } }
    else keyStore[k] = dv;
  }
} catch (e) { keyStore = {}; }

function saveKeyStore() {
  try {
    const out = {};
    for (const k of Object.keys(keyStore)) {
      if (ENC_FIELDS.includes(k) && preservedRaw[k] !== undefined && !keyStore[k]) { out[k] = preservedRaw[k]; continue; }
      out[k] = (ENC_FIELDS.includes(k) && keyStore[k]) ? encVal(keyStore[k]) : keyStore[k];
    }
    fs.writeFileSync(keysFile(), JSON.stringify(out));
  } catch (e) { /* ignore */ }
}
saveKeyStore(); // pehli baar me purani plain keys encrypt ho jayengi

// ---------------- IPC suraksha: sender + payload validation ----------------
// Sirf hamari apni do windows (main + float) hi IPC istemal kar sakti hain.
// Koi aur webContents (galti se load hua page, navigate-away page) keys
// padh/likh NAHI sakta.
function isAppSender(event) {
  try {
    const wc = event && event.sender;
    if (!wc) return false;
    if (mainWindow && wc === mainWindow.webContents) return true;
    if (floatWindow && wc === floatWindow.webContents) return true;
    return false;
  } catch (e) { return false; }
}
const MAX_KEY_FIELD = 262144;   // ek key-field string ki had (256 KB)
const MAX_STATE_FIELD = 1048576; // cooldowns/cache/usage string ki had (1 MB)

// Keys sirf is raaste se save hongi (renderer ke localStorage se nahi).
ipcMain.on('keys:set', (event, keys) => {
  if (!isAppSender(event)) return;
  if (keys && typeof keys === 'object') {
    for (const f of ENC_FIELDS) {
      if (typeof keys[f] === 'string' && keys[f].length <= MAX_KEY_FIELD) {
        // SURAKSHA NIYAM (v3.3.0): khaali value = "koi badlaav nahi" — saved key KABHI auto-delete nahi hogi.
        if (!keys[f]) continue;
        // providers/customs ka khaali JSON bhi purani keys wipe nahi karega.
        if ((f === 'providers' || f === 'customs') && keyStore[f]) {
          try { const inc = JSON.parse(keys[f]); const empty = Array.isArray(inc) ? inc.length === 0 : Object.keys(inc).length === 0; if (empty) continue; } catch (e) { /* ignore */ }
        }
        keyStore[f] = keys[f]; delete preservedRaw[f];
      }
    }
    saveKeyStore();
  }
});

ipcMain.on('keys:sync', (event, keys) => {
  if (!isAppSender(event)) return;
  if (keys && typeof keys === 'object') {
    if (keys.settings && typeof keys.settings === 'object') keyStore.settings = keys.settings;
    if (typeof keys.profile === 'string' && keys.profile.length <= 16384) keyStore.profile = keys.profile;
    if (typeof keys.customBoxes === 'string' && keys.customBoxes.length <= 16384) keyStore.customBoxes = keys.customBoxes;
    // Shared state (v3.2): dono windows ke beech cooldown, cache aur usage baantna.
    if (typeof keys.cooldowns === 'string' && keys.cooldowns.length <= MAX_STATE_FIELD) keyStore.cooldowns = keys.cooldowns;
    if (typeof keys.cache === 'string' && keys.cache.length <= MAX_STATE_FIELD) keyStore.cache = keys.cache;
    if (typeof keys.usage === 'string' && keys.usage.length <= MAX_STATE_FIELD) keyStore.usage = keys.usage;
    // Pin kiye hue jawab (v3.6): dono windows ke beech shared, hamesha ke liye save.
    if (typeof keys.pins === 'string' && keys.pins.length <= 65536) keyStore.pins = keys.pins;
    saveKeyStore();
  }
});
// Poora store sirf apni windows ko; saath me encryption meta (keys nahi hai ye field).
ipcMain.handle('keys:get', (event) => {
  if (!isAppSender(event)) return {};
  return Object.assign({}, keyStore, { __encryptionAvailable: encryptionAvailable, __decryptFailed: Object.keys(preservedRaw), __userDataPath: app.getPath('userData') });
});

// Debug log: sirf tab likho jab Settings me Debug log ON ho. Key kabhi log nahi hoti.
ipcMain.on('debug:log', (event, line) => {
  if (!isAppSender(event)) return;
  try {
    if (!keyStore.settings || !keyStore.settings.debugLog) return;
    const p = path.join(app.getPath('userData'), 'ai-debug.log');
    fs.appendFileSync(p, new Date().toISOString() + ' ' + String(line).slice(0, 500) + '\n');
  } catch (e) { /* ignore */ }
});

// ---------------- Windows ----------------
// Navigation lockdown: hamare pages file:// se bahar kahin navigate nahi
// kar sakte, aur koi naya window/popup nahi khulega.
function lockDownNavigation(win) {
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Intervue AI - Model',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#101216',
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  lockDownNavigation(mainWindow);
  mainWindow.setContentProtection(true);
  mainWindow.webContents.on('did-finish-load', () => { try { mainWindow.setContentProtection(true); } catch (e) { /* ignore */ } });
  mainWindow.on('show', () => { try { mainWindow.setContentProtection(true); } catch (e) { /* ignore */ } });
  mainWindow.loadFile('index.html');
  mainWindow.on('close', (event) => {
    if (!isQuitting) { event.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createFloatWindow() {
  const savedSize = (keyStore.settings && keyStore.settings.floatSize) || {};
  const fw = Math.min(900, Math.max(280, Number(savedSize.w) || 400));
  const fh = Math.min(1000, Math.max(320, Number(savedSize.h) || 560));
  floatWindow = new BrowserWindow({
    width: fw,
    height: fh,
    minWidth: 280,
    minHeight: 320,
    title: 'AI Chat',
    transparent: false,
    backgroundColor: '#0F1117',
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  lockDownNavigation(floatWindow);
  floatWindow.setContentProtection(true);
  try { floatWindow.setOpacity(1); } catch (e) { /* ignore */ }
  floatWindow.webContents.on('did-finish-load', () => { try { floatWindow.setContentProtection(true); } catch (e) { /* ignore */ } });
  floatWindow.on('show', () => { try { floatWindow.setContentProtection(true); } catch (e) { /* ignore */ } });
  const wantTop = !(keyStore.settings && keyStore.settings.floatTop === false);
  floatWindow.setAlwaysOnTop(wantTop, 'screen-saver');
  floatWindow.loadFile('float.html');
  floatWindow.on('close', (event) => {
    if (!isQuitting) { event.preventDefault(); floatWindow.hide(); restoreMainAfterFloat(); }
  });
  floatWindow.on('closed', () => { floatWindow = null; });
}

function showPlayer() {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  else createWindow();
}

function togglePlayer() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isVisible()) mainWindow.hide(); else showPlayer();
}

// Floating window khule to main app hide; floating band ho to main wapas show
// (sirf wahi main wapas ayega jo floating ne hide kiya tha — ghost/screenshot wale hide isse alag hain).
let mainHiddenByFloat = false;
function hideMainForFloat() { if (mainWindow && mainWindow.isVisible()) { mainHiddenByFloat = true; mainWindow.hide(); } }
function restoreMainAfterFloat() { if (mainHiddenByFloat && !isQuitting && mainWindow) { mainHiddenByFloat = false; mainWindow.show(); } }

function toggleFloat() {
  if (!floatWindow) { createFloatWindow(); hideMainForFloat(); return; }
  if (floatWindow.isVisible()) { floatWindow.hide(); restoreMainAfterFloat(); }
  else { floatWindow.show(); floatWindow.focus(); hideMainForFloat(); }
}

ipcMain.on('float:hide', (event) => { if (!isAppSender(event)) return; if (floatWindow) { floatWindow.hide(); restoreMainAfterFloat(); } });
ipcMain.on('float:open', (event) => {
  if (!isAppSender(event)) return;
  if (!floatWindow) { createFloatWindow(); hideMainForFloat(); }
  else { floatWindow.show(); floatWindow.focus(); hideMainForFloat(); }
});
ipcMain.on('float:top', (event, value) => {
  if (!isAppSender(event)) return;
  if (floatWindow) floatWindow.setAlwaysOnTop(!!value, 'screen-saver');
});
ipcMain.on('float:size', (event, size) => {
  if (!isAppSender(event)) return;
  if (!floatWindow || !size) return;
  const w = Math.min(900, Math.max(280, Number(size.w) || 400));
  const h = Math.min(1000, Math.max(320, Number(size.h) || 560));
  floatWindow.setSize(w, h);
});
// Protection heartbeat: har 2 second me dono windows par capture-protection
// dobara lagao, taaki koi bhi style/topmost badlav use hata na sake.
setInterval(() => {
  [mainWindow, floatWindow].forEach((w) => { if (w && !w.isDestroyed()) { try { w.setContentProtection(true); } catch (e) { /* ignore */ } } });
}, 2000);

ipcMain.on('float:opacity', (event, value) => {
  if (!isAppSender(event)) return;
  if (floatWindow) floatWindow.setOpacity(1); // HAMESHA 1: isse kam opacity window ko 'layered' bana deti hai aur Windows 10 par recording-protection (WDA_EXCLUDEFROMCAPTURE) kaam karna band kar deta hai
});

// ---------------- Screen capture (software khud kabhi photo me nahi) ----------------
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function captureScreenDataUrl() {
  const wasMainVisible = !!(mainWindow && mainWindow.isVisible());
  const wasFloatVisible = !!(floatWindow && floatWindow.isVisible());
  try {
    if (wasMainVisible) mainWindow.hide();
    if (wasFloatVisible) floatWindow.hide();
    if (wasMainVisible || wasFloatVisible) await delay(250);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 }
    });
    if (!sources || sources.length === 0) return null;
    const jpeg = sources[0].thumbnail.toJPEG(60);
    return 'data:image/jpeg;base64,' + jpeg.toString('base64');
  } catch (e) {
    return null;
  } finally {
    if (!isQuitting) {
      if (wasMainVisible && mainWindow) { mainWindow.show(); mainWindow.focus(); }
      if (wasFloatVisible && floatWindow) floatWindow.show();
    }
  }
}

ipcMain.handle('capture-screen', async (event) => isAppSender(event) ? captureScreenDataUrl() : null);

// Hotkey screenshot: capture, then the floating chat pops up with the
// photo and asks the AI itself - the answer appears in the popup.
async function quickShot() {
  const url = await captureScreenDataUrl();
  if (!floatWindow) createFloatWindow();
  floatWindow.show();
  floatWindow.focus();
  const send = () => { if (floatWindow) floatWindow.webContents.send('quick-shot', url); };
  if (floatWindow.webContents.isLoading()) {
    floatWindow.webContents.once('did-finish-load', () => setTimeout(send, 150));
  } else {
    send();
  }
}

// ---------------- Voice recording helpers ----------------
// The renderer needs one screen source id to capture the PC's own
// sound ("screen voice") through the desktop audio loopback.
ipcMain.handle('screen-source-id', async (event) => {
  if (!isAppSender(event)) return null;
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    return sources && sources.length ? sources[0].id : null;
  } catch (e) { return null; }
});

// Save a finished recording wherever the user chooses.
// Size cap 250 MB — isse badi "recording" nahi save hogi.
ipcMain.handle('save-audio', async (event, arrayBuffer, suggestedName) => {
  if (!isAppSender(event)) return false;
  try {
    if (!arrayBuffer || typeof arrayBuffer.byteLength !== 'number' || arrayBuffer.byteLength > 250 * 1024 * 1024) return false;
    const result = await dialog.showSaveDialog({
      title: 'Recording save karo',
      defaultPath: path.basename(String(suggestedName || 'recording.webm')),
      filters: [{ name: 'Audio', extensions: ['webm'] }]
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, Buffer.from(arrayBuffer));
    return true;
  } catch (e) { return false; }
});

// ---------------- Ghost typing ----------------
// Types the AI answer into whatever app the user clicks into, one
// character at a time at a human-like speed (PowerShell SendKeys -
// no extra software needed). Our windows hide first, so the typing
// lands in the user's app. Ctrl+Shift+X stops it mid-way.
const GHOST_PS1 = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class MouseKey { [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey); }'
$text = [System.IO.File]::ReadAllText($env:GHOST_FILE, [System.Text.Encoding]::UTF8)
$delay = [int]$env:GHOST_DELAY
$mode = $env:GHOST_MODE
if ($mode -eq 'paste') { [System.Windows.Forms.SendKeys]::SendWait('^v'); return }
$pauseFile = $env:GHOST_PAUSE_FILE
# Mouse ka middle button (scroll click) = pause/resume. VK_MBUTTON = 4.
function MidDown() { return (([MouseKey]::GetAsyncKeyState(4) -band 0x8000) -ne 0) }
function WaitMidClick() {
  while (MidDown) { Start-Sleep -Milliseconds 50 }
  while (-not (MidDown)) { Start-Sleep -Milliseconds 50 }
  while (MidDown) { Start-Sleep -Milliseconds 50 }
}
$special = '+^%~(){}[]'
$letters = 'abcdefghijklmnopqrstuvwxyz'
$sincePause = 0
function Send-Ch($s) {
  if ($s -eq "\`n") { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }
  elseif ($s -eq "\`r") { }
  elseif ($s -eq "\`t") { [System.Windows.Forms.SendKeys]::SendWait('{TAB}') }
  elseif ($special.Contains($s)) { [System.Windows.Forms.SendKeys]::SendWait('{' + $s + '}') }
  else { [System.Windows.Forms.SendKeys]::SendWait($s) }
}
foreach ($ch in $text.ToCharArray()) {
  $s = [string]$ch
  # Pause: flag file maujood hai to yahi ruko — file hate hi wahi se aage badho (Ctrl+Shift+Z).
  $pausedNow = $false
  while ($pauseFile -and (Test-Path $pauseFile)) { if (-not $pausedNow) { [Console]::Beep(500, 150); $pausedNow = $true }; Start-Sleep -Milliseconds 200 }
  if ($pausedNow) { [Console]::Beep(900, 120) }
  # Middle click aya to yahi pause — agla middle click resume karega.
  if (MidDown) { [Console]::Beep(500, 150); WaitMidClick; [Console]::Beep(900, 120) }
  # Real mode: kabhi-kabhi galat akshar, turant backspace - final text hamesha sahi.
  if ($env:GHOST_CODE -ne '1' -and $mode -eq 'real' -and $letters.Contains($s) -and (Get-Random -Minimum 0 -Maximum 1000) -lt 15) {
    $wrong = [string]$letters[(Get-Random -Minimum 0 -Maximum 26)]
    if ($wrong -ne $s) {
      [System.Windows.Forms.SendKeys]::SendWait($wrong)
      Start-Sleep -Milliseconds (Get-Random -Minimum 120 -Maximum 260)
      [System.Windows.Forms.SendKeys]::SendWait('{BACKSPACE}')
      Start-Sleep -Milliseconds (Get-Random -Minimum 80 -Maximum 180)
    }
  }
  Send-Ch $s
  $d = $delay + (Get-Random -Minimum 0 -Maximum ([Math]::Max(2, [int]($delay / 2))))
  if ($mode -eq 'real') {
    $d = Get-Random -Minimum 45 -Maximum 170
    if ($s -eq '.' -or $s -eq '!' -or $s -eq '?') { $d += Get-Random -Minimum 800 -Maximum 1700 }
    elseif ($s -eq ',') { $d += Get-Random -Minimum 200 -Maximum 500 }
    elseif ($s -eq "\`n") { $d += Get-Random -Minimum 400 -Maximum 900 }
    $sincePause++
    if ($s -eq ' ' -and $sincePause -gt (Get-Random -Minimum 45 -Maximum 90)) {
      $d += Get-Random -Minimum 900 -Maximum 2200
      $sincePause = 0
    }
  } elseif ($mode -eq 'slow') {
    if ($s -eq '.' -or $s -eq '!' -or $s -eq '?') { $d += Get-Random -Minimum 350 -Maximum 650 }
    elseif ($s -eq ',') { $d += Get-Random -Minimum 150 -Maximum 280 }
  } elseif ($mode -eq 'normal') {
    if ($s -eq '.' -or $s -eq '!' -or $s -eq '?') { $d += Get-Random -Minimum 220 -Maximum 480 }
  }
  if ($env:GHOST_CODE -eq '1') { $d = $delay }
  if ($d -gt 0) { Start-Sleep -Milliseconds $d }
}
`;

let ghostProc = null;
let ghostPaused = false;

function ghostPauseFilePath() { return path.join(app.getPath('userData'), 'ghost-pause.flag'); }

function toggleGhostPause() {
  if (!ghostProc) return;
  ghostPaused = !ghostPaused;
  try {
    if (ghostPaused) fs.writeFileSync(ghostPauseFilePath(), '1', 'utf8');
    else fs.unlinkSync(ghostPauseFilePath());
  } catch (e) { /* ignore */ }
}

function stopGhostTyping() {
  if (ghostProc) { try { ghostProc.kill(); } catch (e) { /* ignore */ } ghostProc = null; }
  ghostPaused = false;
  try { fs.unlinkSync(ghostPauseFilePath()); } catch (e) { /* ignore */ }
  try { globalShortcut.unregister('Control+Shift+X'); } catch (e) { /* ignore */ }
  try { globalShortcut.unregister('Control+Shift+Z'); } catch (e) { /* ignore */ }
}

ipcMain.on('ghost-type', (event, payload) => {
  if (!isAppSender(event)) return;
  if (ghostProc) return; // already typing
  const text = String((payload && payload.text) || '').slice(0, 4000);
  if (!text) return;
  const delayMs = [9, 24, 50, 70].indexOf(payload && payload.delay) >= 0 ? payload.delay : 24;
  const mode = ['fast', 'normal', 'slow', 'real', 'paste'].indexOf(payload && payload.mode) >= 0 ? payload.mode : 'normal';
  // Paste mode: code pehle clipboard me rakho — phir Ctrl+V se perfect format me chipkega (editor ki auto-indent se koi gadbad nahi).
  if (mode === 'paste') { try { clipboard.writeText(text); } catch (e) { return; } }
  // Hide all our windows so focus returns to the user's own app.
  if (mainWindow && mainWindow.isVisible()) mainWindow.hide();
  if (floatWindow && floatWindow.isVisible()) floatWindow.hide();
  let scriptFile;
  let textFile;
  try {
    const dir = app.getPath('userData');
    scriptFile = path.join(dir, 'ghost-type-v412.ps1');
    textFile = path.join(dir, 'ghost-text.txt');
    if (!fs.existsSync(scriptFile)) fs.writeFileSync(scriptFile, GHOST_PS1, 'utf8');
    fs.writeFileSync(textFile, text, 'utf8');
    // Purani pause flag saaf — warna nayi typing pehle akshar par hi atak jayegi.
    ghostPaused = false;
    try { fs.unlinkSync(ghostPauseFilePath()); } catch (e) { /* ignore */ }
  } catch (e) { return; }
  setTimeout(() => {
    try {
      ghostProc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], {
        env: Object.assign({}, process.env, { GHOST_FILE: textFile, GHOST_DELAY: String(delayMs), GHOST_MODE: mode, GHOST_CODE: (payload && payload.code) ? '1' : '0', GHOST_PAUSE_FILE: ghostPauseFilePath() }),
        windowsHide: true
      });
      try { globalShortcut.register('Control+Shift+X', stopGhostTyping); } catch (e) { /* ignore */ }
      try { globalShortcut.register('Control+Shift+Z', toggleGhostPause); } catch (e) { /* ignore */ }
      const done = () => { ghostProc = null; ghostPaused = false; try { fs.unlinkSync(ghostPauseFilePath()); } catch (e) { /* ignore */ } try { globalShortcut.unregister('Control+Shift+X'); } catch (e) { /* ignore */ } try { globalShortcut.unregister('Control+Shift+Z'); } catch (e) { /* ignore */ } };
      ghostProc.on('exit', done);
      ghostProc.on('error', done);
    } catch (e) { ghostProc = null; }
  }, 600);
});

// ---------------- Custom title bar buttons (v3.7) ----------------
// Close = wahi purana bartav: main window chhupega (quit nahi), float bhi hide hota hai —
// dono windows ke apne 'close' handler hi asal kaam karte hain.
ipcMain.on('win:min', (event) => { if (!isAppSender(event)) return; const w = BrowserWindow.fromWebContents(event.sender); if (w) w.minimize(); });
ipcMain.on('win:max', (event) => { if (!isAppSender(event)) return; const w = BrowserWindow.fromWebContents(event.sender); if (w) { if (w.isMaximized()) w.unmaximize(); else w.maximize(); } });
ipcMain.on('win:close', (event) => { if (!isAppSender(event)) return; const w = BrowserWindow.fromWebContents(event.sender); if (w) w.close(); });

// ---------------- App lifecycle ----------------
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { showPlayer(); });

  // Temp file saaf-safai (v3.2): ghost typing ka text file app band hone par hata do.
  app.on('before-quit', () => {
    try { fs.unlinkSync(path.join(app.getPath('userData'), 'ghost-text.txt')); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(path.join(app.getPath('userData'), 'ghost-type.ps1')); } catch (e) { /* ignore */ }
  });

  app.whenReady().then(() => {
    // Mic / screen-audio sirf hamari apni windows ko — kisi aur webContents ko nahi.
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const isApp = (mainWindow && webContents === mainWindow.webContents) || (floatWindow && webContents === floatWindow.webContents);
      callback(!!isApp && (permission === 'media' || permission === 'display-capture'));
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      const isApp = (mainWindow && webContents === mainWindow.webContents) || (floatWindow && webContents === floatWindow.webContents);
      return !!isApp && (permission === 'media' || permission === 'display-capture');
    });

    createWindow();
    globalShortcut.register('Control+Shift+P', togglePlayer);
    globalShortcut.register('Control+Shift+T', toggleFloat);
    globalShortcut.register('Control+Shift+S', () => { quickShot(); });
    globalShortcut.register('Control+Shift+Q', () => { isQuitting = true; app.quit(); });
  });
}

app.on('window-all-closed', () => {
  // Do nothing on purpose: we quit only via Ctrl+Shift+Q.
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); });
