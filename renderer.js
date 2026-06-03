const launchBtn = document.getElementById('launchBtn');
const statusLabel = document.getElementById('status');
const logContainer = document.getElementById('log');

let rawLogContent = '';

function setRunning(isRunning) {
  launchBtn.disabled = isRunning;
  statusLabel.textContent = isRunning ? 'Running' : 'Stopped';
  statusLabel.style.color = isRunning ? '#4ade80' : '#9ca3af';
}

function getLogLevelClass(line) {
  if (line.includes('[ERROR]')) return 'log-error';
  if (line.includes('[WARN]')) return 'log-warn';
  if (line.includes('[STOP]')) return 'log-stop';
  if (line.includes('[SUCCESS]')) return 'log-success';
  if (line.includes('[INFO]')) return 'log-info';
  return 'log-info';
}

function appendLog(msg) {
  rawLogContent += msg.endsWith('\n') ? msg : msg + '\n';

  const lines = msg.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    const div = document.createElement('div');
    div.className = 'log-line ' + (line.startsWith('[BAT]') ? 'log-bat' : getLogLevelClass(line));
    div.textContent = line;
    logContainer.appendChild(div);
  }

  logContainer.scrollTop = logContainer.scrollHeight;
}

launchBtn.addEventListener('click', () => {
  const url = document.getElementById('urlInput').value.trim();
  const interval = parseInt(document.getElementById('intervalInput').value.trim(), 10);

  if (!url || isNaN(interval) || interval <= 0) {
    alert('Please enter a valid livestream URL and interval.');
    return;
  }

  window.electronAPI.runSeeder(url, interval);
  setRunning(true);
});

document.getElementById('editBtn').addEventListener('click', () => {
  window.electronAPI.openCommentsFile();
});

document.getElementById('clearCacheBtn').addEventListener('click', async () => {
  const confirmed = confirm('Clear Chrome cache for Profile1-Profile10?\n\nClose Chrome first for the best result. Login sessions will be preserved.');
  if (!confirmed) return;

  appendLog('[INFO] Clearing Chrome cache...\n');
  const result = await window.electronAPI.clearChromeCache();
  if (result?.ok) {
    appendLog(`[SUCCESS] Cleared ${result.deletedPaths} cache folders, freed about ${result.freedMb || 0} MB.\n`);
    return;
  }

  appendLog(`[WARN] Cache cleanup finished with ${result?.errors?.length || 0} errors. Freed about ${result?.freedMb || 0} MB.\n`);
  for (const item of result?.errors || []) {
    appendLog(`[ERROR] Could not delete ${item.path}: ${item.error}\n`);
  }
});

document.getElementById('clearLogBtn').addEventListener('click', () => {
  logContainer.innerHTML = '';
  rawLogContent = '';
});

document.getElementById('saveLogBtn').addEventListener('click', async () => {
  if (!rawLogContent.trim()) {
    alert('No logs to save.');
    return;
  }
  const result = await window.electronAPI.saveLogs(rawLogContent);
  if (result?.ok) {
    alert(`Logs saved to:\n${result.path}`);
  }
});

window.electronAPI.onLog((msg) => {
  appendLog(msg);

  if (msg.includes('[SEEDER]') && msg.includes('Exited with code')) {
    setRunning(false);
  }
});
