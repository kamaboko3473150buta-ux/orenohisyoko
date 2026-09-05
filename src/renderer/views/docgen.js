// src/renderer/views/docgen.js
// 資料作成画面。入力（種類・依頼内容・参考資料・出力形式）→ 構成案の確認・編集 →
// 本文プレビューの編集 → 保存、の3段階を1つの画面内で切り替える（tasks.jsのformHostと同じ
// 「差し込み先を空にしてから作り直す」やり方）。
//
// 資料は保存しない使い捨てのデータ（設計書 4-4d）なので、App.stateやlocalStorageには
// 置かず、この画面を開いている間だけの変数（state）に持つ。
window.Views = window.Views || {};

// プレゼン資料（deck形式）のレイアウト名を、画面に出す日本語ラベルにする。
const SLIDE_LAYOUT_LABELS = {
  title: '表紙',
  statement: '主張',
  bullets: '箇条書き',
  compare: '比較',
  image: '画像',
  closing: 'まとめ',
};

function slideLayoutLabel(layout) {
  return SLIDE_LAYOUT_LABELS[layout] || layout || '（不明）';
}

// 構成案の段階（まだbulletsの中身が無いこともある）のスライド1枚を、
// 読み取り用の短いテキストにする。
function summarizeSlideContent(slide) {
  if (slide.layout === 'compare') {
    const left = slide.left || {};
    const right = slide.right || {};
    const leftText = [left.heading, ...(left.bullets || [])].filter(Boolean).join(' / ');
    const rightText = [right.heading, ...(right.bullets || [])].filter(Boolean).join(' / ');
    return [leftText, rightText].filter(Boolean).join('\n') || '（内容なし）';
  }
  if (Array.isArray(slide.bullets) && slide.bullets.length) {
    return slide.bullets.map((b) => `・${b}`).join('\n');
  }
  if (slide.lead) return slide.lead;
  return '（内容なし）';
}

Views.docgen = {
  async render(root) {
    App.setTitle('資料作成');

    const settings = await window.hishoko.getSettings();
    const modelMeta = await window.hishoko.modelsList();
    const { types } = await window.hishoko.docTypes();
    // この画面を開くたびに「新しい資料作成」として、前回抽出した画像の
    // 一時フォルダを片付けてもらう（他人の資料の画像を残さないため）。
    await window.hishoko.docResetImages();

    function findType(id) {
      return types.find((t) => t.id === id) || types[0];
    }

    const state = {
      typeId: types[0] ? types[0].id : 'report',
      brief: '',
      attachments: [], // { ok, name, chars, error, text }
      imageCount: 0, // 添付から抽出できた画像の枚数（プレゼン資料でのみ使う）
      outline: null, // 通常: { title, sections: [{ heading, points }] } / プレゼン: deck
      doc: null, // 通常: { title, sections: [{ heading, paragraphs, bullets }] } / プレゼン: deck
    };
    state.format = findType(state.typeId).defaultFormat;

    function isSlideType() {
      return state.typeId === 'presentation';
    }

    function totalChars() {
      return state.attachments
        .filter((a) => a.ok)
        .reduce((sum, a) => sum + (a.chars || 0), 0);
    }

    // 実行ボタンの横に置く、その回だけのモデル選択。初期値は設定の既定（資料作成）。
    function buildModelSelect() {
      const select = App.h('select');
      modelMeta.models.forEach((m) => {
        const opt = App.h('option', { value: m.id, text: m.label });
        if (settings.models.docgen === m.id) opt.selected = true;
        select.appendChild(opt);
      });
      return select;
    }

    const screenHost = App.h('div');
    root.appendChild(screenHost);

    function showScreen(el) {
      while (screenHost.firstChild) screenHost.removeChild(screenHost.firstChild);
      screenHost.appendChild(el);
    }

    // --- (1) 入力画面 ---
    function renderInputScreen() {
      const typeChips = App.h('div', { class: 'chips' }, types.map((t) => {
        const chip = App.h('div', {
          class: `chip${t.id === state.typeId ? ' selected' : ''}`,
          text: t.label,
        });
        chip.addEventListener('click', () => {
          state.typeId = t.id;
          state.format = findType(t.id).defaultFormat; // 種類の既定形式に切り替える
          renderInputScreen();
        });
        return chip;
      }));

      const briefInput = App.h('textarea', {
        placeholder: '例: 9/3の定例会議の議事録。決定事項と宿題を明確に',
      });
      briefInput.value = state.brief;
      briefInput.addEventListener('input', () => { state.brief = briefInput.value; });

      const pickBtn = App.h('button', { class: 'secondary', text: 'ファイルを選ぶ' });
      const attachList = App.h('div', { class: 'attach-list' });
      const summaryEl = App.h('div', { class: 'status' });
      const imageInfoEl = App.h('div', { class: 'status' });

      // プレゼン資料のときだけ、添付から使える画像の枚数を伝える。
      function renderImageInfo() {
        if (isSlideType() && state.imageCount > 0) {
          imageInfoEl.textContent = `画像 ${state.imageCount}枚を利用できます。`;
          imageInfoEl.hidden = false;
        } else {
          imageInfoEl.hidden = true;
        }
      }

      function renderAttachList() {
        while (attachList.firstChild) attachList.removeChild(attachList.firstChild);
        state.attachments.forEach((a, idx) => {
          const infoEl = a.ok
            ? App.h('span', { class: 'attach-chars', text: `${a.chars.toLocaleString()}字` })
            : App.h('span', { class: 'attach-error', text: `読み取れませんでした: ${a.error}` });
          const removeBtn = App.h('button', { class: 'ghost attach-remove', text: '✕' });
          removeBtn.addEventListener('click', () => {
            state.attachments.splice(idx, 1);
            renderAttachList();
            renderSummary();
          });
          attachList.appendChild(App.h('div', { class: 'attach-row' }, [
            App.h('span', { class: 'attach-name', text: a.name }),
            infoEl,
            removeBtn,
          ]));
        });
      }

      async function renderSummary() {
        const chars = totalChars();
        if (!chars) {
          summaryEl.textContent = '参考資料を添付すると、文字数と概算費用を表示します。';
          return;
        }
        const { yen } = await window.hishoko.docEstimate(chars, modelSelect.value);
        summaryEl.textContent = `合計 ${chars.toLocaleString()}字 / 概算 約${Math.round(yen)}円（構成案・本文の2回分）`;
      }

      pickBtn.addEventListener('click', async () => {
        const { filePaths } = await window.hishoko.docPickFiles();
        if (!filePaths || !filePaths.length) return; // キャンセルなら何もしない
        pickBtn.disabled = true;
        pickBtn.textContent = '読み取り中…';
        const { results, imageCount } = await window.hishoko.docReadFiles({ filePaths });
        pickBtn.disabled = false;
        pickBtn.textContent = 'ファイルを選ぶ';
        state.attachments = state.attachments.concat(results);
        state.imageCount = imageCount || 0;
        renderAttachList();
        renderSummary();
        renderImageInfo();
      });

      // 出力形式。プレゼン資料はレイアウトを描くPowerPoint専用なので選ばせない
      // （Word/PDFにしても意味のある見た目にならないため）。
      function buildFormatRadio(value, label) {
        const id = `docFormat_${value}`;
        const input = App.h('input', { type: 'radio', name: 'docFormat', id });
        input.checked = state.format === value;
        input.addEventListener('change', () => {
          state.format = value;
        });
        return App.h('span', {}, [input, App.h('label', { for: id, text: label })]);
      }
      const formatField = isSlideType()
        ? App.h('div', { class: 'status', text: '出力形式: PowerPoint（プレゼン資料は自動でPowerPoint形式になります）' })
        : App.h('div', { class: 'radio-row' }, [
          buildFormatRadio('docx', 'Word'),
          buildFormatRadio('pptx', 'PowerPoint'),
          buildFormatRadio('pdf', 'PDF'),
        ]);

      const modelSelect = buildModelSelect();
      modelSelect.addEventListener('change', renderSummary);

      const outlineBtn = App.h('button', { text: '構成案を作る' });
      const errorEl = App.h('div', { class: 'error', hidden: true });

      outlineBtn.addEventListener('click', async () => {
        errorEl.hidden = true;
        const chars = totalChars();
        const est = await window.hishoko.docEstimate(chars, modelSelect.value);
        // 3万字を超えるときは、実行前に概算金額を示して確認を取る
        // （意図しない高額課金を防ぐため。設計書4-6・要件で最優先とされている点）。
        if (est.needsConfirm) {
          const proceed = window.confirm(
            `参考資料が多いため、構成案・本文の作成で概算約${Math.round(est.yen)}円かかります。実行しますか？`,
          );
          if (!proceed) return;
        }

        const okAttachments = state.attachments.filter((a) => a.ok);
        outlineBtn.disabled = true;
        outlineBtn.textContent = '作成中…（数十秒かかります）';
        Hishoko.say('thinking', '構成案を考えています…');

        const res = await window.hishoko.docOutline({
          typeId: state.typeId,
          brief: state.brief,
          sources: okAttachments.map((a) => ({ name: a.name, text: a.text })),
          model: modelSelect.value,
        });

        outlineBtn.disabled = false;
        outlineBtn.textContent = '構成案を作る';

        if (!res.ok) {
          errorEl.textContent = res.message;
          errorEl.hidden = false;
          Hishoko.say('trouble', '構成案を作れませんでした');
          if (res.code === 'no_key' || res.code === 'auth') App.go('settings');
          return;
        }

        state.outline = res.outline;
        if (res.failed) {
          Hishoko.say('trouble', '構成案の読み取りに失敗しました。内容を確認して編集してください。');
        } else {
          Hishoko.say('smile', '構成案ができました。内容を確認してください');
        }
        if (isSlideType()) {
          renderSlideOutlineScreen();
        } else {
          renderOutlineScreen();
        }
      });

      renderAttachList();
      renderSummary();
      renderImageInfo();

      showScreen(App.h('div', {}, [
        App.h('div', { class: 'card' }, [
          App.h('div', { class: 'field' }, [
            App.h('label', { text: '(1) 資料の種類' }),
            typeChips,
          ]),
          App.h('div', { class: 'field' }, [
            App.h('label', { text: '(2) 何を作りたいか' }),
            briefInput,
          ]),
          App.h('div', { class: 'field' }, [
            App.h('label', { text: '(3) 参考資料（複数可）' }),
            App.h('div', { class: 'actions' }, [pickBtn]),
            attachList,
            summaryEl,
            imageInfoEl,
          ]),
          App.h('div', { class: 'field' }, [
            App.h('label', { text: '(4) 出力形式' }),
            formatField,
          ]),
          errorEl,
          App.h('div', { class: 'actions' }, [
            App.h('div', { class: 'model-inline' }, [App.h('span', { text: 'モデル' }), modelSelect]),
            outlineBtn,
          ]),
        ]),
      ]));
    }

    // --- (2) 構成案の確認・編集画面 ---
    function renderOutlineScreen() {
      const outline = state.outline;

      const titleInput = App.h('input', { type: 'text', value: outline.title || '' });
      titleInput.addEventListener('input', () => { outline.title = titleInput.value; });

      const sectionsHost = App.h('div', { class: 'outline-sections' });

      function renderSections() {
        while (sectionsHost.firstChild) sectionsHost.removeChild(sectionsHost.firstChild);
        outline.sections.forEach((s, idx) => {
          const headingInput = App.h('input', { type: 'text', value: s.heading || '' });
          headingInput.addEventListener('input', () => { s.heading = headingInput.value; });

          const pointsText = (s.points || []).map((p) => `・${p}`).join('\n');
          const pointsEl = App.h('div', {
            class: 'status outline-points',
            text: pointsText || '（要点なし）',
          });

          const upBtn = App.h('button', { class: 'ghost', text: '↑', disabled: idx === 0 });
          const downBtn = App.h('button', {
            class: 'ghost', text: '↓', disabled: idx === outline.sections.length - 1,
          });
          const removeBtn = App.h('button', { class: 'ghost', text: '削除' });

          upBtn.addEventListener('click', () => {
            if (idx === 0) return;
            const tmp = outline.sections[idx - 1];
            outline.sections[idx - 1] = outline.sections[idx];
            outline.sections[idx] = tmp;
            renderSections();
          });
          downBtn.addEventListener('click', () => {
            if (idx === outline.sections.length - 1) return;
            const tmp = outline.sections[idx + 1];
            outline.sections[idx + 1] = outline.sections[idx];
            outline.sections[idx] = tmp;
            renderSections();
          });
          removeBtn.addEventListener('click', () => {
            outline.sections.splice(idx, 1);
            renderSections();
          });

          sectionsHost.appendChild(App.h('div', { class: 'outline-section' }, [
            App.h('div', { class: 'outline-section-row' }, [headingInput, upBtn, downBtn, removeBtn]),
            pointsEl,
          ]));
        });
        if (!outline.sections.length) {
          sectionsHost.appendChild(App.h('div', { class: 'status', text: '見出しがありません。' }));
        }
      }
      renderSections();

      const backBtn = App.h('button', { class: 'secondary', text: 'やり直す' });
      backBtn.addEventListener('click', () => renderInputScreen());

      const bodyModelSelect = buildModelSelect();
      const bodyBtn = App.h('button', { text: 'この構成で本文を作る' });
      const errorEl = App.h('div', { class: 'error', hidden: true });

      bodyBtn.addEventListener('click', async () => {
        errorEl.hidden = true;
        const okAttachments = state.attachments.filter((a) => a.ok);

        bodyBtn.disabled = true;
        bodyBtn.textContent = '作成中…（数十秒かかります）';
        Hishoko.say('thinking', '本文を書いています…');

        const res = await window.hishoko.docBody({
          typeId: state.typeId,
          brief: state.brief,
          sources: okAttachments.map((a) => ({ name: a.name, text: a.text })),
          outline,
          model: bodyModelSelect.value,
        });

        bodyBtn.disabled = false;
        bodyBtn.textContent = 'この構成で本文を作る';

        if (!res.ok) {
          errorEl.textContent = res.message;
          errorEl.hidden = false;
          Hishoko.say('trouble', '本文を作れませんでした');
          if (res.code === 'no_key' || res.code === 'auth') App.go('settings');
          return;
        }

        state.doc = res.doc;
        if (!state.doc.title) state.doc.title = outline.title;
        if (res.failed) {
          Hishoko.say('trouble', '本文の読み取りに失敗しました。内容を確認して編集してください。');
        } else {
          Hishoko.say('smile', '本文ができました。確認してください');
        }
        renderPreviewScreen();
      });

      showScreen(App.h('div', {}, [
        App.h('div', { class: 'card' }, [
          App.h('div', { class: 'field' }, [App.h('label', { text: '資料の題名' }), titleInput]),
          App.h('div', { class: 'field' }, [
            App.h('label', { text: '構成案（見出しの修正・削除・並べ替えができます）' }),
            sectionsHost,
          ]),
          errorEl,
          App.h('div', { class: 'actions' }, [
            backBtn,
            App.h('div', { class: 'model-inline' }, [App.h('span', { text: 'モデル' }), bodyModelSelect]),
            bodyBtn,
          ]),
        ]),
      ]));
    }

    // --- (3) 本文プレビュー・保存画面 ---
    function renderPreviewScreen() {
      const doc = state.doc;

      const titleInput = App.h('input', { type: 'text', value: doc.title || '' });
      titleInput.addEventListener('input', () => { doc.title = titleInput.value; });

      const sectionsHost = App.h('div', { class: 'doc-sections' });

      function renderSections() {
        while (sectionsHost.firstChild) sectionsHost.removeChild(sectionsHost.firstChild);
        doc.sections.forEach((s, idx) => {
          const headingInput = App.h('input', { type: 'text', value: s.heading || '' });
          headingInput.addEventListener('input', () => { s.heading = headingInput.value; });

          const paraTextarea = App.h('textarea', {
            class: 'doc-paragraphs', placeholder: '本文（段落ごとに改行）',
          });
          paraTextarea.value = (s.paragraphs || []).join('\n');
          paraTextarea.addEventListener('input', () => {
            s.paragraphs = paraTextarea.value.split('\n').map((t) => t.trim()).filter((t) => t);
          });

          const bulletsTextarea = App.h('textarea', {
            class: 'doc-bullets', placeholder: '箇条書き（1行1項目）',
          });
          bulletsTextarea.value = (s.bullets || []).join('\n');
          bulletsTextarea.addEventListener('input', () => {
            s.bullets = bulletsTextarea.value.split('\n').map((t) => t.trim()).filter((t) => t);
          });

          const removeBtn = App.h('button', { class: 'ghost', text: '削除' });
          removeBtn.addEventListener('click', () => {
            doc.sections.splice(idx, 1);
            renderSections();
          });

          sectionsHost.appendChild(App.h('div', { class: 'doc-section' }, [
            App.h('div', { class: 'doc-section-row' }, [headingInput, removeBtn]),
            App.h('div', { class: 'row' }, [
              App.h('div', { class: 'field' }, [App.h('label', { text: '本文' }), paraTextarea]),
              App.h('div', { class: 'field' }, [App.h('label', { text: '箇条書き' }), bulletsTextarea]),
            ]),
          ]));
        });
        if (!doc.sections.length) {
          sectionsHost.appendChild(App.h('div', { class: 'status', text: 'セクションがありません。' }));
        }
      }
      renderSections();

      const formatSelect = App.h('select');
      [['docx', 'Word'], ['pptx', 'PowerPoint'], ['pdf', 'PDF']].forEach(([v, label]) => {
        const opt = App.h('option', { value: v, text: label });
        if (state.format === v) opt.selected = true;
        formatSelect.appendChild(opt);
      });
      formatSelect.addEventListener('change', () => {
        state.format = formatSelect.value;
      });

      const backBtn = App.h('button', { class: 'secondary', text: '構成案からやり直す' });
      backBtn.addEventListener('click', () => renderOutlineScreen());

      const saveBtn = App.h('button', { text: '保存' });
      const errorEl = App.h('div', { class: 'error', hidden: true });

      saveBtn.addEventListener('click', async () => {
        errorEl.hidden = true;

        saveBtn.disabled = true;
        saveBtn.textContent = '保存中…';
        const res = await window.hishoko.docSave({ doc, format: state.format });
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';

        if (!res.ok) {
          if (res.code === 'canceled') return; // キャンセルなら何もしない
          errorEl.textContent = res.message || '保存に失敗しました。';
          errorEl.hidden = false;
          Hishoko.say('trouble', '保存できませんでした');
          return;
        }
        Hishoko.say('smile', '保存しました');
        App.toast('保存しました');
      });

      showScreen(App.h('div', {}, [
        App.h('div', { class: 'card' }, [
          App.h('div', { class: 'field' }, [App.h('label', { text: '資料の題名' }), titleInput]),
          App.h('div', { class: 'field' }, [
            App.h('label', { text: '本文（編集できます）' }),
            sectionsHost,
          ]),
          App.h('div', { class: 'field' }, [
            App.h('label', { text: '出力形式' }),
            formatSelect,
          ]),
          errorEl,
          App.h('div', { class: 'actions' }, [backBtn, saveBtn]),
        ]),
      ]));
    }

    // --- (2') プレゼン: スライド構成案の確認・編集画面 ---
    // レポート等の renderOutlineScreen とは別物（deck形式 { title, subtitle, slides }）。
    // この段階ではAIにbullets/noteの中身を書かせていない（レイアウト・見出しだけ決める）ので、
    // 表示はレイアウト名・見出し・（あれば）中身の要約にとどめ、編集は見出しと並べ替え・削除にする。
    function renderSlideOutlineScreen() {
      const deck = state.outline;

      const titleInput = App.h('input', { type: 'text', value: deck.title || '' });
      titleInput.addEventListener('input', () => { deck.title = titleInput.value; });

      const subtitleInput = App.h('input', { type: 'text', value: deck.subtitle || '' });
      subtitleInput.addEventListener('input', () => { deck.subtitle = subtitleInput.value; });

      const slidesHost = App.h('div', { class: 'outline-sections' });

      function renderSlides() {
        while (slidesHost.firstChild) slidesHost.removeChild(slidesHost.firstChild);
        deck.slides.forEach((s, idx) => {
          const layoutBadge = App.h('span', { class: 'attach-chars', text: slideLayoutLabel(s.layout) });
          const headingInput = App.h('input', { type: 'text', value: s.heading || '' });
          headingInput.addEventListener('input', () => { s.heading = headingInput.value; });

          const contentEl = App.h('div', {
            class: 'status outline-points',
            text: summarizeSlideContent(s),
          });

          const upBtn = App.h('button', { class: 'ghost', text: '↑', disabled: idx === 0 });
          const downBtn = App.h('button', {
            class: 'ghost', text: '↓', disabled: idx === deck.slides.length - 1,
          });
          const removeBtn = App.h('button', { class: 'ghost', text: '削除' });

          upBtn.addEventListener('click', () => {
            if (idx === 0) return;
            const tmp = deck.slides[idx - 1];
            deck.slides[idx - 1] = deck.slides[idx];
            deck.slides[idx] = tmp;
            renderSlides();
          });
          downBtn.addEventListener('click', () => {
            if (idx === deck.slides.length - 1) return;
            const tmp = deck.slides[idx + 1];
            deck.slides[idx + 1] = deck.slides[idx];
            deck.slides[idx] = tmp;
            renderSlides();
          });
          removeBtn.addEventListener('click', () => {
            deck.slides.splice(idx, 1);
            renderSlides();
          });

          slidesHost.appendChild(App.h('div', { class: 'outline-section' }, [
            App.h('div', { class: 'outline-section-row' }, [layoutBadge, headingInput, upBtn, downBtn, removeBtn]),
            contentEl,
          ]));
        });
        if (!deck.slides.length) {
          slidesHost.appendChild(App.h('div', { class: 'status', text: 'スライドがありません。' }));
        }
      }
      renderSlides();

      const backBtn = App.h('button', { class: 'secondary', text: 'やり直す' });
      backBtn.addEventListener('click', () => renderInputScreen());

      const bodyModelSelect = buildModelSelect();
      const bodyBtn = App.h('button', { text: 'この構成で本文を作る' });
      const errorEl = App.h('div', { class: 'error', hidden: true });

      bodyBtn.addEventListener('click', async () => {
        errorEl.hidden = true;
        const okAttachments = state.attachments.filter((a) => a.ok);

        bodyBtn.disabled = true;
        bodyBtn.textContent = '作成中…（数十秒かかります）';
        Hishoko.say('thinking', 'スライドの中身を書いています…');

        const res = await window.hishoko.docBody({
          typeId: state.typeId,
          brief: state.brief,
          sources: okAttachments.map((a) => ({ name: a.name, text: a.text })),
          outline: deck,
          model: bodyModelSelect.value,
        });

        bodyBtn.disabled = false;
        bodyBtn.textContent = 'この構成で本文を作る';

        if (!res.ok) {
          errorEl.textContent = res.message;
          errorEl.hidden = false;
          Hishoko.say('trouble', 'スライドを作れませんでした');
          if (res.code === 'no_key' || res.code === 'auth') App.go('settings');
          return;
        }

        state.doc = res.doc;
        if (!state.doc.title) state.doc.title = deck.title;
        if (!state.doc.subtitle) state.doc.subtitle = deck.subtitle;
        if (res.failed) {
          Hishoko.say('trouble', 'スライドの読み取りに失敗しました。内容を確認して編集してください。');
        } else {
          Hishoko.say('smile', 'スライドができました。確認してください');
        }
        renderSlidePreviewScreen();
      });

      showScreen(App.h('div', {}, [
        App.h('div', { class: 'card' }, [
          App.h('div', { class: 'field' }, [App.h('label', { text: '資料の題名' }), titleInput]),
          App.h('div', { class: 'field' }, [App.h('label', { text: '副題' }), subtitleInput]),
          App.h('div', { class: 'field' }, [
            App.h('label', { text: 'スライド構成（レイアウト・見出しの確認、並べ替え、削除ができます）' }),
            slidesHost,
          ]),
          errorEl,
          App.h('div', { class: 'actions' }, [
            backBtn,
            App.h('div', { class: 'model-inline' }, [App.h('span', { text: 'モデル' }), bodyModelSelect]),
            bodyBtn,
          ]),
        ]),
      ]));
    }

    // --- (3') プレゼン: スライド本文プレビュー・保存画面 ---
    // レイアウトごとに使うフィールドが違う（compareはleft/right、bullets/closingは箇条書き、
    // それ以外はlead）ので、layoutで出す入力欄を出し分ける。noteは常にスピーカーノートとして
    // 編集できるようにする（スライド本体には出さない、という仕様の裏返し）。
    function renderSlidePreviewScreen() {
      const deck = state.doc;

      const titleInput = App.h('input', { type: 'text', value: deck.title || '' });
      titleInput.addEventListener('input', () => { deck.title = titleInput.value; });

      const subtitleInput = App.h('input', { type: 'text', value: deck.subtitle || '' });
      subtitleInput.addEventListener('input', () => { deck.subtitle = subtitleInput.value; });

      const slidesHost = App.h('div', { class: 'doc-sections' });

      function buildCompareSideField(slide, sideKey, label) {
        if (!slide[sideKey] || typeof slide[sideKey] !== 'object') {
          slide[sideKey] = { heading: '', bullets: [] };
        }
        const side = slide[sideKey];
        const sideHeadingInput = App.h('input', { type: 'text', value: side.heading || '' });
        sideHeadingInput.addEventListener('input', () => { side.heading = sideHeadingInput.value; });
        const sideBulletsTextarea = App.h('textarea', {
          class: 'doc-bullets', placeholder: '箇条書き（1行1項目）',
        });
        sideBulletsTextarea.value = (side.bullets || []).join('\n');
        sideBulletsTextarea.addEventListener('input', () => {
          side.bullets = sideBulletsTextarea.value.split('\n').map((t) => t.trim()).filter((t) => t);
        });
        return App.h('div', { class: 'field' }, [
          App.h('label', { text: label }),
          sideHeadingInput,
          sideBulletsTextarea,
        ]);
      }

      function renderSlides() {
        while (slidesHost.firstChild) slidesHost.removeChild(slidesHost.firstChild);
        deck.slides.forEach((s, idx) => {
          const layoutBadge = App.h('span', { class: 'attach-chars', text: slideLayoutLabel(s.layout) });
          const headingInput = App.h('input', { type: 'text', value: s.heading || '' });
          headingInput.addEventListener('input', () => { s.heading = headingInput.value; });

          const fieldsEl = App.h('div', { class: 'row' });

          if (s.layout === 'compare') {
            fieldsEl.appendChild(buildCompareSideField(s, 'left', '左側の見出し・箇条書き'));
            fieldsEl.appendChild(buildCompareSideField(s, 'right', '右側の見出し・箇条書き'));
          } else if (s.layout === 'bullets' || s.layout === 'closing') {
            const bulletsTextarea = App.h('textarea', {
              class: 'doc-bullets', placeholder: '箇条書き（1行1項目・最大5行）',
            });
            bulletsTextarea.value = (s.bullets || []).join('\n');
            bulletsTextarea.addEventListener('input', () => {
              s.bullets = bulletsTextarea.value.split('\n').map((t) => t.trim()).filter((t) => t);
            });
            fieldsEl.appendChild(App.h('div', { class: 'field' }, [
              App.h('label', { text: '箇条書き' }),
              bulletsTextarea,
            ]));
          } else {
            // title / statement / image
            const leadInput = App.h('input', { type: 'text', value: s.lead || '' });
            leadInput.addEventListener('input', () => { s.lead = leadInput.value; });
            const leadLabel = s.layout === 'image' ? '補足（画像の横に出す文）' : '副題・補足';
            fieldsEl.appendChild(App.h('div', { class: 'field' }, [
              App.h('label', { text: leadLabel }),
              leadInput,
            ]));
            if (s.layout === 'image') {
              fieldsEl.appendChild(App.h('div', {
                class: 'status',
                text: s.wantsImage
                  ? '画像を使用します（どの画像を使うかはアプリが自動で割り当てます）'
                  : '画像は使用しません',
              }));
            }
          }

          const noteTextarea = App.h('textarea', {
            class: 'doc-paragraphs', placeholder: 'スピーカーノート（話す内容はここに書きます）',
          });
          noteTextarea.value = s.note || '';
          noteTextarea.addEventListener('input', () => { s.note = noteTextarea.value; });
          fieldsEl.appendChild(App.h('div', { class: 'field' }, [
            App.h('label', { text: 'スピーカーノート' }),
            noteTextarea,
          ]));

          const removeBtn = App.h('button', { class: 'ghost', text: '削除' });
          removeBtn.addEventListener('click', () => {
            deck.slides.splice(idx, 1);
            renderSlides();
          });

          slidesHost.appendChild(App.h('div', { class: 'doc-section' }, [
            App.h('div', { class: 'doc-section-row' }, [layoutBadge, headingInput, removeBtn]),
            fieldsEl,
          ]));
        });
        if (!deck.slides.length) {
          slidesHost.appendChild(App.h('div', { class: 'status', text: 'スライドがありません。' }));
        }
      }
      renderSlides();

      const backBtn = App.h('button', { class: 'secondary', text: '構成案からやり直す' });
      backBtn.addEventListener('click', () => renderSlideOutlineScreen());

      const saveBtn = App.h('button', { text: '保存' });
      const errorEl = App.h('div', { class: 'error', hidden: true });

      saveBtn.addEventListener('click', async () => {
        errorEl.hidden = true;

        saveBtn.disabled = true;
        saveBtn.textContent = '保存中…';
        const res = await window.hishoko.docSave({ doc: deck, format: 'pptx' });
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';

        if (!res.ok) {
          if (res.code === 'canceled') return; // キャンセルなら何もしない
          errorEl.textContent = res.message || '保存に失敗しました。';
          errorEl.hidden = false;
          Hishoko.say('trouble', '保存できませんでした');
          return;
        }
        Hishoko.say('smile', '保存しました');
        App.toast('保存しました');
      });

      showScreen(App.h('div', {}, [
        App.h('div', { class: 'card' }, [
          App.h('div', { class: 'field' }, [App.h('label', { text: '資料の題名' }), titleInput]),
          App.h('div', { class: 'field' }, [App.h('label', { text: '副題' }), subtitleInput]),
          App.h('div', { class: 'field' }, [
            App.h('label', { text: 'スライド（編集できます）' }),
            slidesHost,
          ]),
          App.h('div', { class: 'status', text: '出力形式: PowerPoint' }),
          errorEl,
          App.h('div', { class: 'actions' }, [backBtn, saveBtn]),
        ]),
      ]));
    }

    renderInputScreen();
  },
};
