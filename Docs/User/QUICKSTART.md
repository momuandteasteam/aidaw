# AIDAWを使い始める

AIDAWは、Codex／Claude Code／Antigravityへの指示で編集し、GUIで再生・試聴・読込・書き出しを行うDAWです。

repository rootでセットアップします。追加APIキーは不要です。

```sh
# macOS / Codex
bash Core/Tools/setup.sh --client codex
```

```powershell
# Windows 11 / Codex
powershell -File Core/Tools/setup.ps1 --client codex
```

Claude Codeだけなら `--client claude`、両方なら `--client both`。既存設定と保存先が違うと表示された場合は、既存の場所を `--data-dir` で指定してください。通常の保存先はrepository rootです。

セットアップ後はクライアントのMCPを再読込します。再起動・信頼確認が求められた場合は完了してから、AIに `system_capabilities` の確認を依頼してください。設定完了と接続有効化は別の状態です。

```sh
npm --prefix Core run player
```

GUIのファイルメニューからProjects内の作品を開くか、`.aidaw.zip` をインポートします。読み込んだ対象はAIと共有されます。新規制作はAIへ「曲制作」「マスタリング」の用途と希望を伝えます。標準音源・FXを導入しますが、市販音源の認証や全プリセットの試聴を自動で完了するものではありません。

作業正本は `Projects/<project_id>/`、持ち出しは `.aidaw.zip`。音声ファイルの書き出しとは区別します。

次に必要なものだけ読む:
- 再生・A/B・書き出し: [PLAYBACK](PLAYBACK.md)
- 別PCから接続: [REMOTE_SERVER](REMOTE_SERVER.md)
- セットアップをAIに実行させる: [SETUP](../../Workflows/Development/SETUP.md)
- フォルダの役割: [DIRECTORIES](../Architecture/DIRECTORIES.md)

ステム分離も通常setupで導入します。既存環境へ追加する場合はuvを準備して `node Core/Tools/setup-separation.mjs` を実行してください。ファイルメニューの新規作成で「ステム分離」を選びます。

DemucsとHTDemucsモデルもsetup時に外部取得します。既存環境へDemucsだけ追加する場合は `node Core/Tools/setup-demucs.mjs`。モデルの利用条件は[分離契約](../Contracts/SEPARATION.md)を確認してください。

Antigravityの場合は `bash Core/Tools/setup.sh --client antigravity`（Windows 11はsetup.ps1へ同じ引数）。三者へ設定する場合は `--client all`。Antigravityでこのフォルダを開き、MCP設定をRefreshしてください。ルールの有効化もCustomizationsで確認します。

## Linux（未検証）

対応OSはWindows 11・macOS・Linux（未検証）です。Linuxはソースからの導入用で、実機動作と配布パッケージは未検証です。

Node 22.13以上、uv、CMake、C++コンパイラ、pkg-config、FFmpeg/ffprobeを事前に準備し、`bash Core/Tools/setup.sh --client codex` を実行してください。ディストリビューションに応じてALSA/JACK、FreeType、X11関連の開発ライブラリ、Electron用GTK/NSS/GBMなども必要です。足りないライブラリはビルド・起動時のエラーに従って導入します。Audio UnitsはmacOS専用で、VST3もLinux用バイナリが必要です。
