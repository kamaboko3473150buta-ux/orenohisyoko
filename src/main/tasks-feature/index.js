// src/main/tasks-feature/index.js
// タスク・スケジュール管理機能のIPCハンドラをまとめて登録する。
// データの更新・グループ分けは src/main/tasks.js、AI連携のプロンプト組み立てと
// 応答の解析は src/main/task-ai.js（どちらもTask 21/22で実装済み）にすべて任せ、
// ここでは「保存する」「Claudeを呼ぶ」という副作用だけを担う。

const { ipcMain } = require('electron');
const {
  newTask, addTask, updateTask, removeTask, toggleDone, pruneDone, groupTasks, countDueSoon,
  migrateTasks,
} = require('../tasks');
const {
  buildParseSystemPrompt, buildParseUserPrompt, parseTaskJson,
  buildBriefSystemPrompt, buildBriefUserPrompt,
} = require('../task-ai');
const planner = require('../planner/prompt');
const { generateText } = require('../claude');
const { addUsage } = require('../usage');

// タスクのAI連携は短いやり取りなので、メール本文生成（既定4000）より小さく抑える。
const PARSE_MAX_TOKENS = 300;
const BRIEF_MAX_TOKENS = 400;
// 行程表は日数ぶんの箇条書きになるので、ここだけは長めに取る。
// 案まで出させるぶん長くなるので、少し余裕を持たせる。
const PLAN_MAX_TOKENS = 3000;

// 'YYYY-MM-DD'（ローカル日付）。tasks.js の due と同じ形式・同じ基準（ローカル時刻）で揃える。
function todayYmd(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function register({ getSettings, getTasks, saveTasks, getUsage, saveUsage }) {
  // 保存されているタスクは旧形式（dueだけを持つ）のことがあるため、読み込むたびに
  // migrateTasksを通してstart/end形式に揃える。既存ユーザーの記録を失わないための
  // 移行なので、保存元（tasks.json）を直接書き換えるのではなく読み込み時に毎回かける。
  const readTasks = () => migrateTasks(getTasks());

  // 一覧をグループ分け済みの形で渡す。締切の知らせ（F-20）に使う件数も一緒に返す。
  ipcMain.handle('task:list', () => {
    const list = readTasks();
    const today = todayYmd();
    return { groups: groupTasks(list, today), dueSoon: countDueSoon(list, today) };
  });

  // 確認フォームで内容を確定したあとに呼ぶ（AI取り込み・手入力どちらも共通）。
  ipcMain.handle('task:add', (_e, input) => {
    const now = new Date().toISOString();
    const task = newTask(input || {}, now);
    saveTasks(pruneDone(addTask(readTasks(), task)));
    return { ok: true, task };
  });

  ipcMain.handle('task:update', (_e, { id, patch } = {}) => {
    saveTasks(updateTask(readTasks(), id, patch || {}));
    return { ok: true };
  });

  ipcMain.handle('task:remove', (_e, { id } = {}) => {
    saveTasks(removeTask(readTasks(), id));
    return { ok: true };
  });

  ipcMain.handle('task:toggle', (_e, { id } = {}) => {
    const now = new Date().toISOString();
    saveTasks(pruneDone(toggleDone(readTasks(), id, now)));
    return { ok: true };
  });

  // 話し言葉の1行をAIで構造化するだけで、登録はしない。
  // 画面側が確認フォームを挟んでから改めて task:add を呼ぶ（誤読をそのまま登録させないため）。
  ipcMain.handle('task:parse', async (_e, { text, model } = {}) => {
    const settings = getSettings();
    const result = await generateText({
      apiKey: settings.apiKey,
      system: buildParseSystemPrompt(),
      user: buildParseUserPrompt({ text, today: todayYmd() }),
      maxTokens: PARSE_MAX_TOKENS,
      // 画面で選んだモデル（その回だけの上書き）。未指定なら設定の既定（タスク機能）を使う。
      model: model || settings.models.task,
    });
    if (!result.ok) return result; // no_key / auth / timeout などはそのまま画面に伝える

    saveUsage(addUsage(getUsage(), result.usage, new Date().toISOString()));
    // 解析に失敗しても例外にはならない（parseTaskJsonが入力文をtitleに入れて返す）。
    const { task, failed } = parseTaskJson(result.body, text);
    return { ok: true, task, failed };
  });

  // 予定の行程表を作る。**ここでは保存しない。**
  // 誤った行程をそのまま予定に入れてしまわないよう、画面で確認してから
  // 改めて task:update で保存させる（AI取り込みと同じ考え方）。
  ipcMain.handle('task:plan', async (_e, { id, given, model } = {}) => {
    const task = readTasks().find((t) => t && t.id === id);
    if (!task) return { ok: false, code: 'not_found', message: 'その予定が見つかりませんでした。' };
    if (!planner.canPlan(task)) {
      return {
        ok: false,
        code: 'no_date',
        message: '行程表を作るには、日付（開始日か終了日）が要ります。',
      };
    }

    const settings = getSettings();
    const result = await generateText({
      apiKey: settings.apiKey,
      system: planner.buildPlanSystemPrompt(),
      user: planner.buildPlanUserPrompt({ task, given }),
      maxTokens: PLAN_MAX_TOKENS,
      model: model || settings.models.task,
    });
    if (!result.ok) return result;

    saveUsage(addUsage(getUsage(), result.usage, new Date().toISOString()));
    return { ok: true, plan: result.body };
  });

  // 未完了タスクをもとに「今日の進め方」を相談する。タスクの中身は書き換えない。
  ipcMain.handle('task:brief', async (_e, { model } = {}) => {
    const settings = getSettings();
    const notDone = readTasks().filter((t) => t && !t.done);
    const today = todayYmd();
    // 行程表を持つ予定のうち、**今日ぶんだけ**を渡す。
    // 行程表まるごとを毎日渡すと、日数ぶんの文字が毎日費用になる。
    const todayPlans = notDone
      .map((t) => ({ title: t.title, day: planner.extractDay(t.plan, today) }))
      .filter((x) => x.day);
    const result = await generateText({
      apiKey: settings.apiKey,
      system: buildBriefSystemPrompt(),
      user: buildBriefUserPrompt({ tasks: notDone, today, plans: todayPlans }),
      maxTokens: BRIEF_MAX_TOKENS,
      model: model || settings.models.task,
    });
    if (!result.ok) return result;

    saveUsage(addUsage(getUsage(), result.usage, new Date().toISOString()));
    return { ok: true, message: result.body };
  });
}

module.exports = { register };
