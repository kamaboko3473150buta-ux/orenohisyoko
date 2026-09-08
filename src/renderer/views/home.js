// src/renderer/views/home.js
// トップページ。オフィスの背景（秘書子が立っている絵）を画面いっぱいに敷き、
// 頭の上あたりに吹き出しを出す。機能はここではなく左のサイドバーから入る。
//
// 背景・吹き出しの画像が読み込めなくても、吹き出しの文言と操作自体は生きたままにする
// （<img>のerrorイベントで静かに諦めるだけで、画面全体は壊さない）。
window.Views = window.Views || {};

(function () {
  // PCの時刻で背景を切り替える。6:00〜17:59は昼、18:00〜5:59は夜。
  function isDaytime(now) {
    const h = now.getHours();
    return h >= 6 && h < 18;
  }

  // セリフの時間帯は昼をさらに「朝」と「昼」に分け、3種類の空気を出す。
  function timeSlot(now) {
    const h = now.getHours();
    if (h >= 6 && h < 11) return 'morning';
    if (h >= 11 && h < 18) return 'day';
    return 'night';
  }

  // 時間帯ごとのセリフ候補。候補から毎回ランダムに選び、同じ一言が続かないようにする。
  const TIME_GREETINGS = {
    morning: [
      { expr: 'normal', text: 'おはようございます。今日の予定を確認しますか?' },
      { expr: 'smile', text: 'おはようございます。今日も一日、よろしくお願いします。' },
      { expr: 'normal', text: 'おはようございます。まずは何から始めましょうか。' },
    ],
    day: [
      { expr: 'normal', text: 'お疲れさまです。何かお手伝いできることはありますか?' },
      { expr: 'smile', text: '調子はいかがですか? サイドバーから機能を選んでくださいね。' },
      { expr: 'normal', text: '何かご用でしたら、お気軽にどうぞ。' },
    ],
    night: [
      { expr: 'trouble', text: '遅くまでお疲れさまです。無理はなさらず。' },
      { expr: 'normal', text: '夜遅くまでお疲れさまです。キリの良いところで休憩もどうぞ。' },
      { expr: 'smile', text: 'こんばんは。今日も一日、お疲れさまでした。' },
    ],
  };

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  // 頭の上の吹き出しの2行目。時間帯のあいさつだけにする。
  //
  // 以前はここに締切の件数を出していたが、「今日の予定」と内容がかぶって
  // 意味をなさなくなったのでやめた。締切はそちらで、件数ではなく中身まで見られる。
  // 期限切れがあるときだけ、一言だけ添える（件数は言わない）。
  function linePool(dueSoon, now) {
    const overdue = (dueSoon && dueSoon.overdue) || 0;
    if (overdue > 0) {
      return [
        { expr: 'hurry', text: '期限を過ぎているものがあります。' },
        { expr: 'trouble', text: '期限切れのものが残っています。' },
      ];
    }
    return TIME_GREETINGS[timeSlot(now)];
  }

  // 候補が2つ以上あるときは、直前と同じ文にならないようにする。
  function pickLine(pool, avoidText) {
    if (pool.length <= 1) return pool[0];
    let candidate = pick(pool);
    let guard = 0;
    while (candidate.text === avoidText && guard < 8) {
      candidate = pick(pool);
      guard += 1;
    }
    return candidate;
  }

  Views.home = {
    async render(root) {
      App.setTitle('俺の秘書子');

      let dueSoon = null;
      let todayTasks = [];
      try {
        const result = await window.hishoko.taskList();
        dueSoon = result && result.dueSoon;
        // task:list が返すのは { groups, dueSoon }。tasks という名前では返ってこない
        // （ここを tasks と書いていたため、予定があるのに「ありません」と出ていた）。
        // 今日ぶんは groups.today に、期限切れは groups.overdue に入っている。
        const groups = (result && result.groups) || {};
        todayTasks = (groups.overdue || []).concat(groups.today || []);
      } catch {
        // 締切が取れなくても、トップページの表示自体は続ける（時間帯のセリフにする）。
        dueSoon = null;
      }

      const bgFile = isDaytime(new Date()) ? 'day.jpg' : 'night.jpg';

      const scene = App.h('div', {
        class: 'home-office',
        // index.html（src/renderer/）から見て assets/ はリポジトリ直下にある。hishoko.jsと同じ書き方。
        style: `background-image:url('../../assets/office/${bgFile}')`,
      });

      const bubbleText = App.h('p', {});
      const bubble = App.h('div', {
        class: 'home-bubble',
        title: 'クリックで一言が変わります',
      });

      // トップページには丸枠の秘書子を出さない。背景に本人が立っているので、
      // 小さな顔をもう一つ添えると二重になる。表情はセリフの選び方で伝える。
      bubble.appendChild(bubbleText);

      // 頭の上の吹き出しは常に出ているので、閉じられない情報＝今日の天気を置く。
      // 締切の件数はここに出していたが、「今日の予定」と内容がかぶるのでやめた。
      // 天気にAIは使わない（値をそのまま日本語にするだけ）ので費用はかからない。
      const weatherLine = App.h('span', { class: 'home-weather' });
      const greetLine = App.h('span', { class: 'home-greet' });
      bubbleText.appendChild(weatherLine);
      bubbleText.appendChild(greetLine);

      let current = null;
      function applyLine(line) {
        current = line;
        greetLine.textContent = line.text;
      }

      // 1日1回だけ取りに行く。日付が変わっていればメインプロセス側が取り直す
      // （アプリを起動していなければ、起動後に初めて見たときが取り直しの時）。
      //
      // 日付・曜日と、どこの天気かは吹き出しに入れない。2行になって秘書子の顔に
      // かぶるため。マウスを乗せたときの説明に回す。
      (async () => {
        weatherLine.textContent = '天気を調べています…';
        try {
          const res = await window.hishoko.weatherToday({});
          weatherLine.textContent = res.text || '';
          const where = res.spot ? `${res.spot}の天気` : '';
          bubble.title = [res.date, where, 'クリックで一言が変わります']
            .filter(Boolean).join('　');
        } catch {
          weatherLine.textContent = '';   // 取れなくても、あいさつだけは出す
        }
      })();

      bubble.addEventListener('click', () => {
        const pool = linePool(dueSoon, new Date());
        applyLine(pickLine(pool, current && current.text));
      });

      // 秘書子の顔の左右に置く2つの札。片方を出しても、もう片方は消えない。
      // 中身は Today に持たせてあるので、画面を移って戻ってきても残る
      // （聞き直すたびにAPI費用がかかるため）。日付が変わったら捨てられる。
      function makePanel(kind, side, heading) {
        const body = App.h('p', {});
        const panel = App.h('div', { class: `home-panel ${side}` }, [
          App.h('button', {
            class: 'home-panel-close', type: 'button', text: '✕', title: '閉じる',
            onclick: () => { Today.clear(kind); paintPanel(kind); },
          }),
          App.h('div', { class: 'home-panel-body' }, [App.h('h3', { text: heading }), body]),
        ]);
        panel.hidden = true;
        return { panel, body };
      }

      const panels = {
        plan: makePanel('plan', 'left', '今日の予定'),
        news: makePanel('news', 'right', '今日のニュース'),
      };

      function paintPanel(kind) {
        const { panel, body } = panels[kind];
        const text = Today.get(kind);
        body.textContent = text;
        panel.hidden = !text;
      }

      // 今日の予定。予定の箇条書きと、AIの進め方をひとつにまとめて出す。
      // 箇条書きはアプリの中で数えるだけ（無料）で、AIに渡すのは進め方の相談だけ。
      function listToday() {
        if (todayTasks.length === 0) return '今日の予定はありません。';
        return todayTasks
          .map((t) => (t.at ? `・${t.at} ${t.title}` : `・${t.title}`))
          .join('\n');
      }

      async function loadPlan() {
        Today.set('plan', `${listToday()}\n\n考えています…`);
        paintPanel('plan');
        // 成功でも失敗でも本文は message に入る（tasks-feature/index.js）
        const res = await window.hishoko.taskBrief({});
        const advice = res.message || 'うまく答えられませんでした。';
        Today.set('plan', `${listToday()}\n\n${advice}`);
        paintPanel('plan');
      }

      async function loadNews() {
        Today.set('news', '集めています…');
        paintPanel('news');
        const res = await window.hishoko.newsToday({});
        Today.set('news', res.message || 'ニュースを取得できませんでした。');
        paintPanel('news');
      }

      // ボタンは絵の中ではなく上部バーに置く（絵の上だと邪魔になる）。
      // 画面ごとに作り直されるので、押したときの動きだけを毎回つなぎ直す。
      function wire(id, run) {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.onclick = async () => {
          btn.disabled = true;
          try { await run(); } finally { btn.disabled = false; }
        };
      }
      wire('todayPlanBtn', loadPlan);
      wire('todayNewsBtn', loadNews);

      scene.appendChild(bubble);
      scene.appendChild(panels.plan.panel);
      scene.appendChild(panels.news.panel);
      root.appendChild(scene);

      paintPanel('plan');
      paintPanel('news');
      applyLine(pickLine(linePool(dueSoon, new Date()), null));
    },
  };
}());
