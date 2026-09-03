# 俺の秘書子

汎用的な業務能率化のためのWindowsデスクトップアプリ。

## 機能

- **メール文面作成**: 場面（御礼・謝罪・日程調整など）と宛先・件名・一言メモを入れると、
  Claude API がビジネスメールの文面を作成し、Outlook または Gmail の下書きとして開きます。
  送信はしません（送信操作は必ず人が行います）。
- **作成した文面の履歴**: 過去に作ったメールを見返し、そのまま下書きとして開けます。

## 必要なもの

- Windows 10 / 11
- Claude API キー（https://console.anthropic.com/ で取得）
- Outlook 連携を使う場合: Outlook classic デスクトップ版

## 開発

```bash
npm install
```

```bash
npm start
```

```bash
npm test
```

```bash
npm run build
```

## 注意

- 生成された文面は必ず自分で確認してから送信してください。AI が事実を取り違えることがあります。
- API キーはこの PC のユーザープロファイル（`%APPDATA%\ore-no-hishoko\settings.json`）に
  暗号化して保存されます。リポジトリにも exe にも含まれません。
- 設定・履歴は起動した PC ごとに保存されます。exe を配っても中身は引き継がれません。

## ドキュメント

- [設計書](docs/設計書.md)
- [実装計画](docs/実装計画.md)
