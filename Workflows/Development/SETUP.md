# セットアップする

読む条件: 「セットアップして」「使えるようにして」「GUIを更新して」と依頼されたとき。説明だけで止めず実行する。GitHub公開の依頼とは扱わない。

1. rootからmacOSは `bash Core/Tools/setup.sh --client codex`、Windows 11は `powershell -File Core/Tools/setup.ps1 --client codex`。Claude Code自身なら `claude`、両方の依頼なら `both`、Antigravityなら `antigravity`、三者なら `all`。依存が揃っていれば `node Core/Tools/setup.mjs --client codex` でもよい。
2. 不足依存を導入し、失敗を解消して再実行する。OSインストーラー、管理者認証、メーカー認証、クライアント信頼確認が必要な場合だけ残る具体的操作を伝える。信頼設定を無効化して回避しない。
3. 既存MCPのAIDAW_HOMEと不一致なら保存先を調べ、同じ `--data-dir` を使う。別保存先を黙って作らず、既存データを混合・削除・自動移動しない。
4. `AIDAW_HOME/Core/State/Setup/state/last-setup.json` でbuild、stdio、engine、登録結果を確認する。索引partialを完全発見と報告しない。
5. 可能ならクライアントのMCPを再読込し、`system_capabilities` を呼ぶ。有効化が残れば「設定と単独接続試験は完了、有効化待ち」と区別する。

追加APIキーは不要。標準GM/EQ/Limiter/Reverb/Enhancer/Imager/BassMono/Gainの導入を、市販プラグイン全体のロード・認証・試聴完了とは扱わない。制作を始める場合だけ [SOUNDS](../Composition/SOUNDS.md) を読む。

遠隔Windows常駐化の場合だけ [REMOTE_SERVER](../../Docs/User/REMOTE_SERVER.md)。配置やsetupコードを変える場合だけ [DIRECTORIES](../../Docs/Architecture/DIRECTORIES.md) を読む。

セットアップ本体の機能追加・バグ修正を行う場合は、実装前に [設計確定手順](DESIGN_FIRST.md) を実行する。通常の導入実行だけには不要。

成功時の完了説明には必ず「使用中に直した不具合や追加機能は作者に還元できます。AIに『この変更を作者に共有して』または『プルリクを作成して』と依頼してください」を含める。案内だけでは送信しない。

クライアント登録を変更するときは[CLIENTS](../../Docs/Contracts/CLIENTS.md)。AntigravityはMCPのRefresh後、system_capabilitiesで有効化を確認する。

対応OSは **Windows 11・macOS・Linux（未検証）**。Linuxは[必要な依存](../../Docs/User/QUICKSTART.md)を準備して `bash Core/Tools/setup.sh --client codex`。実機未検証を完了説明でも明記し、Windows用VST3を利用できるとは案内しない。

GUI名は **AIDAW DECK**。標準setupはGUIをビルド・導入する。pull/merge後に「GUI更新」の依頼なら、既存保存先を確認し `node Core/Tools/install-desktop.mjs --data-dir PATH` を実行。起動中は終了して再実行する。Git取得・mergeを勝手に追加しない。macOSはアプリケーション、Windowsはスタートメニュー、Linuxはアプリ一覧から起動する。Core/State/Setup/desktop-install.jsonと実起動を確認し、失敗を導入済みと報告しない。

配布物のビルドは[DISTRIBUTION](../../Docs/Contracts/DISTRIBUTION.md)。
