# クローン後の自動セットアップ

Codex / Claude Codeに次のように依頼する。

> このGitHubリポジトリをクローンして、AIDAWをセットアップしてください。クローン先のAGENTS.md（Claude CodeではCLAUDE.md）に従い、ビルド、MCP登録、接続確認まで進めてください。

リポジトリURLは実際の公開先を添える。この機能を実装しただけではGitHubへの公開は行われない。

## エージェントの入口

- Codex：ルート `AGENTS.md` の「クローン後の自動セットアップ」。
- Claude Code：ルート `CLAUDE.md` が同じ規約をimportする。
- クローン前の会話ではリポジトリ内の指示がまだ読み込まれていないことがあるため、クローン先の規約も読むよう依頼文に含める。

公式仕様：[CodexのプロジェクトMCP設定](https://developers.openai.com/codex/mcp/)、[Claude CodeのMCP設定](https://code.claude.com/docs/en/mcp)、[CLAUDE.mdからAGENTS.mdを読み込む](https://code.claude.com/docs/en/memory#agentsmd)。

## 実行コマンド

macOS（必要なNode / CMake / FFmpegを既存Homebrewで補う）：

```sh
bash scripts/setup.sh --client codex
# Claude Codeで実行するとき：
bash scripts/setup.sh --client claude
```

Windows（不足ツールをwingetで補う）：

```powershell
powershell -File scripts/setup.ps1 --client codex
# Claude Codeで実行するとき：
powershell -File scripts/setup.ps1 --client claude
```

依存ツールが既にある場合、両OS共通：

```sh
node scripts/setup.mjs --client both
# または
npm run setup -- --client both
```

`--client` は `codex` / `claude` / `both` / `none`。省略時は両方。`none` はクライアント登録だけ省略する検証用途。

## 自動で行うこと

1. Node 22.13以降、CMake、FFmpeg/ffprobe、macOSのC++環境を確認。
2. `npm ci`、CMake configure/build、TypeScriptビルド。
3. 実MCPと音源索引のテスト。別プロセスのstdioハンドシェイクと実エンジンへの `system_capabilities` 呼び出し。
4. ローカルライブラリの登録パス検出と、上限付きパッチ索引作成。市販音源の一括ロード・音色の試聴はしない。
5. 検証後、選んだクライアントのプロジェクト設定を作成・更新。

Windowsでクローン先に日本語などの非ASCII文字が含まれる場合、MSBuild/JUCEの補助コマンドがパスをCP932で壊さないよう、`%LOCALAPPDATA%\AIDAW\native-workspaces\<hash>` にネイティブビルド入力を同期してビルドする。成果物はクローン先の `build` ジャンクションからも参照でき、MCP設定の `AIDAW_ENGINE` には実体の絶対パスを保存する。TypeScript、作品データ、MCP設定はクローン先に残る。

| クライアント | 生成先 |
|---|---|
| Codex | `.codex/config.toml` |
| Claude Code | `.mcp.json` |

Node、エンジン、FFmpeg、保存先はそのマシンの絶対パスにする。これらの設定ファイルはgitignore対象。グローバル設定は変更しない。他のMCPサーバーや既存設定値を保持する。TOMLは再シリアライズするためコメント・見た目は変わり得るが、変更前の原文をジョブ内にバックアップする。不正な設定は上書きせずエラーにする。

AIDAWのデータは既定でクローン先の `.aidaw`。別の保存先や既存作品を共有する場合は両クライアントで同じ値を指定：

```sh
node scripts/setup.mjs --client both --data-dir "/absolute/path/to/AIDAWData"
```

既存のプロジェクトMCP設定に異なるAIDAW_HOMEがあれば停止する。エージェントはその既存パスで再実行する。以前のグローバル設定に別のAIDAW保存先がある場合も、エージェントがそれを確認して `--data-dir` に指定する。

## 再実行と確認

```sh
npm run setup:check
# ビルド済みで、登録・実接続試験・索引だけやり直す：
node scripts/setup.mjs --configure-only --client both
```

`--check` は依存ツールの確認のみ。ビルドやMCP登録の合格を意味しない。`--configure-only` はすでにあるエンジンを検証するため、ソース変更後は省略して通常のビルドを行う。

結果は `AIDAW_HOME/Setup.aidaw/state/last-setup.json` と `jobs/<job_id>/report.json`。設定原文のバックアップは同jobの `config-backups/`。作品と音源索引は再実行しても削除しない。途中で失敗した場合、エラーを修正して同じコマンドを再実行する。

## 自動化できない最後の操作

初回のOS開発ツールインストーラー、管理者認証、市販音源のライセンス認証、Codexのプロジェクト信頼やClaude CodeのMCP承認は、環境によってユーザー操作が必要。Homebrew / winget自体が未導入の場合もエージェントが公式手順で環境を整える。スクリプトは信頼・権限設定を無効化しない。

セットアップ成功後、クライアントの再起動またはMCP再読み込みが必要な場合がある。「設定生成＋独立したMCP接続試験の成功」と「今開いているクライアントから呼び出せた」を区別する。最後にクライアントから `system_capabilities` を実行して完了を確認する。

macOSはローカルで動作検証。Windows用bootstrapは実装済みだが実機未検証。音源自体の選定・ロード確認は [音源選定規約](INSTRUMENT_SELECTION.md) に従う。手動設定やClaude Desktopは [詳細手順](SETUP_CODEX_CLAUDE.md) を参照。

同じAIDAW_HOMEに対するサーバー二重起動は拒否する。CodexとClaudeの設定を両方作成しても、独立stdioサーバーを同じ保存先で同時起動しない。同時利用は[共通HTTPサーバー](REMOTE_SERVER.md)に接続する。

## 標準音源・エフェクトの自動導入

セットアップにはFluidR3 GMの検証付きダウンロードと、AIDAW GM / EQ / Limiter / Reverbのビルド・カタログ登録・パラメーターDB索引を含む。通常セットアップ時には、商用プラグインを使わない複数パート・独立リバーブステムの実レンダリング試験も実施する。約129 MiBの追加ダウンロードがあり、正しいbankがあれば再取得しない。`npm run demo` も標準パックで演奏する。[仕様とライセンス](STARTER_PACK.md)。
