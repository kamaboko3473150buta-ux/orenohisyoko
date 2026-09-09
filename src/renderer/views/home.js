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
      // 使い方を伝える貴重な一言。ただし「機能を選んでください」だと
      // アプリの説明書きになってしまうので、秘書子が受ける言い方にする。
      { expr: 'smile', text: '調子はいかがですか? 左のサイドバーからご用命ください。' },
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
      let overdueTasks = [];
      try {
        const result = await window.hishoko.taskList();
        dueSoon = result && result.dueSoon;
        // task:list が返すのは { groups, dueSoon }。tasks という名前では返ってこない
        // （ここを tasks と書いていたため、予定があるのに「ありません」と出ていた）。
        // 今日ぶんは groups.today に、期限切れは groups.overdue に入っている。
        // 期限切れは今日の予定に混ぜない。昨日やり残したものが今日の欄に並ぶと、
        // 今日やることが何なのか分からなくなる。下に分けて赤で出す。
        const groups = (result && result.groups) || {};
        todayTasks = groups.today || [];
        overdueTasks = groups.overdue || [];
      } catch {
        // 締切が取れなくても、トップページの表示自体は続ける（時間帯のセリフにする）。
        dueSoon = null;
      }

      const bgName = isDaytime(new Date()) ? 'day' : 'night';

      const scene = App.h('div', { class: 'home-office' });
      // 美容室で選んだ見た目の背景を貼る。無ければ既定の見た目に落ちる。
      // 背景は読み込みの失敗を拾えないので、先に試してから貼る。
      Look.resolveUrl('office', bgName).then((url) => {
        if (url) scene.style.backgroundImage = `url('${url}')`;
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
      // 閉じる（✕）は置かない。2つは左右に離れていて competing しないので、
      // 消す理由は「背景を見たい」くらいしかない。代わりに**クリックで見出しだけの
      // 小さい形に切り替える**。もう一度クリックすると戻る。
      // 中身は消えないので、閉じて聞き直す（＝もう一度課金される）ことが起きない。
      function makePanel(kind, side, heading) {
        const body = App.h('p', {});
        const panel = App.h('div', {
          class: `home-panel ${side}`,
          title: 'クリックで大きさが変わります',
          onclick: () => {
            // 中の文をなぞって選んだだけのときは、切り替えない
            const picked = window.getSelection && window.getSelection().toString();
            if (picked) return;
            Today.toggleCollapsed(kind);
            paintPanel(kind);
          },
        }, [
          App.h('div', { class: 'home-panel-body' }, [App.h('h3', { text: heading }), body]),
        ]);
        panel.hidden = true;
        return { panel, body };
      }

      const panels = {
        plan: makePanel('plan', 'left', '今日の予定'),
        news: makePanel('news', 'right', '今日のニュース'),
      };

      // 期限を過ぎたぶんの見出し。この行から次の空行までを赤で出す。
      // 札の中身は1つの文字列として Today に持たせているので（画面を移っても
      // 残すため）、色を変える範囲はこの目印で切り出す。
      const OVERDUE_HEADING = '⚠ 期限を過ぎている予定';

      // 箇条書きの1行から、その予定を引くための対応表。
      // 行の文字列はこちらで組み立てているので（AIは通さない）、完全一致で引ける。
      // 行程表を持つ予定だけを入れる。
      const bulletToTask = new Map();

      // 1行ずつ描く。
      // - 「⚠ 期限を過ぎている予定」の見出しから次の空行までは赤
      // - 行程表を持つ予定の行は、押すとスケジュール管理のその行程表へ飛ぶ
      function paintPlanBody(body, text) {
        body.textContent = '';
        let inOverdue = false;
        String(text).split('\n').forEach((line, i) => {
          if (i > 0) body.appendChild(document.createTextNode('\n'));
          if (line.startsWith(OVERDUE_HEADING)) inOverdue = true;
          else if (line.trim() === '') inOverdue = false;

          const task = bulletToTask.get(line);
          const node = task
            ? App.h('a', {
              class: 'plan-link',
              href: '#',
              title: `行程表を開く: ${task.title}`,
              text: line,
              onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();   // 札の開閉まで動かさない
                App.go('tasks', { planId: task.id });
              },
            })
            : document.createTextNode(line);

          if (!inOverdue) { body.appendChild(node); return; }
          body.appendChild(App.h('span', { class: 'home-overdue' }, [node]));
        });
      }

      // ニュースは行ごとに配信元へのリンクにする。
      //
      // AIが各行の先頭に付けた番号（[3]）で元の見出しを引く。見出しの文字列で
      // 照合すると、AIが言い換えた瞬間に外れる（要約なので必ず言い換える）。
      // 番号が無い行・リンクが取れない行は、ただの文字として出す。
      function paintNewsBody(body, text) {
        body.textContent = '';
        const articles = Today.getNewsArticles();
        NewsLines.parseLines(text).forEach((line, i) => {
          if (i > 0) body.appendChild(document.createTextNode('\n'));
          const url = NewsLines.linkFor(articles, line.n);
          if (!url) { body.appendChild(document.createTextNode(line.text)); return; }
          body.appendChild(App.h('a', {
            class: 'news-link',
            href: '#',
            title: `配信元を開く: ${url}`,
            text: line.text,
            onclick: (e) => {
              e.preventDefault();
              // 札のクリック（大きさの切り替え）まで動いてしまわないように止める
              e.stopPropagation();
              window.hishoko.newsOpen(url);
            },
          }));
        });
      }

      function paintPanel(kind) {
        const { panel, body } = panels[kind];
        const text = Today.get(kind);
        if (kind === 'plan') paintPlanBody(body, text);
        else if (kind === 'news') paintNewsBody(body, text);
        else body.textContent = text;
        panel.hidden = !text;
        panel.classList.toggle('is-collapsed', Today.isCollapsed(kind));
      }

      function bullets(list) {
        return list
          .map((t) => {
            const line = t.at ? `・${t.at} ${t.title}` : `・${t.title}`;
            // 行程表を持つ予定は、この行を押して行程表を開けるようにする
            if (t.plan) bulletToTask.set(line, t);
            return line;
          })
          .join('\n');
      }

      // 今日の予定。予定の箇条書きと、AIの進め方をひとつにまとめて出す。
      // 箇条書きはアプリの中で数えるだけ（無料）で、AIに渡すのは進め方の相談だけ。
      //
      // 期限を過ぎたものは今日ぶんの下に、別の見出しを付けて出す。
      // 混ぜてしまうと、今日やることが何なのか分からなくなる。
      function listToday() {
        const today = todayTasks.length === 0
          ? '今日の予定はありません。'
          : bullets(todayTasks);
        if (overdueTasks.length === 0) return today;
        return `${today}\n\n${OVERDUE_HEADING}\n${bullets(overdueTasks)}`;
      }

      async function loadPlan() {
        // 押し直したときは、小さくしてあっても開いて見せる
        Today.setCollapsed('plan', false);
        Today.set('plan', `${listToday()}\n\n考えています…`);
        paintPanel('plan');
        // 成功でも失敗でも本文は message に入る（tasks-feature/index.js）
        const res = await window.hishoko.taskBrief({});
        const advice = res.message || 'うまく答えられませんでした。';
        Today.set('plan', `${listToday()}\n\n${advice}`);
        paintPanel('plan');
      }

      async function loadNews() {
        Today.setCollapsed('news', false);
        Today.set('news', '集めています…');
        paintPanel('news');
        const res = await window.hishoko.newsToday({});
        // 見出しの一覧は本文と一緒に持たせる。行の番号から配信元を開くのに使う。
        Today.setNewsArticles(res.articles);
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

      // 箇条書きと予定の対応表を作っておく。画面を移って戻ったときは札の中身が
      // Today に残っていて loadPlan を通らないので、ここで作らないとリンクだけ死ぬ。
      // タスクを数えるだけなのでAIは呼ばれない（無料）。
      listToday();

      paintPanel('plan');
      paintPanel('news');
      applyLine(pickLine(linePool(dueSoon, new Date()), null));
    },
  };
}());
