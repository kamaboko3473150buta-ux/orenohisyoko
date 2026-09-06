// src/renderer/views/menu.js
window.Views = window.Views || {};

// 起動時（＝このメニューを開いたとき）に、期限切れ・今日締切の件数を秘書子の吹き出しで伝える。
// タスクが1件も無くても、通信に失敗しても、メニュー自体の表示は止めない。
function announceDueSoon(dueSoon) {
  const overdue = (dueSoon && dueSoon.overdue) || 0;
  const todayCount = (dueSoon && dueSoon.today) || 0;
  if (overdue > 0) {
    Hishoko.say('hurry', `期限切れが${overdue}件あります。今日中の締切は${todayCount}件です。`);
  } else if (todayCount > 0) {
    Hishoko.say('normal', `今日締切のタスクが${todayCount}件あります。`);
  } else {
    Hishoko.say('normal', '今日締切のタスクはありません。');
  }
}

Views.menu = {
  async render(root) {
    App.setTitle('仕事を頼む');
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('mailmenu') }, [
      App.h('h2', { text: '✉ メール文面作成' }),
      App.h('p', { text: '新規メールの作成・返信文の作成・作成した文面の履歴はこちらから' }),
    ]));
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('tasks') }, [
      App.h('h2', { text: '🗂 タスク・スケジュール管理' }),
      App.h('p', { text: '予定とやることを1つにまとめ、今日やるべきことを案内します' }),
    ]));
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('docgen') }, [
      App.h('h2', { text: '📄 資料作成' }),
      App.h('p', { text: 'プレゼン・レポート・議事録などを構成案から仕上げ、Word/PDFで書き出します' }),
    ]));
    root.appendChild(App.h('div', { class: 'card clickable', onclick: () => App.go('translate') }, [
      App.h('h2', { text: '🌐 言語翻訳' }),
      App.h('p', { text: 'Word文書の書式を保ったまま、段落の下に訳文を追加した文書を作ります' }),
    ]));
    root.appendChild(App.h('div', { class: 'card' }, [
      App.h('h2', { text: '＋ 今後の機能' }),
      App.h('p', { text: '新しい機能はここに追加されます' }),
    ]));

    try {
      const { dueSoon } = await window.hishoko.taskList();
      announceDueSoon(dueSoon);
    } catch {
      // 締切の知らせが出せなくても、メニュー表示自体は継続する
    }
  },
};
