const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
let seederProcess = null;

const CHROME_PROFILE_BASE_DIR = 'C:\\ChromeProfiles';
const CACHE_RELATIVE_PATHS = [
  path.join('Default', 'Cache'),
  path.join('Default', 'Code Cache'),
  path.join('Default', 'GPUCache'),
  path.join('Default', 'DawnCache'),
  path.join('Default', 'DawnGraphiteCache'),
  path.join('Default', 'DawnWebGPUCache'),
  path.join('Default', 'ShaderCache'),
  path.join('Default', 'GrShaderCache'),
  path.join('Default', 'Media Cache'),
  path.join('Default', 'Service Worker', 'CacheStorage'),
  path.join('Default', 'Service Worker', 'ScriptCache'),
  'ShaderCache',
  'GrShaderCache',
];

function getDirectorySize(dirPath) {
  let total = 0;
  try {
    for (const item of fs.readdirSync(dirPath, { withFileTypes: true })) {
      const itemPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        total += getDirectorySize(itemPath);
      } else if (item.isFile()) {
        total += fs.statSync(itemPath).size;
      }
    }
  } catch {
    // Chrome may keep some files locked while running. Skip unreadable entries.
  }
  return total;
}

function bytesToMb(bytes) {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function isInsideBaseDir(baseDir, targetPath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + path.sep);
}

function clearChromeProfileCache() {
  if (!fs.existsSync(CHROME_PROFILE_BASE_DIR)) {
    return { ok: true, deletedPaths: 0, freedBytes: 0, errors: [] };
  }

  const errors = [];
  let deletedPaths = 0;
  let freedBytes = 0;

  const profiles = fs
    .readdirSync(CHROME_PROFILE_BASE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^Profile\d+$/.test(entry.name))
    .map((entry) => path.join(CHROME_PROFILE_BASE_DIR, entry.name));

  for (const profilePath of profiles) {
    for (const relativePath of CACHE_RELATIVE_PATHS) {
      const targetPath = path.join(profilePath, relativePath);
      if (!isInsideBaseDir(CHROME_PROFILE_BASE_DIR, targetPath) || !fs.existsSync(targetPath)) {
        continue;
      }

      const sizeBeforeDelete = getDirectorySize(targetPath);
      try {
        fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        deletedPaths += 1;
        freedBytes += sizeBeforeDelete;
      } catch (error) {
        errors.push({ path: targetPath, error: error.message });
      }
    }
  }

  return {
    ok: errors.length === 0,
    deletedPaths,
    freedBytes,
    freedMb: bytesToMb(freedBytes),
    errors,
  };
}

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

// Clear Chrome cache folders while preserving login/session data.
ipcMain.handle('clear-chrome-cache', async () => clearChromeProfileCache());

