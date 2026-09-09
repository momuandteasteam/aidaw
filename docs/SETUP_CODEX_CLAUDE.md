# AIDAW — Codex / Claude セットアップ

**通常は [自動セットアップ](AUTO_SETUP.md) を利用してください。** 以下は手動設定・トラブルシューティング向けの詳細です。

2026-09-09作成。AIDAW 0.1.0のソース実装を対象とする。現在はソースからビルドする開発版で、署名済みインストーラーはない。macOSで検証済み、Windowsはビルド・接続例を用意しているが実機確認は未完了。

## 1. 構成

```text
Codex / Claude Code / Claude Desktop
       ↓ MCP（stdio）
Node.js: dist/mcp.js
       ↓ 分離したワーカープロセス
build/bin/aidaw-engine → VST3 / AU → WAV / MIDI / ステム / MP3
```

AIDAW自身にOpenAI・AnthropicのAPIキーや音声モデルの接続設定は不要。利用するCodex/Claudeへのログイン・利用契約は別途必要。ローカル音源を使うので、そのプラグインとライブラリが入っているPCで実行する。このstdio設定をWeb版のリモートコネクターURL欄に入れることはできない。

音声確認は呼び出し元ツールで行う。ただし、MCPが返すローカル音声パスだけで、すべてのクライアントが自動的に音声を読み込めるとは限らない。実際にアクセスできた場合だけ「試聴済み」とする。必要なら出力WAVを呼び出し元に添付する。計測値だけを試聴結果として記録しない。

## 2. 共通の準備とビルド

| 必要なもの | 条件 |
|---|---|
| Node.js / npm | Node.js **22.13以降**。内蔵SQLiteを使用 |
| CMake | 3.22以上 |
| macOSのC++環境 | Xcode Command Line Tools |
| WindowsのC++環境 | Visual Studio 2022のC++デスクトップ開発、Windows SDK |
| FFmpeg / ffprobe | MP3、タグ検証、LUFS / true peak測定に使用 |
| プラグイン | 対応CPUの64bit VST3。AUはmacOSのみ |
| 初回ネット接続 | npm依存・固定したJUCEソースの取得 |

Apple Silicon MacでHomebrewを使う場合の準備例。既にあるものは再導入不要。

```sh
xcode-select --install
brew install node cmake ffmpeg
```

AIDAWのソースフォルダで実行する。macOSの例の場所は次のとおり。他のPCでは置き換える。

```sh
cd /Users/yourname/Projects/aidaw
npm ci
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release --parallel 4
npm run build
npm test
node dist/cli.js system_capabilities
```

WindowsはDeveloper PowerShellでソースフォルダに移動し、configure行を必要に応じて `cmake -S . -B build -A x64` にする。以降のbuild/npmコマンドは同じ。WindowsではWindows版Nodeとネイティブエンジンを使う。WSL内でWindows VST3がそのまま動く前提にしない。

出力を確認する：

- `dist/mcp.js`：MCPサーバー
- `dist/cli.js`：単独動作確認用CLI
- `build/bin/aidaw-engine`：macOSエンジン（Windowsは `aidaw-engine.exe`）

`npm test`は検証用音源で実際にレンダリングする。市販プラグインの条件付きテストのskipは、その製品の動作確認成功を意味しない。

## 3. 絶対パスと保存先を決める

macOSでは `command -v node`、`command -v ffmpeg`、`command -v ffprobe`、Windowsでは `Get-Command node,ffmpeg,ffprobe | Select-Object Name,Source` で場所を確認する。以下はmacOSの例のパスを使った例。別環境ではすべて置き換える。

| 設定 | macOSの例の例 |
|---|---|
| 起動コマンド | `/opt/homebrew/bin/node` |
| 起動引数 | `/Users/yourname/Projects/aidaw/dist/mcp.js` |
| `AIDAW_HOME` | `/Users/yourname/Projects/aidaw/.aidaw` |
| `AIDAW_ENGINE` | `/Users/yourname/Projects/aidaw/build/bin/aidaw-engine` |
| `AIDAW_FFMPEG` | `/opt/homebrew/bin/ffmpeg` |
| `AIDAW_FFPROBE` | `/opt/homebrew/bin/ffprobe` |

`AIDAW_HOME`を必ず指定する。未指定では起動時の作業ディレクトリの `.aidaw` が使われ、クライアントによって作品が見つからなくなる。CodexとClaudeで既存作品を共有するなら同じ値にする。別PCではbundleで受け渡す。レンダリング中の同じ作品を複数クライアントで同時に操作しない。

```text
AIDAW_HOME/
├── projects/<project_id>/
│   ├── project.json
│   ├── assets/
│   ├── state/
│   ├── jobs/<job_id>/
│   ├── outputs/
│   └── temp/
└── PluginLibrary.aidaw/   # 共有の音源・プリセット索引と試奏DB
```

## 4. Codex

Codexの `~/.codex/config.toml` に次の設定を追記する。既存の設定を丸ごと上書きしない。同名の `[mcp_servers.aidaw]` がある場合はその項目を更新する。プロジェクト限定なら、信頼済みプロジェクトの `.codex/config.toml` も利用できる。[公式MCP設定](https://developers.openai.com/codex/mcp/)

```toml
[mcp_servers.aidaw]
command = "/opt/homebrew/bin/node"
args = ["/Users/yourname/Projects/aidaw/dist/mcp.js"]
startup_timeout_sec = 30
tool_timeout_sec = 300

[mcp_servers.aidaw.env]
AIDAW_HOME = "/Users/yourname/Projects/aidaw/.aidaw"
AIDAW_ENGINE = "/Users/yourname/Projects/aidaw/build/bin/aidaw-engine"
AIDAW_FFMPEG = "/opt/homebrew/bin/ffmpeg"
AIDAW_FFPROBE = "/opt/homebrew/bin/ffprobe"
```

保存後にCodexを再起動し、新しいセッションで `system_capabilities` を呼び出す。AIDAWフォルダをプロジェクトとして開き、ルートの `AGENTS.md` と `docs/INSTRUMENT_SELECTION.md` を読ませる。MCP自体も音源選定指示を送るので、別フォルダから使う場合にも規約を伝えられる。

長い処理は `render_start` → `job_status` の非同期経路を使う。300秒はこの手順での設定例で、長時間の一括処理を同期呼出しで待つための保証ではない。

WindowsのTOMLでは、例えば次のように単一引用符を使えばバックスラッシュをそのまま書ける。残りの設定も上と同じ要領でWindows実パスに置き換える。

```toml
# 上のmacOS設定と重複追加せず、対応する値を置換
# command = 'C:\Program Files\nodejs\node.exe'
# args = ['C:\AIDAW\dist\mcp.js']
# AIDAW_ENGINE = 'C:\AIDAW\build\bin\aidaw-engine.exe'
```

## 5. Claude Code

AIDAWフォルダに移動し、次を実行する。`--scope local` はそのプロジェクトの個人設定。全プロジェクトから使いたい場合だけ `--scope user` に変える。登録オプションは `--` より前、Nodeのコマンドは後ろに置く。[公式MCP設定](https://code.claude.com/docs/en/mcp)

```sh
cd /Users/yourname/Projects/aidaw
claude mcp add \
  --env AIDAW_HOME=/Users/yourname/Projects/aidaw/.aidaw \
  --env AIDAW_ENGINE=/Users/yourname/Projects/aidaw/build/bin/aidaw-engine \
  --env AIDAW_FFMPEG=/opt/homebrew/bin/ffmpeg \
  --env AIDAW_FFPROBE=/opt/homebrew/bin/ffprobe \
  --scope local --transport stdio aidaw \
  -- /opt/homebrew/bin/node /Users/yourname/Projects/aidaw/dist/mcp.js
claude mcp list
```

Claude Codeを再起動し、`/mcp` で接続状態を見る。

Claude Codeは `AGENTS.md` を自動では読まないため、ルートの `CLAUDE.md` に次を記載する。既存ファイルがあれば追記する。このリポジトリには共有規約をimportするCLAUDE.mdを同梱している。[公式の共有規約読み込み手順](https://code.claude.com/docs/en/memory#agentsmd)

```markdown
@AGENTS.md
@docs/INSTRUMENT_SELECTION.md
```

Windows PowerShellでは上のシェル用改行 `\` を使わず、一行にして次のように指定する。FFmpegのパスは実環境に合わせる。

```powershell
claude mcp add --env 'AIDAW_HOME=C:\AIDAWData' --env 'AIDAW_ENGINE=C:\AIDAW\build\bin\aidaw-engine.exe' --env 'AIDAW_FFMPEG=C:\ffmpeg\bin\ffmpeg.exe' --env 'AIDAW_FFPROBE=C:\ffmpeg\bin\ffprobe.exe' --scope local --transport stdio aidaw -- 'C:\Program Files\nodejs\node.exe' 'C:\AIDAW\dist\mcp.js'
```

## 6. Claude Desktop

設定 → Developer → Edit Configから設定を開く。ファイルの場所はmacOSでは `~/Library/Application Support/Claude/claude_desktop_config.json`、Windowsでは `%APPDATA%\Claude\claude_desktop_config.json`。[MCP公式のローカル接続手順](https://modelcontextprotocol.io/docs/develop/connect-local-servers)

既存の `mcpServers` に `aidaw` を追加する。以下は設定が空の場合の全体例。

```json
{
  "mcpServers": {
    "aidaw": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/yourname/Projects/aidaw/dist/mcp.js"],
      "env": {
        "AIDAW_HOME": "/Users/yourname/Projects/aidaw/.aidaw",
        "AIDAW_ENGINE": "/Users/yourname/Projects/aidaw/build/bin/aidaw-engine",
        "AIDAW_FFMPEG": "/opt/homebrew/bin/ffmpeg",
        "AIDAW_FFPROBE": "/opt/homebrew/bin/ffprobe"
      }
    }
  }
}
```

WindowsのJSONは `"C:\\AIDAW\\dist\\mcp.js"` のようにバックスラッシュを二重にする。保存後、ウィンドウを閉じるだけでなくClaude Desktopを完全終了して再起動し、AIDAWのツールが表示されるか確認する。Claude Codeの `.mcp.json` や `CLAUDE.md` がDesktopにも自動適用されるとは考えず、制作規約は会話・プロジェクト指示にも渡す。

## 7. 初回の音源登録と動作確認

プラグインのインストール後、必要な認証・サンプル保存先・初回初期化をメーカーのアプリ等で済ませる。音源とホストのCPU形式を合わせる。MASSIVE Xなど一部製品は非表示のビュー初期化を使うため、macOSのログイン済みGUIセッションが必要。

接続先のAIへ、次をそのまま依頼できる。

> AIDAWの初期確認をしてください。まずsystem_capabilitiesとproject_listを読み、既存作品は変更しないでください。catalog_discoverでVST3候補をページ末尾まで確認し、使用候補を個別にcatalog_scanしてください。macOSで必要ならAUも確認してください。content_discover_roots、content_index、content_searchでKontakt等の内部ライブラリまで調べてください。未確認の場所と読み込み未検証の音源を区別して報告してください。標準MIDIやbuiltinへの自動代用は禁止です。

基本の順序：

1. `system_capabilities`：ネイティブエンジンに接続できる。
2. `catalog_discover` → `catalog_scan` → `catalog_search`：使用したい音源が登録される。
3. `content_discover_roots` → `content_index` → `content_search`：ライブラリ内の候補を検索できる。未登録の保存先は `content_register_root`。
4. `plugin_inspect` / 対応済みインポーター → `plugin_preset_save` → `sound_probe`：実際に発音する保存状態を確認する。
5. 出力音声を呼び出し元で確認し `sound_assess` に評価を記録する。音声にアクセスできない場合は、その旨を明記する。
6. 試作用の新規プロジェクトに採用音源を割り当て、`render_start` → `job_status` → `delivery_publish` で書き出しを確認する。

4の手順は音源形式ごとに異なる。Kontaktの任意NKI/NKSNを直接ロードするアダプターは未実装。ファイルを見つけただけで演奏可能とは扱わない。対応した保存状態がない場合は、制約を報告して別の適切な音源候補を検討する。`plugin_first` を勝手に `allow_basic` に変更して逃げない。

音源の追加・更新後は該当プラグインを再スキャンし、ライブラリを再索引する。AUからWindows VST3への状態変換はないため、両OSで再編集する作品は共通VST3と対応版を選ぶ。別PCには `bundle_export` / `bundle_import` で素材と確定テイクを渡し、`project_validate` で不足を確認する。

## 8. よくある問題

| 症状 | 確認と対処 |
|---|---|
| MCPが起動しない | Nodeの絶対パス・バージョン、`dist/mcp.js` の存在を確認。`npm run build` 後にクライアント再起動 |
| engineが見つからない | nativeビルド完了と `AIDAW_ENGINE` を確認。Windowsは `.exe` |
| 作品が表示されない | 両クライアントの `AIDAW_HOME` が一致しているか確認 |
| MP3/LUFS処理でENOENT | FFmpeg/ffprobeを導入し、GUIからも届く絶対パスをenvに設定 |
| 音源が見つからない | discoverだけでなくscanが必要。独自保存先、CPU、フォーマットを確認 |
| Kontakt本体しか出ない | contentの検出・索引・検索を実行。非標準の保存先を追加登録 |
| プリセットが見つかったが鳴らない | 未対応形式、認証、サンプル不足、音域、保存状態を確認。GMに置換しない |
| 長い処理がタイムアウト | 非同期render_start/batch_renderとjob_statusを使う。実行中はクライアントを終了しない |
| 起動したが端末が無表示 | `dist/mcp.js` はstdio待機する。単独診断は `dist/cli.js system_capabilities` を使う |

更新時はジョブ終了後に `npm ci` とビルドを行い、全MCPクライアントを再起動する。ネイティブ変更時はCMakeビルドも必要。

本手順は設定例・コード・MCP stdio試験に基づく。ユーザーのCodex/Claude設定を自動変更したものではなく、各アプリでの接続確認は設定適用後に行う。

標準セットアップには **AIDAW GM（FluidR3）・EQ・Limiter・Reverb** が含まれます。手持ち音源がない環境での制作、またはユーザーが標準音源を希望する場合、AIDAW GMは `plugin_first` のまま明示的に選択できます。先に利用可能な音源・内部ライブラリを比較する方針と、指定された音源のロード失敗を黙って代用しない規約は維持します。詳細: [標準音源・エフェクト](STARTER_PACK.md)。
