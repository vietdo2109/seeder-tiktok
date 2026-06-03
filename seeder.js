const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const PORTS = [9221, 9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230];
const COMMENT_SELECTOR = 'div[contenteditable="plaintext-only"][maxlength="150"]';
const CONFIG_PATH = path.join(__dirname, 'config.json');
const COMMENTS_PATH = path.join(__dirname, 'comments.txt');

const DEFAULT_URL = 'https://www.tiktok.com/@tiemtraannhienn.official/live';
const DEFAULT_INTERVAL_MS = 60000;

const LOG_LEVELS = { INFO: 'INFO', SUCCESS: 'SUCCESS', WARN: 'WARN', ERROR: 'ERROR', STOP: 'STOP' };

function log(level, message, details = null) {
  const ts = new Date().toISOString();
  const detailStr = details != null ? ` | ${JSON.stringify(details)}` : '';
  const line = `[${ts}] [${level}] ${message}${detailStr}\n`;
  const out = level === LOG_LEVELS.ERROR ? process.stderr : process.stdout;
  out.write(line);
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);
    const url = (config.url || DEFAULT_URL).trim();
    const intervalSec = parseInt(config.interval, 10);
    const intervalMs = (isNaN(intervalSec) || intervalSec <= 0 ? 60 : intervalSec) * 1000;
    return { url, intervalMs };
  } catch (e) {
    log(LOG_LEVELS.WARN, 'Could not load config.json, using defaults', { reason: e.message });
    return { url: DEFAULT_URL, intervalMs: DEFAULT_INTERVAL_MS };
  }
}

/** Origin + path from the configured URL (no query/hash), for a simple substring check on each comment. */
function urlNeedleForContains(inputUrl) {
  const t = (inputUrl || '').trim();
  if (!t) return '';
  try {
    const u = new URL(t);
    const pathname = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.origin}${pathname}`.toLowerCase();
  } catch {
    return t.split('#')[0].split('?')[0].trim().toLowerCase();
  }
}

function currentPageContainsTargetUrl(currentUrl, needle) {
  if (!needle) return true;
  return currentUrl.toLowerCase().includes(needle);
}

async function connectToChrome(port, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const browser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${port}`,
        defaultViewport: null,
      });
      return browser;
    } catch (e) {
      if (i < maxRetries - 1) {
        log(LOG_LEVELS.WARN, `Port ${port} not ready, retry ${i + 1}/${maxRetries} in 3s`, { error: e.message });
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        throw e;
      }
    }
  }
}

(async () => {
  const { url: LIVESTREAM_URL, intervalMs } = loadConfig();
  const urlNeedle = urlNeedleForContains(LIVESTREAM_URL);

  log(LOG_LEVELS.INFO, `Target livestream: ${LIVESTREAM_URL}`);
  log(LOG_LEVELS.INFO, `Stop if tab URL does not contain: ${urlNeedle || '(empty — no check)'}`);
  log(LOG_LEVELS.INFO, `Interval: ${intervalMs / 1000}s`);

  let comments;
  try {
    const commentsRaw = fs.readFileSync(COMMENTS_PATH, 'utf-8');
    comments = commentsRaw.split('\n').filter(Boolean);
  } catch (e) {
    log(LOG_LEVELS.ERROR, 'Failed to read comments.txt', { error: e.message, stack: e.stack });
    process.exit(1);
  }
  if (!comments.length) {
    log(LOG_LEVELS.ERROR, 'No comments in comments.txt - file is empty');
    process.exit(1);
  }

  let commentIndex = 0;
  let tabIndex = 0;
  let intervalId = null;
  let stopped = false;
  let cycleRunning = false;
  let keepAliveTimer = null;

  /** Dừng vòng comment và log; không thoát process (Chrome / cửa sổ log vẫn mở). */
  function stopCommentLoop(reason) {
    if (stopped) return;
    stopped = true;
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    log(LOG_LEVELS.STOP, reason);
    log(
      LOG_LEVELS.INFO,
      'Đã dừng gửi comment. Tiến trình seeder vẫn chạy; đóng cửa sổ console hoặc thoát app khi không cần nữa.'
    );
    if (!keepAliveTimer) {
      keepAliveTimer = setInterval(() => {}, 24 * 60 * 60 * 1000);
    }
  }

  const pages = [];

  // Connect to all ports in parallel (avoids sequential delay; last profiles get equal retry time)
  const results = await Promise.allSettled(
    PORTS.map(async (port) => {
      const browser = await connectToChrome(port);
      let page = (await browser.pages())[0];
      if (!page) {
        page = await browser.newPage();
      }
      await page.goto(LIVESTREAM_URL, { waitUntil: 'networkidle2', timeout: 60000 });
      return { port, page };
    })
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      pages.push(r.value.page);
      log(LOG_LEVELS.SUCCESS, `Connected to port ${r.value.port}`, { port: r.value.port });
    } else {
      log(LOG_LEVELS.ERROR, `Failed to connect to port ${PORTS[i]}`, {
        port: PORTS[i],
        error: r.reason?.message ?? String(r.reason),
        name: r.reason?.name,
      });
    }
  }

  if (!pages.length) {
    log(LOG_LEVELS.ERROR, 'No Chrome pages found. Ensure Chrome is running with remote debugging on ports 9221-9230.', {
      hint: 'Run launch-profiles.bat first or use Launch Chrome + Seeder',
    });
    process.exit(1);
  }

  intervalId = setInterval(async () => {
    if (stopped) return;
    if (cycleRunning) return;
    cycleRunning = true;

    const page = pages[tabIndex];
    const comment = comments[commentIndex];
    const thisTab = tabIndex;

    try {
      await page.bringToFront();

      const currentUrl = page.url();
      if (!currentPageContainsTargetUrl(currentUrl, urlNeedle)) {
        stopCommentLoop(
          `Livestream có vẻ đã kết thúc hoặc đã chuyển trang — tab ${thisTab + 1} URL không còn chứa mục tiêu. Cần chứa "${urlNeedle}", hiện tại: ${currentUrl}`
        );
        return;
      }

      await page.waitForSelector(COMMENT_SELECTOR, { timeout: 5000 });
      await page.focus(COMMENT_SELECTOR);
      await page.evaluate(
        (text, selector) => {
          const el = document.querySelector(selector);
          if (el) {
            el.focus();
            el.innerText = text;
            const inputEvent = new Event('input', { bubbles: true });
            el.dispatchEvent(inputEvent);
          }
        },
        comment,
        COMMENT_SELECTOR
      );

      await page.keyboard.press('Enter');
      await new Promise((resolve) => setTimeout(resolve, 500));

      const stillHasText = await page.$eval(COMMENT_SELECTOR, (el) => el.innerText.trim());
      if (stillHasText.length > 0) {
        log(LOG_LEVELS.WARN, `Comment not submitted on tab ${thisTab + 1}, retrying Enter`, { tab: thisTab + 1 });
        await page.keyboard.press('Enter');
      }

      log(LOG_LEVELS.SUCCESS, `Tab ${thisTab + 1} commented`, {
        tab: thisTab + 1,
        comment: comment.substring(0, 50) + (comment.length > 50 ? '...' : ''),
      });
    } catch (err) {
      log(LOG_LEVELS.ERROR, `Tab ${thisTab + 1} failed to comment`, {
        tab: thisTab + 1,
        comment: comment.substring(0, 30) + '...',
        error: err.message,
        name: err.name,
        stack: err.stack,
      });
    } finally {
      cycleRunning = false;
      tabIndex = (tabIndex + 1) % pages.length;
      commentIndex = (commentIndex + 1) % comments.length;
    }
  }, intervalMs);
})().catch((err) => {
  log(LOG_LEVELS.ERROR, 'Unhandled error - seeder crashed', {
    error: err.message,
    name: err.name,
    stack: err.stack,
  });
  process.exit(1);
});
