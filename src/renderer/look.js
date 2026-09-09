// src/renderer/look.js
// 秘書子の見た目（髪型・髪色）を画面のあちこちから使えるようにする。
//
// 絵の出る場所は3か所ある（丸枠・トップページの背景・息抜きの卓）。
// それぞれが設定を読みに行くと、美容室で変えたときに一部だけ古いままになる。
// ここに1つ持たせて、変えたら全部が同じものを見るようにする。
window.Look = (function () {
  const DEFAULT_FOLDER = 'bob';

  // 拡張子は画像によって違う（今の丸枠は .png、新しく作ったものは .jpg）。
  // 作った人に「拡張子をそろえてから入れてください」と強いるのは筋が悪いので、
  // .jpg から順に試して、だめなら .png、それでもだめなら既定の見た目に落とす。
  const EXTENSIONS = ['jpg', 'png'];

  let folder = DEFAULT_FOLDER;
  // 息抜きの卓の置き方（scripts/measure-scene.js の採寸結果）。
  // 見た目ごとに頭の位置が違うので、共通の値だとどれかの髪型で頭が切れる。
  let framing = {};

  // 画像を読み込む。無ければ次の候補、最後は既定の見た目にたどり着く。
  //
  // 見た目を1つ足すのに12枚の絵が要る。1枚足りないだけでその見た目が
  // 使いものにならないと、少しずつ作っていけない。
  function setImage(img, dir, name) {
    const tries = [];
    for (const ext of EXTENSIONS) tries.push(`../../assets/${dir}/${folder}/${name}.${ext}`);
    if (folder !== DEFAULT_FOLDER) {
      for (const ext of EXTENSIONS) tries.push(`../../assets/${dir}/${DEFAULT_FOLDER}/${name}.${ext}`);
    }

    let i = 0;
    function next() {
      if (i >= tries.length) { img.style.display = 'none'; return; }
      const url = tries[i];
      i += 1;
      img.src = url;
    }
    img.onerror = next;
    img.style.display = '';
    next();
  }

  // 背景（CSSのbackground-image）は読み込みの失敗を拾えないので、
  // 先に Image で試してから貼る。
  function resolveUrl(dir, name, ext = 'jpg') {
    return new Promise((resolve) => {
      const tries = [`../../assets/${dir}/${folder}/${name}.${ext}`];
      if (folder !== DEFAULT_FOLDER) tries.push(`../../assets/${dir}/${DEFAULT_FOLDER}/${name}.${ext}`);
      let i = 0;
      const probe = new Image();
      probe.onload = () => resolve(tries[i - 1]);
      probe.onerror = () => { if (i < tries.length) probe.src = tries[i++]; else resolve(''); };
      probe.src = tries[i++];
    });
  }

  return {
    DEFAULT_FOLDER,
    folder: () => folder,
    // 設定から読んだ見た目を覚える。髪色が既定ならフォルダ名は髪型だけ
    // （main側の folderFor と同じ決まり。ここを変えるなら両方直すこと）。
    set(appearance) {
      const a = appearance || {};
      const style = a.hairStyle || DEFAULT_FOLDER;
      folder = (!a.hairColor || a.hairColor === 'brown') ? style : `${style}-${a.hairColor}`;
      return folder;
    },
    // 見本を描くときだけ一時的に切り替えて、すぐ元に戻すために使う。
    setFolder(name) { folder = name || DEFAULT_FOLDER; return folder; },
    setFraming(all) { framing = (all && typeof all === 'object') ? all : {}; },
    // その見た目・その場面の置き方。無ければ null（CSSの既定のまま）。
    framing(mood) {
      const forLook = framing[folder];
      return (forLook && forLook[mood]) || null;
    },
    setImage,
    resolveUrl,
  };
}());
