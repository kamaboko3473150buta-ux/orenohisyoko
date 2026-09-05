// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');
// preload はサンドボックスで動くため、electron 以外の require は使えない。
// ここで普通のファイルを require すると preload 全体が失敗し、
// window.hishoko そのものが作られなくなる（実際にそれで全画面が壊れた）。
// 概算費用の計算もメインプロセス側に置き、IPC で取りに行く。

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
  // 資料作成を新しく始めるときに呼ぶ。前回抽出した画像の一時フォルダを片付ける。
  docResetImages: () => ipcRenderer.invoke('doc:resetImages'),
  docOutline: (args) => ipcRenderer.invoke('doc:outline', args),
  docBody: (args) => ipcRenderer.invoke('doc:body', args),
  docSave: (args) => ipcRenderer.invoke('doc:save', args),
  // 添付の文字数からの概算費用。モデルを変えるたびに画面から呼び直す。
  docEstimate: (chars, modelId) => ipcRenderer.invoke('doc:estimate', { chars, modelId }),

  // 言語翻訳
  translateLanguages: () => ipcRenderer.invoke('translate:languages'),
  translatePickFile: () => ipcRenderer.invoke('translate:pickFile'),
  translateRead: (args) => ipcRenderer.invoke('translate:read', args),
  translateEstimate: (args) => ipcRenderer.invoke('translate:estimate', args),
  translateChunk: (args) => ipcRenderer.invoke('translate:translateChunk', args),
  translateSave: (args) => ipcRenderer.invoke('translate:save', args),
});
