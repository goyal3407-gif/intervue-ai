// Preload bridge: safely exposes ONLY the app functions to the pages.
// The pages cannot touch Node/Electron directly.
const { contextBridge, ipcRenderer } = require('electron');

let quickShotRegistered = false;

contextBridge.exposeInMainWorld('api', {
  // JPEG data URL of the entire screen (without this app's windows), or null.
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  // API keys shared between the main window and the floating chat.
  syncKeys: (keys) => ipcRenderer.send('keys:sync', keys),
  getKeys: () => ipcRenderer.invoke('keys:get'),
  // API keys safeStorage-encrypted store me save karne ke liye.
  setKeys: (keys) => ipcRenderer.send('keys:set', keys),
  // Debug log (Settings me ON ho tab hi file me likhta hai).
  logDebug: (line) => ipcRenderer.send('debug:log', line),
  // Floating chat window controls.
  openFloat: () => ipcRenderer.send('float:open'),
  hideFloat: () => ipcRenderer.send('float:hide'),
  setFloatOpacity: (value) => ipcRenderer.send('float:opacity', value),
  setFloatTop: (value) => ipcRenderer.send('float:top', value),
  setFloatSize: (w, h) => ipcRenderer.send('float:size', { w, h }),
  // Hotkey screenshot arrives here (floating chat window). Listener sirf
  // EK baar register hota hai — dobara call par purana hi rehta hai.
  onQuickShot: (callback) => {
    if (quickShotRegistered) return;
    quickShotRegistered = true;
    ipcRenderer.on('quick-shot', (event, url) => callback(url));
  },
  // Voice recording: system-audio source + saving the finished file.
  getScreenSourceId: () => ipcRenderer.invoke('screen-source-id'),
  saveAudio: (arrayBuffer, name) => ipcRenderer.invoke('save-audio', arrayBuffer, name),
  // Ghost typing: type this text into the user's focused app.
  ghostType: (text, delay, mode, code) => ipcRenderer.send('ghost-type', { text: text, delay: delay, mode: mode, code: !!code }),
  // Ghost paste: clipboard se perfect-format paste (code ke liye sabse sahi tareeka).
  ghostPaste: (text) => ipcRenderer.send('ghost-type', { text: text, mode: 'paste' }),
  // Custom title bar (v3.7): minimize / maximize / close (close = hide, purana rule).
  winMin: () => ipcRenderer.send('win:min'),
  winMax: () => ipcRenderer.send('win:max'),
  winClose: () => ipcRenderer.send('win:close')
});
