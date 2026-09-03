// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hishoko', {
  // 設定（APIキーそのものは受け取らない）
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  getCounts: () => ipcRenderer.invoke('settings:counts'),
  clearContacts: () => ipcRenderer.invoke('settings:clearContacts'),
  clearHistory: () => ipcRenderer.invoke('settings:clearHistory'),

  // メール文面作成
  mailMeta: () => ipcRenderer.invoke('mail:meta'),
  mailContacts: () => ipcRenderer.invoke('mail:contacts'),
  mailHistory: () => ipcRenderer.invoke('mail:history'),
  mailGenerate: (input) => ipcRenderer.invoke('mail:generate', input),
  mailOpenOutlook: (args) => ipcRenderer.invoke('mail:openOutlook', args),
  mailOpenGmail: (args) => ipcRenderer.invoke('mail:openGmail', args),
  mailCopy: (args) => ipcRenderer.invoke('mail:copy', args),
});
