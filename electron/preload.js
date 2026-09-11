'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('box', {
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onUsage: (cb) => ipcRenderer.on('usage', (_e, u) => cb(u)),
  onNotification: (cb) => ipcRenderer.on('notification', (_e, n) => cb(n)),
  getState: () => ipcRenderer.invoke('state:get'),
  saveTimer: (snap) => ipcRenderer.send('timer:save', snap),
  pushNotification: (n) => ipcRenderer.send('notify:push', n),
  markRead: (id) => ipcRenderer.send('notify:read', id),
  markAllRead: () => ipcRenderer.send('notify:readAll'),
  dismiss: (id) => ipcRenderer.send('notify:dismiss', id),
  clearNotifications: () => ipcRenderer.send('notify:clear'),
  refreshUsage: () => ipcRenderer.send('usage:refresh'),
  hide: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('window:quit'),
  openUrl: (u) => ipcRenderer.send('open:url', u),
});
