# AIクライアント接続

読む条件: setupの登録先・MCP設定・クライアント入口を変更するとき。
正本範囲: クライアント別設定の生成、保全、有効化。
関連要件: R-002。
Design status: ready

## 対応OSと導入境界

対応OS表記は **Windows 11・macOS・Linux（未検証）** に統一する。Linuxはソースからの実験的導入であり、実機動作・配布パッケージの検証済み対応を意味しない。setup.shはmacOSとLinuxを振り分け、共通setupもLinuxを拒否しない。LinuxではNode 22.13以上、uv、CMake、C++コンパイラ、pkg-config、FFmpeg/ffprobeとJUCE/Electronに必要なOS開発・実行ライブラリを利用者が準備する。ディストリビューション固有のパッケージを推測して管理者権限で導入しない。不足ツールは列挙して停止し、未検証であることを導入時にも表示する。

VST3はOSに合ったバイナリが必要。Audio UnitsはmacOSのみ。LinuxからWindows用プラグインを直接利用できるとは案内しない。OS表記はサポート対象の宣言であり、実機検証結果は別途記録する。検証はshell構文・既存setup回帰・macOSの依存確認を行い、Linux実機未検証を明記する。

## クライアントの選択

setup --client はcodex / claude / antigravity / both / all / none。bothは従来どおりCodexとClaude Codeのみ、allは三者。既定値bothを変えない。指定クライアント以外を書き換えない。クライアント自身のログイン・信頼確認は無効化しない。

Codexは.codex/config.tomlのmcp_servers、Claude Codeは.mcp.jsonのmcpServers。Antigravityは[公式MCP文書](https://antigravity.google/docs/mcp)に従いworkspaceの.agents/mcp_config.jsonのmcpServersへ登録する。commandは実行中Node、argsは共通stdio entry、envのAIDAW_HOMEは指定workspace root。AntigravityにCodex専用timeoutやClaude専用typeを混在させない。

既存の他server・未知設定・無効化指定を保持する。別AIDAW_HOMEとの不一致、リモート設定のローカル化、破損JSON、不正なobject、symlinkを拒否する。失敗時に別の保存先を作らない。変更前に全対象を検証・backupし、同時更新を検出し、書込失敗は書いた対象をrollbackする。再実行は差分なしになる。

## エージェント入口

[公式Rules文書](https://antigravity.google/docs/rules-workflows)のworkspaceルール配置.agents/rulesに短いaidaw.mdをsetup生成する。共通AGENTSを読む経路だけを持ち、制作・設計・還元手順を複製しない。既存の利用者ルールは残し、同名の管理対象外ルールを上書きしない。ルール有効化とMCP接続有効化はそれぞれクライアント側で確認する。

.agentsはクライアント必須metadata例外。mcp_config.jsonとrulesだけを許可し、実装をここへ置かない。生成した設定とルールはGit除外・公開検査対象。正本はCoreの生成処理とAGENTS/Workflows/Docs。

## 検証と完了

config merge・冪等性・既存設定保全・remote拒否・rule衝突・all/bothの区別をテストする。実生成設定からstdio handshakeしsystem_capabilitiesを取得する。設定書込・単独接続試験成功を、Antigravity内部での有効化成功と混同しない。MCPのRefreshまたはアプリ再読み込みが残れば明記する。setup成功時の還元tipは全クライアントで表示する。
