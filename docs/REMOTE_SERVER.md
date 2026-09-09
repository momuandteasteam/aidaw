# 別マシンから使うAIDAWサーバー

AIDAWをプラグインの入ったマシンで常駐プロセスとして起動し、別のマシンのCodex / Claude CodeからStreamable HTTP MCPで操作できる。ローカルstdioとHTTPは同じ `createMcpServer` / `Service` / ネイティブエンジンを使う。処理の別実装やクライアント側の遅延修正はない。

## サーバー側

1. `node scripts/setup.mjs --client none` で本体をビルドする。
2. 音源のインストール、認証、素材の保存先を設定する。MASSIVE XなどGUI初期化を必要とする製品は、ログイン済みデスクトップセッションで起動する。
3. ランダムな認証トークンを生成し、Git対象外の環境設定へ保存する。

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

環境設定の例（値は自分のマシンの絶対パスに置換）。トークンは生成した値を設定する。

```dotenv
AIDAW_HOME=/absolute/path/to/AIDAWData
AIDAW_ENGINE=/absolute/path/to/aidaw/build/bin/aidaw-engine
AIDAW_FFMPEG=/absolute/path/to/ffmpeg
AIDAW_FFPROBE=/absolute/path/to/ffprobe
AIDAW_HTTP_HOST=127.0.0.1
AIDAW_HTTP_PORT=8787
AIDAW_HTTP_TOKEN=REPLACE_WITH_RANDOM_TOKEN
```

トークンは32文字以上が必須。設定ファイルは本人のみ読める場所に保存する。Windowsのエンジンには `.exe` を付ける。

```sh
node --env-file=/absolute/path/to/server.env dist/http.js
# 環境変数を既に設定した場合
npm run start:http
```

起動中はクライアントとは独立して動く。クライアント切断ではジョブを取り消さない。サーバープロセス終了では処理中ジョブをキャンセルする。OS起動時の自動登録・クラッシュ後の自動再開はこの実装に含めない。

## 接続経路

既定は127.0.0.1のみ。別マシンからはSSHポート転送、またはHTTPSリバースプロキシ経由で接続する。例えばクライアント側で：

```sh
ssh -N -L 8787:127.0.0.1:8787 user@audio-server
```

この場合クライアントのMCP URLは `http://127.0.0.1:8787/mcp`。HTTPSプロキシを使う場合はそのURLにする。プロキシはAuthorizationとMCP関連ヘッダー、SSE、アップロードサイズを通す設定が必要。HTTP本体にはTLSを実装していないため、暗号化されていないネットワークへトークン付きHTTPを公開しない。

LAN/VPNへ直接bindする場合は `AIDAW_HTTP_HOST` を明示する。このトークンは単一所有者用で、信頼できるクライアントに渡す。ツールにはサーバー上のファイルを読み込む機能があり、利用者ごとの権限分離・マルチテナントサンドボックスではない。ブラウザーOriginは拒否する。

接続方式：[MCP公式Streamable HTTP仕様](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。

## クライアント側

クライアントにVST3/AU・サンプル・ネイティブエンジンのインストールは不要。MCP HTTPへ接続する。

Codexの設定例。トークンはクライアントの起動環境に `AIDAW_HTTP_TOKEN` として渡す。

```toml
[mcp_servers.aidaw_remote]
url = "http://127.0.0.1:8787/mcp"
bearer_token_env_var = "AIDAW_HTTP_TOKEN"
tool_timeout_sec = 300
```

[Codex公式MCP設定](https://developers.openai.com/codex/mcp/)。

Claude Codeの例（macOS/Linuxシェル。実行するのはクライアント）：

```sh
claude mcp add --scope local --transport http aidaw-remote \
  http://127.0.0.1:8787/mcp \
  --header "Authorization: Bearer $AIDAW_HTTP_TOKEN"
```

[Claude Code公式MCP設定](https://code.claude.com/docs/en/mcp)。保存した認証情報はGitに含めない。

## 入力ファイルと成果物

APIが返すパスは**サーバー上のパス**。クライアントの `/Users/...` や `C:\...` をそのままasset_importへ渡しても、サーバーからは読めない。

1. `POST /uploads` へバイナリーを送る。全エンドポイントで `Authorization: Bearer <token>` が必要。
2. 応答の `path` を `asset_import`、`midi_import`、`bundle_import`、対応プリセットインポーターに渡す。
3. `render_start` → `job_status` → `delivery_publish` をサーバーで実行する。
4. 応答の音声/ZIPなどのパスをURLエンコードし、`GET /files?path=...` で取得する。

```sh
curl --fail --header "Authorization: Bearer $AIDAW_HTTP_TOKEN" \
  --header 'Content-Type: application/octet-stream' \
  --header 'X-AIDAW-Filename: source.wav' \
  --data-binary @source.wav http://127.0.0.1:8787/uploads

curl --fail --get --header "Authorization: Bearer $AIDAW_HTTP_TOKEN" \
  --data-urlencode 'path=/server/path/returned/by/job_status.wav' \
  http://127.0.0.1:8787/files --output downloaded.wav
```

アップロードは最大512MiB、同時4件。WAV/MIDI/ZIP/JPEG/PNG/NKSF/MB2を受け付ける。`Inbox.aidaw/jobs/<id>/artifacts/` に保存しハッシュを返す。受信時点では中身や互換性の検証済みとはしない。失敗時は部分ファイルを除去する。元の曲名を残したい場合はプロジェクト・トラック・タグで明示する。

ダウンロードはAIDAW_HOME内のassets/outputs/artifacts/frozen音声等に限定し、ディレクトリ外のパスや設定ファイルは拒否する。ファイル転送の再開・Rangeは未対応。音声をクライアント側で読み込んだ後に試聴評価を登録する。

## 運用上の境界

- 最大64MCPセッション、非稼働セッションは30分で期限切れ。期限切れやサーバー再起動後は接続を初期化し直す。
- 同じServiceを共有するため編集revisionとジョブ状態はクライアント間で共通。競合時は再読込し、再送にはrequest_idを使う。
- プラグインのwarm-up、状態復元、PDC、send/return、音量処理、キャッシュ、納品はすべてサーバー側。
- ローカルHTTP試験で二つのクライアント、切断後のジョブ完了、転送ハッシュ、認証拒否、パス境界を検証。実際の別マシン・LAN・HTTPSプロキシ・Windowsでの運用確認は未実施。

大量依頼の運用・再起動復旧・公平な順番待ちについては [サーバーレビューとキュー設計](SERVER_REVIEW_AND_QUEUE_DESIGN.md) を参照。現在は全音声処理が共通FIFOで常に1件。永続化・自動復旧は今後の対応。

### 処理と取り出しの分離

queue_statusで実行中と順番待ちを確認できる。delivery_inspectで完成済みの納品manifestとserver_pathを取得し、GET /filesでダウンロードする。この経路は音声キューに入らず、レンダリング中でも使える。追加のMP3変換・ZIP作成・再レンダリングは共通キューで待機する。同一AIDAW_HOMEのHTTP/stdioサーバーは1プロセスのみ。複数端末はこのHTTPサーバーに接続する。
