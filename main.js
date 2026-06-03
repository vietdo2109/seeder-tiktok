const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
let seederProcess = null;
function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

// Run both .bat and seeder with URL & interval passed in
ipcMain.on('run-sequence', (event, args) => {
  const { url, interval } = args;

  // Write to config.json to be read by seeder.js
  const configPath = path.join(__dirname, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ url, interval }, null, 2));

  const bat = spawn('cmd.exe', ['/c', path.join(__dirname, 'launch-profiles.bat')], {
    cwd: __dirname,
  });

  const sendOutput = (tag, data) => {
    event.sender.send('log-message', `[${tag}] ${data.toString()}`);
  };

  bat.stdout.on('data', (d) => sendOutput('BAT', d));
  bat.stderr.on('data', (d) => sendOutput('BAT', d));
  bat.on('close', (code) => {
    sendOutput('BAT', `Exited with code ${code}`);
    // Start seeder only after bat finishes launching all 10 Chrome profiles
    // + 8s buffer for Chrome to initialize remote debugging
    setTimeout(() => {
      const node = spawn('node', ['seeder.js'], {
        cwd: __dirname,
      });

      node.stdout.on('data', (d) => sendOutput('SEEDER', d));
      node.stderr.on('data', (d) => sendOutput('SEEDER', d));
      node.on('close', (code) => sendOutput('SEEDER', `Exited with code ${code}`));
    }, 8000);
  });
});

// Open comments.txt
ipcMain.on('open-comments', () => {
  spawn('notepad.exe', [path.join(__dirname, 'comments.txt')], { detached: true });
});

// Save logs to file
ipcMain.handle('save-logs', async (event, content) => {
  const defaultPath = path.join(__dirname, `seeder-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath,
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, content, 'utf-8');
  return { ok: true, path: filePath };
});


