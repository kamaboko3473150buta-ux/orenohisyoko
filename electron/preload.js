// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');
// estimate.js はElectronに依存しない純粋関数のみを持つモジュールなので、
// IPCを増やさずpreload（Node実行）から直接呼べる。料金の定数はmodels.js一本化のまま。
const { estimateYen, needsConfirm } = require('../src/main/docgen/estimate');

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

  // 選べるモデルの一覧・機能ごとの既定（Task 33）
  modelsList: () => ipcRenderer.invoke('models:list'),

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
  taskBrief: (args) => ipcRenderer.invoke('task:brief', args),

  // 資料作成
  docTypes: () => ipcRenderer.invoke('doc:types'),
  docPickFiles: () => ipcRenderer.invoke('doc:pickFiles'),
  docReadFiles: (args) => ipcRenderer.invoke('doc:readFiles', args),
  docOutline: (args) => ipcRenderer.invoke('doc:outline', args),
  docBody: (args) => ipcRenderer.invoke('doc:body', args),
  docSave: (args) => ipcRenderer.invoke('doc:save', args),
  // 添付の文字数からの概算費用（同期・IPC無し）。モデルを変えるたびに画面から呼び直す。
  docEstimate: (chars, modelId) => ({
    yen: estimateYen(chars, modelId),
    needsConfirm: needsConfirm(chars),
  }),
});
