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

  // 締切がある日はそれを優先して伝える。無ければ時間帯のセリフ候補を返す。
  function linePool(dueSoon, now) {
    const overdue = (dueSoon && dueSoon.overdue) || 0;
    const todayCount = (dueSoon && dueSoon.today) || 0;
    if (overdue > 0) {
      return [
        { expr: 'hurry', text: `期限切れが${overdue}件あります。今日中の締切は${todayCount}件です。` },
        { expr: 'hurry', text: `${overdue}件、期限を過ぎています。先に片付けましょう。` },
        { expr: 'trouble', text: `期限切れが${overdue}件…早めに確認しておきましょう。` },
      ];
    }
    if (todayCount > 0) {
      return [
        { expr: 'normal', text: `今日締切のタスクが${todayCount}件あります。` },
        { expr: 'normal', text: `今日中に${todayCount}件、片付けるものがありますね。` },
        { expr: 'smile', text: `今日が締切のものが${todayCount}件。順番に進めましょう。` },
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
      try {
        const result = await window.hishoko.taskList();
        dueSoon = result && result.dueSoon;
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

      let current = null;
      function applyLine(line) {
        current = line;
        bubbleText.textContent = line.text;
      }

      bubble.addEventListener('click', () => {
        const pool = linePool(dueSoon, new Date());
        applyLine(pickLine(pool, current && current.text));
      });

      scene.appendChild(bubble);
      root.appendChild(scene);

      applyLine(pickLine(linePool(dueSoon, new Date()), null));
    },
  };
}());
