# 配置・寿命・依存方向

読む条件: 実装、ファイル追加、保存先、build、setup、配布を変更するとき。
正本範囲: AIDAWのディレクトリ責務と依存方向。他文書で別配置を定義しない。
関連要件: R-001, R-006, R-011, R-012。

## 管理する6ディレクトリ

| 配置 | 責務 | 寿命とGit管理 |
|---|---|---|
| Core/Source | application、domain、契約、adapter、desktop、audio、controlのsource | レビュー対象として追跡 |
| Core/Tests | 契約・behavior・native・UI試験と最小fixture | sourceは追跡、試験出力は除外 |
| Core/Tools | setup、build、検証、配布の再現可能手順 | sourceとして追跡。作品固有処理を置かない |
| Core/Settings | 音声出力、機器、MIDI Learn、skin、個人配置 | 機械・ユーザーの可変設定。除外 |
| Core/State | workspace manifest、catalog、選択共有、receipt、排他 | 運用状態。除外。cache掃除で全削除しない |
| Core/Cache | 再生成可能な取得・索引中間物 | 除外。再生成方法と削除条件を持つ |
| Core/Logs | 診断 | 除外。認証情報や不要な作品内容を記録しない |
| Core/Build | JS/native compile、bundle、test一時出力、配布成果物 | 生成物として除外 |
| Projects | ユーザー作品の作業正本 | 作品寿命で保持。原則repository Gitから除外 |
| Plugins | 交換可能なInstrument、Effect、Controller、Skin、Engine | source・宣言manifestは追跡可。導入binary・機械別receiptは除外 |
| Libraries | 共有音源資源、SDK、由来・ライセンス | 小さい由来文書は追跡可。取得SDK・大容量bankは除外 |
| Workflows | AI・開発者の実行手順とtemplate | 手順正本として追跡 |
| Docs | architecture、契約の意味、利用説明、検証入口 | 文書として追跡 |

管理するトップレベルは Core / Projects / Plugins / Libraries / Workflows / Docs の6個だけ。別のHomeや独自責務のrootディレクトリを追加しない。旧配置の別名、互換symlink、fallback探索を増やさない。大小文字を全platformで統一する。

README、AGENTS、CLAUDE、LICENSE等の小さいrootファイルは入口。実装や生成物を集積しない。package.json、package-lock.json、tsconfig、CMake、node_modulesはCoreが所有する。rootを別のnpm packageにしない。既存のバージョン管理・ツール必須metadataは用途、生成者、Git管理、理由を開発設定で説明し、任意の新カテゴリを許す根拠にしない。

## Sourceの依存方向

| 配置 | 所有するもの・禁止する依存 |
|---|---|
| Domain | composition/mastering/separationモデル、不変条件、compile。Node、Electron、MCP、JUCE、filesystemへ依存しない |
| Contracts | port、DTO、version、capability、単位、error。実装クラスをimportしない |
| Application | use caseと処理順序。Domain/Contractsを使い、外部処理をportで注入する |
| Adapters | filesystem、catalog、native process、platform、HTTP/MCP変換。外部形式を契約へ変換する |
| Desktop | OS host、dialog、設定UI、runtime接続。skin実装を固定しない |
| Audio | native audio処理とhost接続。各モードでDSP host、device、遅延補償を共有する |
| ControlSurface | browser/device共通state、action、画像、座標。Node、Electron、renderer、engineへ逆依存しない |
| Server / CLI | application操作の入口。Service内部やnative protocolを独自操作しない |
| StarterPlugins | 標準配布pluginのnative source。ビルド結果は独立plugin packageとして導入する |

端のadapterや機種を追加してもdomainやapplicationへメーカー固有分岐を増やさない。現行実装の分離範囲は [検証台帳](../Development/VERIFICATION.md) を確認する。既存の具象依存を新しい正規の依存方向と解釈しない。

## Projects

Projects/&lt;project_id&gt;/ が唯一の作業正本。project.json、manifest.json、作品内AGENTSと assets / state / jobs / outputs / temp を持つ。state/historyは保持版、state/composition・state/mastering・state/separationは現在ビュー。原音、差分履歴、保存plugin stateを再生成可能cacheと混同しない。内部の役割と可搬形式は [HISTORY](../Contracts/HISTORY.md)。

作業ディレクトリと持ち出し用archiveを別媒体として扱う。importは新IDへ復元し、既存作品を上書きしない。archive内の文書・コード・native binary・skin・controllerを自動登録や実行の根拠にしない。

## PluginsとLibraries

Pluginsの分類は Instruments / Effects / Controllers / Skins / Engines。実行する交換単位を置く。Librariesは Sounds / SDKs / Licenses 等の参照資源を置く。標準Instrument/Effectは独立した高速native pluginとし、作品スクリプトや本体の簡易音源へ処理を隠さない。

package専用Resourcesはpackage内に保持できる。その参照、hash、所有者、再配布条件をmanifestとlicenseに明記する。配布source/宣言manifestと導入binary/receiptを区別し、取得前にignore規則を決める。巨大bankやSDKをsource扱いで追加しない。module契約は [EXTENSIONS](../Contracts/EXTENSIONS.md)。

## 固定する運用配置

| 用途 | 配置 |
|---|---|
| workspace manifest | Core/State/workspace.json |
| setup状態・最終receipt | Core/State/Setup、配下state/last-setup.json |
| catalog | Core/State/Catalog |
| AI/GUI共有選択 | Core/State/active-context.json |
| process/audio/選択の排他 | Core/State/Runtime/Locks |
| controller scripts・profile | Plugins/Controllers/Scripts、Plugins/Controllers/Profiles |
| 個人設定 | Core/Settings |

パス構築はHomePathsへ集約する。AIDAW_HOMEは6カテゴリを含むworkspace rootであり、追加のHomeディレクトリを意味しない。起動したshellのcwdを保存先にしない。既存配置の衝突や不完全な導入は明示エラーとし、黙って別保存先を作らない。

## 変更と確認

1. 責務、所有者、寿命、source/生成物、依存方向、既存データへの影響を記す。
2. 既存6カテゴリへ配置する。新rootが本当に必要なら本正本の変更をユーザーと合意する。既に承認済みの配置は再確認不要。
3. HomePaths、import、build、setup、package、Git除外、文書参照を一緒に更新する。旧新の二重正本を残さない。
4. [home.ts](../../Core/Source/Adapters/node/workspace/home.ts)、[check-layout](../../Core/Tools/check-layout.mjs)、[directory-contract試験](../../Core/Tests/directory-contract.test.mjs) と対象機能の試験を確認する。

実装手順は [IMPLEMENTATION](../../Workflows/Development/IMPLEMENTATION.md)。文書だけ変更するときは [DOCUMENTATION](../Development/DOCUMENTATION.md)。

Antigravity用.agentsはクライアント必須metadataとして例外登録する。許可内容・生成・公開除外は[CLIENTS](../Contracts/CLIENTS.md)。

Design status: ready
