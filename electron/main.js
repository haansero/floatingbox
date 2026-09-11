'use strict';
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require('electron');
const path = require('node:path');
const config = require('./config');
const { NotifyHub } = require('./notifyHub');
const { startDesktopNotificationServer } = require('./dbusNotifications');
const { startWindowsNotificationListener } = require('./windowsNotifications');
const { readClaudeCredentials } = require('./credentials');
const usage = require('./usage');

let win = null;
let tray = null;
let cfg = null;
let hub = null;
let capture = null; // desktop notification capture (Linux D-Bus server / Windows listener)
let usageTimer = null;
const usageState = { plan: [], planError: null, code: null, codeError: null, updatedAt: null, source: null };

const userData = () => app.getPath('userData');

function createWindow() {
  const { width, height } = cfg.window;
  const display = screen.getPrimaryDisplay().workArea;
  const x = Number.isFinite(cfg.window.x) ? cfg.window.x : display.x + display.width - width - 24;
  const y = Number.isFinite(cfg.window.y) ? cfg.window.y : display.y + 24;

  win = new BrowserWindow({
    x, y, width, height,
    useContentSize: true,
    minWidth: 200,
    minHeight: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true, // resizable:false pins min/max size and blocks programmatic height changes
    thickFrame: false, // Windows: no invisible resize border (it also inflated the width on every setSize)
    focusable: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    title: 'Floating Box',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const persistBounds = () => {
    if (!win) return;
    // Only the position is taken from the window; width is ours, height follows content.
    const { x: bx, y: by } = win.getBounds();
    cfg.window = { ...cfg.window, x: bx, y: by };
    config.save(userData(), cfg);
  };
  win.on('moved', persistBounds);
  win.on('closed', () => { win = null; });
  win.webContents.on('did-finish-load', () => sendState());
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function sendState() {
  send('state', {
    notifications: hub.items,
    unread: hub.unreadCount(),
    usage: usageState,
    timer: cfg.timer,
    hubPort: hub.port,
    desktopCapture: capture ? capture.ok : false,
    desktopCaptureReason: capture ? capture.reason : 'disabled',
    platform: process.platform,
    alwaysSharp: !!cfg.alwaysSharp,
    codeDailyTokenBudget: cfg.codeDailyTokenBudget || 0,
  });
  if (tray) tray.setToolTip(`Floating Box — 알림 ${hub.unreadCount()}개`);
}

async function refreshUsage() {
  const creds = readClaudeCredentials();
  if (creds) {
    try {
      usageState.plan = await usage.fetchPlanUsage(creds.accessToken);
      usageState.planError = null;
      usageState.source = creds.subscriptionType || 'oauth';
    } catch (e) {
      usageState.planError = e.status === 401 ? '토큰 만료: 터미널에서 claude 를 한 번 실행해 갱신하세요' : e.message;
    }
  } else {
    usageState.planError = 'Claude Code 로그인 정보를 찾을 수 없음 (~/.claude/.credentials.json)';
  }
  try {
    usageState.code = await usage.collectCodeUsage();
    usageState.codeError = null;
  } catch (e) {
    usageState.codeError = e.message;
  }
  usageState.updatedAt = Date.now();
  checkUsageThresholds();
  send('usage', usageState);
}

const warned = new Set();
function checkUsageThresholds() {
  for (const b of usageState.plan) {
    for (const level of [80, 95]) {
      const key = `${b.key}:${level}:${b.resetsAt}`;
      if (b.percent >= level && !warned.has(key)) {
        warned.add(key);
        hub.push({ title: `Claude 사용량 ${level}% 도달`, body: `${b.label}: ${Math.round(b.percent)}%`, source: 'usage', urgency: level >= 95 ? 'critical' : 'normal' });
      }
    }
  }
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '숨기기 (트레이에서 다시 열기)', click: () => win.hide() },
    { label: '알림 모두 지우기', click: () => { hub.clear(); sendState(); } },
    { label: '사용량 새로고침', click: () => refreshUsage() },
    { type: 'separator' },
    {
      label: '마우스 없을 때도 선명하게', type: 'checkbox', checked: !!cfg.alwaysSharp,
      click: (item) => { cfg.alwaysSharp = item.checked; config.save(userData(), cfg); sendState(); },
    },
    {
      label: '너비',
      submenu: [220, 250, 290, 340].map((w) => ({
        label: `${w}px`, type: 'radio', checked: cfg.window.width === w,
        click: () => { cfg.window.width = w; win.setContentSize(w, win.getContentSize()[1], false); config.save(userData(), cfg); },
      })),
    },
    {
      label: '로그인 시 자동 실행', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
}

function buildTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVQ4T2NkYGD4z0AEYCJGEUjNqEJiQ2rUDf+jQUcNGjXoP0ONhoaG/8jJyQkYGBg4FBYW/j+MDQwAAJ8PC1cz2D2qAAAAAElFTkSuQmCC'
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  const menu = buildMenu();
  tray.setContextMenu(menu);
  tray.on('click', () => (win.isVisible() ? win.hide() : win.show()));
}

function wireIpc() {
  ipcMain.on('timer:save', (_e, snapshot) => {
    cfg.timer = snapshot;
    config.save(userData(), cfg);
  });
  ipcMain.on('notify:push', (_e, n) => { hub.push(n, { source: 'app' }); });
  ipcMain.on('notify:read', (_e, id) => hub.markRead(id));
  ipcMain.on('notify:readAll', () => { hub.items.forEach((n) => (n.read = true)); hub.emit('change'); });
  ipcMain.on('notify:dismiss', (_e, id) => hub.dismiss(id));
  ipcMain.on('notify:clear', () => hub.clear());
  ipcMain.on('usage:refresh', () => refreshUsage());
  ipcMain.on('window:hide', () => win && win.hide());
  ipcMain.on('window:quit', () => app.quit());
  let lastHeight = 0;
  ipcMain.on('window:resize', (_e, h) => {
    if (!win || !Number.isFinite(h)) return;
    const height = Math.max(60, Math.min(Math.round(h) + 2, screen.getPrimaryDisplay().workArea.height - 40));
    if (height === lastHeight) return;
    lastHeight = height;
    // Always pass our own width: never read the size back from the window, so it cannot drift.
    win.setContentSize(cfg.window.width, height, false);
  });
  ipcMain.on('window:menu', () => buildMenu().popup({ window: win }));
  ipcMain.on('open:url', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.handle('state:get', () => ({ notifications: hub.items, usage: usageState, timer: cfg.timer, hubPort: hub.port }));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) win.show(); });

app.whenReady().then(async () => {
  cfg = config.load(userData());
  if (![220, 250, 290, 340].includes(cfg.window.width)) cfg.window.width = config.DEFAULTS.window.width;
  if (cfg.layout !== 3) { // layout change: reset to the new default width once
    cfg.layout = 3;
    cfg.window = { ...cfg.window, width: config.DEFAULTS.window.width, height: config.DEFAULTS.window.height };
    config.save(userData(), cfg);
  }
  hub = new NotifyHub({ port: cfg.hubPort });
  hub.on('notification', (n) => { send('notification', n); sendState(); if (win && !win.isVisible()) win.showInactive(); });
  hub.on('change', () => sendState());

  try {
    await hub.listen();
  } catch (e) {
    console.error('notification hub failed to start:', e.message);
  }

  if (cfg.captureDesktopNotifications) {
    const log = (m) => console.log(m);
    if (process.platform === 'linux') capture = await startDesktopNotificationServer(hub, { log });
    else if (process.platform === 'win32') capture = startWindowsNotificationListener(hub, { log });
    else capture = { ok: false, reason: 'unsupported on ' + process.platform };
    if (!capture.ok) console.log('desktop notification capture off:', capture.reason);
  }

  wireIpc();
  createWindow();
  buildTray();

  refreshUsage();
  usageTimer = setInterval(refreshUsage, cfg.usagePollMs);

  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => { /* keep tray alive */ });
app.on('before-quit', async () => {
  clearInterval(usageTimer);
  if (capture && capture.stop) capture.stop();
  if (hub) await hub.close();
});
