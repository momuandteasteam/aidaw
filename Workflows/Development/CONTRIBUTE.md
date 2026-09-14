# 変更を作者へ還元する

読む条件: 「この変更を作者に共有して」「プルリクを作成して」など、実装変更の送信を明示的に依頼されたとき。
正本範囲: Gitの知識を前提にしない、AIによるfork・PR作成手順。

1. git status、diff、remote、現在のbranchを読み、今回の変更だけを特定する。共有の依頼はPR送信までの許可として扱い、同じ確認を繰り返さない。対象が曖昧で他の作業と分けられない場合だけ対象を質問する。案内表示や通常の制作・セットアップだけでは送信しない。
2. 設計文書・テスト・ライセンスを確認する。製品変更は [設計確定手順](DESIGN_FIRST.md) に従う。実装済み変更の共有時に過去の設計先行を捏造しない。必要なら現在の仕様と不足検証を整理して明記する。
3. 共有対象は本体・拡張source・設計・テストのみ。Projects、作品ZIP、音声、音源binary、モデル重み、Coreの設定/状態/cache/build、認証情報、個人機器設定を含めない。`npm --prefix Core run check:public` と対象試験を実行し、差分を目視確認する。`git add .` や `git add -A` で未確認ファイルを集めない。
4. ghがなければ導入し、`gh auth status` で確認する。未ログインならユーザーにGitHubのブラウザ認証だけを案内する。tokenを会話・ファイル・コマンド引数へ記録しない。
5. upstreamは本repoの公式URL `https://github.com/momuandteasteam/aidaw`。送信先・既存remoteを照合する。元のbranchやremoteを破壊せず、`codex/` branchと利用者のforkを使う。他の作業が混在するときは隔離worktreeで対象差分を再現し、元の未コミット変更を消さない。force push、reset --hard、既存branchの上書きをしない。
6. 対象ファイルを明示してcommitし、forkのbranchへpushする。既存PRがあれば同じPRを更新し、重複作成しない。`gh pr create --repo momuandteasteam/aidaw --draft` でPRを作成する。headは確認したfork ownerとbranch、baseは確認した公式default branchを使う。本文は一時ファイルを作り `--body-file` で渡す。
7. PRには問題・変更後の動作・設計文書・試験結果・未確認範囲を記す。完成したPRのURLを返し、作者のreview待ちと伝える。送信失敗ならローカル準備と未送信を区別する。自動mergeしない。

必要なGit操作はAIが担当する。ユーザーへbranch名・Git用語の学習を前提とした手順を投げ返さない。GitHub認証が必要な場合も、送れる差分と説明を先に準備する。

## スキャン結果を共有する場合

[共有契約](../../Docs/Contracts/CATALOG_CONTRIBUTION.md)を読む。「スキャン結果を作者に共有して」でこの経路へ進む。catalog_searchで対象を絞り、未指定なら共有する製品を利用者に確認する。catalog_contribution_prepareへplugin_idsを渡す。未索引ならeffect_indexで対象だけを索引する。出力JSONの名称も確認し、製品名・版が公開されることを説明する。

ビルド後、各出力に `node Core/Tools/catalog-contribution.mjs accept <JSONパス>` を実行する。共有対象として例外的に許可するのは生成されたLibraries/Catalog/ContributionsのJSONだけ。公開検査と `node --test Core/Tests/catalog-contribution.test.mjs` を実行し、上のfork・draft PR手順で対象JSONだけを送る。既存の開発変更を混ぜず、必要なら隔離worktreeを使う。DBやportable catalog全体を送らない。
