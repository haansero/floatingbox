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
    minWidth: 240,
    minHeight: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
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
  win.setOpacity(cfg.opacity);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const persistBounds = () => {
    if (!win) return;
    cfg.window = { ...cfg.window, ...win.getBounds() };
    config.save(userData(), cfg);
  };
  win.on('moved', persistBounds);
  win.on('resized', persistBounds);
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

function buildTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVQ4T2NkYGD4z0AEYCJGEUjNqEJiQ2rUDf+jQUcNGjXoP0ONhoaG/8jJyQkYGBg4FBYW/j+MDQwAAJ8PC1cz2D2qAAAAAElFTkSuQmCC'
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  const menu = Menu.buildFromTemplate([
    { label: '보이기 / 숨기기', click: () => (win.isVisible() ? win.hide() : win.show()) },
    { label: '알림 모두 지우기', click: () => { hub.clear(); sendState(); } },
    { type: 'separator' },
    {
      label: '투명도',
      submenu: [1, 0.94, 0.85, 0.7, 0.5].map((v) => ({
        label: `${Math.round(v * 100)}%`, type: 'radio', checked: cfg.opacity === v,
        click: () => { cfg.opacity = v; win.setOpacity(v); config.save(userData(), cfg); },
      })),
    },
    { label: '사용량 새로고침', click: () => refreshUsage() },
    {
      label: '로그인 시 자동 실행', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
    },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
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
  ipcMain.on('open:url', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.handle('state:get', () => ({ notifications: hub.items, usage: usageState, timer: cfg.timer, hubPort: hub.port }));
}

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) win.show(); });

app.whenReady().then(async () => {
  cfg = config.load(userData());
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
