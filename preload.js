const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  runSeeder: (url, interval) => ipcRenderer.send('run-sequence', { url, interval }),
  onLog: (callback) => ipcRenderer.on('log-message', (_, value) => callback(value)),
  openCommentsFile: () => ipcRenderer.send('open-comments'),
  saveLogs: (content) => ipcRenderer.invoke('save-logs', content),
});
