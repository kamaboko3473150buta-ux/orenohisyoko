// src/renderer/views/translate.js
// 言語翻訳画面。Word文書を選ぶ → 訳したい言語を選ぶ・入力する → 翻訳する、の1画面構成
// （docgen.jsのように段階を分けるほど手を入れる余地が無い機能のため、画面は1つで足りる）。
//
// 翻訳は塊（chunkItems）ごとに複数回APIを呼ぶ。1回のIPC呼び出しに全部まとめてしまうと
// 画面側で進捗が分からなくなるため、あえて塊の数だけ translateChunk を順にawaitし、
// 呼び終わるたびに秘書子の吹き出しで「◯/◯ を翻訳中…」を更新する。
// すべての塊が終わってから translate:save を呼ぶ＝1回でも失敗したら保存自体をしない
// （黙って一部だけ訳した文書を作らないため）。
window.Views = window.Views || {};

Views.translate = {
  async render(root) {
    App.setTitle('言語翻訳');

    const settings = await window.hishoko.getSettings();
    const modelMeta = await window.hishoko.modelsList();
    const { languages } = await window.hishoko.translateLanguages();

    const state = {
      filePath: null,
      fileName: '',
      paragraphCount: 0,
      charCount: 0,
      chunkCount: 0,
      targetLanguage: '', // チップで選んだ、または自由入力した言語名（表示ラベルそのもの）
    };

    function buildModelSelect() {
      const select = App.h('select');
      modelMeta.models.forEach((m) => {
        const opt = App.h('option', { value: m.id, text: m.label });
        if (settings.models.translate === m.id) opt.selected = true;
        select.appendChild(opt);
      });
      return select;
    }

    const errorEl = App.h('div', { class: 'error', hidden: true });
    const fileInfoEl = App.h('div', { class: 'status' });
    const pickBtn = App.h('button', { class: 'secondary', text: 'ファイルを選ぶ' });
    const runBtn = App.h('button', { text: '翻訳する' });

    function updateRunButton() {
      runBtn.disabled = !state.filePath || state.paragraphCount === 0;
    }

    function renderFileInfo() {
      while (fileInfoEl.firstChild) fileInfoEl.removeChild(fileInfoEl.firstChild);
      if (!state.fileName) {
        fileInfoEl.appendChild(App.h('span', { text: 'まだ文書が選ばれていません。' }));
        return;
      }
      fileInfoEl.appendChild(App.h('div', { text: state.fileName }));
      if (state.paragraphCount === 0) {
        // (4) 段落が0件（画像だけの文書など）のときに親切に伝える。
        fileInfoEl.appendChild(App.h('div', {
          class: 'error',
          text: '翻訳できる文章が見つかりませんでした（画像だけの文書など）。別のファイルを選んでください。',
        }));
      } else {
        fileInfoEl.appendChild(App.h('div', {
          class: 'status',
          text: `段落 ${state.paragraphCount.toLocaleString()} / ${state.charCount.toLocaleString()}字`,
        }));
      }
    }

    // --- (2) 訳したい言語: 一覧チップ＋自由入力 ---
    const chipsHost = App.h('div', { class: 'chips' });
    const otherInput = App.h('input', { type: 'text', placeholder: '言語名を入力（例: アラビア語）' });

    function renderChips() {
      while (chipsHost.firstChild) chipsHost.removeChild(chipsHost.firstChild);
      languages.forEach((lang) => {
        const selected = !otherInput.value && state.targetLanguage === lang.label;
        const chip = App.h('div', { class: `chip${selected ? ' selected' : ''}`, text: lang.label });
        chip.addEventListener('click', () => {
          state.targetLanguage = lang.label;
          otherInput.value = ''; // チップ選択と自由入力は排他
          renderChips();
        });
        chipsHost.appendChild(chip);
      });
    }
    renderChips();

    otherInput.addEventListener('input', () => {
      state.targetLanguage = otherInput.value.trim();
      renderChips(); // チップの選択表示を消すため再描画
    });

    const summaryEl = App.h('div', { class: 'status' });
    const modelSelect = buildModelSelect();

    async function renderSummary() {
      if (!state.charCount) {
        summaryEl.textContent = '';
        return;
      }
      const { yen } = await window.hishoko.translateEstimate({
        chars: state.charCount, chunkCount: state.chunkCount, modelId: modelSelect.value,
      });
      summaryEl.textContent = `概算 約${Math.round(yen)}円`;
    }
    modelSelect.addEventListener('change', renderSummary);

    pickBtn.addEventListener('click', async () => {
      const picked = await window.hishoko.translatePickFile();
      if (!picked.ok) return; // キャンセルなら何もしない

      errorEl.hidden = true;
      pickBtn.disabled = true;
      pickBtn.textContent = '読み取り中…';
      const res = await window.hishoko.translateRead({ filePath: picked.filePath });
      pickBtn.disabled = false;
      pickBtn.textContent = 'ファイルを選ぶ';

      if (!res.ok) {
        errorEl.textContent = res.message;
        errorEl.hidden = false;
        return;
      }

      state.filePath = picked.filePath;
      state.fileName = res.fileName;
      state.paragraphCount = res.paragraphCount;
      state.charCount = res.charCount;
      state.chunkCount = res.chunkCount;
      renderFileInfo();
      renderSummary();
      updateRunButton();
    });

    runBtn.addEventListener('click', async () => {
      errorEl.hidden = true;
      if (!state.filePath || state.paragraphCount === 0) return;

      const lang = state.targetLanguage.trim();
      if (!lang) {
        errorEl.textContent = '訳したい言語を選ぶか入力してください。';
        errorEl.hidden = false;
        return;
      }

      runBtn.disabled = true;
      pickBtn.disabled = true;
      const total = state.chunkCount;
      Hishoko.say('thinking', `0/${total} を翻訳中…`);

      let anyFailed = false;
      for (let i = 0; i < total; i += 1) {
        // (2) 取りこぼしを防ぐため、塊を1つずつ順番に処理する（並列にはしない）。
        // (3') 1つでも失敗したら、その場で止めてsaveを呼ばない
        // （黙って一部だけ訳した文書を作らないため）。
        // eslint的な意味でも意図的にawait in loop。
        const res = await window.hishoko.translateChunk({
          chunkIndex: i, targetLanguage: lang, model: modelSelect.value,
        });
        if (!res.ok) {
          runBtn.disabled = false;
          pickBtn.disabled = false;
          errorEl.textContent = res.message;
          errorEl.hidden = false;
          Hishoko.say('trouble', '翻訳できませんでした');
          if (res.code === 'no_key' || res.code === 'auth') App.go('settings');
          return;
        }
        anyFailed = anyFailed || res.failed;
        Hishoko.say('thinking', `${res.done}/${res.total} を翻訳中…`);
      }

      Hishoko.say('thinking', '保存する場所を選んでください…');
      const saveRes = await window.hishoko.translateSave({ targetLanguageLabel: lang });
      runBtn.disabled = false;
      pickBtn.disabled = false;

      if (!saveRes.ok) {
        if (saveRes.code === 'canceled') {
          Hishoko.clear();
          return; // キャンセルなら何もしない
        }
        errorEl.textContent = saveRes.message || '保存に失敗しました。';
        errorEl.hidden = false;
        Hishoko.say('trouble', '保存できませんでした');
        return;
      }

      Hishoko.say('smile', anyFailed
        ? '完了しましたが、一部訳せなかった段落は原文のまま残っています。'
        : '翻訳が完了しました');
      App.toast('保存しました');
    });

    renderFileInfo();
    renderSummary();
    updateRunButton();

    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('div', { class: 'field' }, [
        App.h('label', { text: '(1) Word文書を選ぶ' }),
        App.h('div', { class: 'actions' }, [pickBtn]),
        fileInfoEl,
      ]),
      App.h('div', { class: 'field' }, [
        App.h('label', { text: '(2) 訳したい言語' }),
        chipsHost,
        App.h('div', { class: 'model-inline' }, [
          App.h('span', { text: 'その他' }),
          otherInput,
        ]),
      ]),
      errorEl,
      App.h('div', { class: 'actions' }, [
        summaryEl,
        App.h('div', { class: 'model-inline' }, [App.h('span', { text: 'モデル' }), modelSelect]),
        runBtn,
      ]),
    ]));
  },
};
