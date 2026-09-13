# 開発参加

読む条件: 開発環境の準備、パッチ提出、依存関係の更新。
正本範囲: 開発コマンドと提出手順。仕様は[実装入口](../../Workflows/Development/IMPLEMENTATION.md)から選ぶ。

## 環境とコマンド

repository rootで実行する。Nodeの対応版と依存は[Core/package.json](../../Core/package.json)を正とし、依存をrootへインストールしない。

```sh
npm ci --prefix Core
npm --prefix Core run build
npm --prefix Core test
npm --prefix Core run player
npm --prefix Core run check:layout
npm --prefix Core run check:docs
npm --prefix Core run check:public
```

ネイティブ音声の準備は[セットアップ](../../Workflows/Development/SETUP.md)。確認範囲は[検証](VERIFICATION.md)で選び、メタデータの検査と実音の検査を区別する。

## 変更の提出

- 最初に[設計確定手順](../../Workflows/Development/DESIGN_FIRST.md)を実行し、所有文書を更新・確定してから製品コードへ進む。
- 再現条件、期待動作、必要な検証を揃える。変更していない領域の規約を複製しない。
- PRには問題、結果、実行した検証、未確認範囲を記す。過去の作業経過や放棄した案を現行仕様へ残さない。
- 依存版を変える場合はlockfile、ライセンス、導入と再現試験を更新する。
- 作品・個人設定・商用プラグインをGitへ含めない。公開範囲は[ライセンス案内](../User/OPEN_SOURCE.md)。

## Gitが初めての方へ

AIに「この変更を作者に共有して」または「プルリクを作成して」と依頼してください。[還元手順](../../Workflows/Development/CONTRIBUTE.md)に従い、AIが共有する変更を確認し、GitHubへの提出まで進めます。初回はGitHubへのログインを求められる場合があります。作品や個人設定は共有しません。
