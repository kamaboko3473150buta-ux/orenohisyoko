// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hishoko', {
  // 設定（APIキーそのものは受け取らない）
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  getCounts: () => ipcRenderer.invoke('settings:counts'),
  clearContacts: () => ipcRenderer.invoke('settings:clearContacts'),
  clearHistory: () => ipcRenderer.invoke('settings:clearHistory'),

  // API利用状況
  getUsage: () => ipcRenderer.invoke('usage:get'),
  clearUsage: () => ipcRenderer.invoke('usage:clear'),

  // メール文面作成
  mailMeta: () => ipcRenderer.invoke('mail:meta'),
  mailHistory: () => ipcRenderer.invoke('mail:history'),
  mailGenerate: (input) => ipcRenderer.invoke('mail:generate', input),
  mailGenerateReply: (input) => ipcRenderer.invoke('mail:generateReply', input),
  mailOpenOutlook: (args) => ipcRenderer.invoke('mail:openOutlook', args),
  mailOpenGmail: (args) => ipcRenderer.invoke('mail:openGmail', args),
  mailCopy: (args) => ipcRenderer.invoke('mail:copy', args),

  // アドレス帳
  bookGet: () => ipcRenderer.invoke('book:get'),
  bookUpsertContact: (contact) => ipcRenderer.invoke('book:upsertContact', contact),
  bookRemoveContact: (args) => ipcRenderer.invoke('book:removeContact', args),
  bookUpsertGroup: (group) => ipcRenderer.invoke('book:upsertGroup', group),
  bookRemoveGroup: (args) => ipcRenderer.invoke('book:removeGroup', args),

  // タスク・スケジュール管理
  taskList: () => ipcRenderer.invoke('task:list'),
  taskAdd: (input) => ipcRenderer.invoke('task:add', input),
  taskUpdate: (args) => ipcRenderer.invoke('task:update', args),
  taskRemove: (args) => ipcRenderer.invoke('task:remove', args),
  taskToggle: (args) => ipcRenderer.invoke('task:toggle', args),
  taskParse: (args) => ipcRenderer.invoke('task:parse', args),
  taskBrief: () => ipcRenderer.invoke('task:brief'),
});
