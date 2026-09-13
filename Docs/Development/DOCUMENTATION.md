# 少ない入力で使う文書規約

読む条件: AGENTS、Workflows、Docs、生成する作品規約、MCP説明を変更するとき。
正本範囲: 文書の責務・読み取り経路・記載方法・検証。
関連要件: [REQUIREMENTS](REQUIREMENTS.md) の変更対象ID。

## 読み取り経路

常時入口は [AGENTS](../../AGENTS.md)。タスクに合うworkflowから、必要な境界文書だけを読む。Docs全体、要件台帳全体、全契約を毎回読み込まない。利用説明、実装の経緯、将来案を入口へ置かない。

要件との照合が必要なときは [REQUIREMENTS](REQUIREMENTS.md) と [VERIFICATION](VERIFICATION.md) の対象R-ID行だけを読む。rg -n等で該当IDを検索し、全台帳を常時入力にしない。行の実装・試験リンクから必要な箇所へ進む。

READMEは人向けの製品説明・初回セットアップ・依頼例を載せる。冒頭で作業実行中のAIをAGENTSへ案内し、人向け本文の通読を要求しない。README自体の編集・説明時は対象本文を読む。人向けの説明に必要な容量を確保するため、READMEの上限は12000 bytesとし、AIの常時入口とは分ける。利用例を新しい仕様の正本にしない。

設計・規約ファイルの冒頭に「読む条件」「正本範囲」「関連要件」を記す。リンクは次に読む条件を伴わせ、無関係な文書を一括必読にしない。作品選択確認は作品編集にだけ適用し、本体・文書変更の前提にしない。

## 責務と根拠

| 種類 | 所有するもの |
|---|---|
| AGENTS / CLAUDE | taskへの振分け。CLAUDEは共通入口参照とclient差分だけ |
| Workflows | 実行順序、分岐条件、対象確認、完了条件 |
| Architecture | component責務、配置・依存、操作面の製品要件 |
| Contracts | 入出力・状態・ID・単位・versionの意味と不変条件 |
| REQUIREMENTS | 要件IDと所有文書の索引 |
| VERIFICATION | 現行実装・試験・native/実機の根拠と未達範囲 |
| User | 人向けの利用説明。新しい仕様を独自に追加しない |

明示ユーザー指示を最優先し、配置・意味はそれぞれの正本に従う。型/schema/validatorは現在受け付ける構文の根拠、検証台帳は確認範囲の根拠。コードが要求と違う場合は要件を消さず未達を記録する。設計文書に書いたことを実装済みと報告しない。

## 書き方

- 一つの規則は一つの文書が所有する。数値、保存先、API構文を複数文書へコピーせず、正本へリンクする。
- 条件→必要な動作→失敗時の扱いを書く。一般論や「適切に」の連続で具体的な判定を隠さない。
- 公開型・tool一覧の全文を写さず、実ファイルとsymbol名を指す。tool descriptionは操作固有の制約に絞り、MCP常時instructionsへ全手順を埋め込まない。
- 不変要件、現行構文、未実装を混ぜない。過去作業記録や廃案はGit履歴へ残し、現行docの末尾へ追記し続けない。
- sourceの存在、fake試験、native処理、実際の音声確認、物理機器確認を別の根拠として扱う。未確認を肯定文で補わない。
- 新設文書は既存の責務へ収める。大きい一冊へ集約せず、同じ情報の小さなstubも量産しない。

## 容量とmanifest

[documents.json](documents.json) は管理文書のpath、role、max_bytes、unique ownsを持つ。routingや仕様本文、実装状態の別正本を作らない。UTF-8 byte上限を機械検査する。token削減は設計目的だが、tokenizerで測っていない数値を正確なtoken数として報告しない。

AGENTSは短い常時入口、通常workflow/契約は一つの作業で読める量を保つ。上限超過時はまず責務と重複を見直す。台帳等の参照用途で情報を失う場合は、理由を明示してmanifestの上限を変更する。CONTROLSは追加操作画面を含む参照仕様として9000 bytes、VERIFICATIONは15要件の根拠表として12000 bytesを上限とし、該当節・行だけ読む。改行削除だけで見かけの行数を減らさない。

## 文書先行の開発

機能追加・バグ修正では [設計確定手順](../../Workflows/Development/DESIGN_FIRST.md) を必須とする。所有文書を先に更新し、readyで設計確定、検証台帳で実装状況を区別する。設計の入力・出力・エラー・検証条件を確定してから実装する。

## 変更と確認

1. 変更要件のR-IDと所有文書を特定する。不要な入口・周辺文書へ同じ規約を複製しない。
2. workflow、契約、実装、検証根拠のうち実際に影響する箇所を更新する。生成作品規約の変更はgeneratorも更新する。
3. 廃止文書の有効情報を移管し、参照元を新正本へ向けて削除する。旧正本へのredirect stubや大きなarchive文書を残さない。
4. repository rootからnpm --prefix Core run check:docsを実行する。[checker](../../Core/Tools/check-docs.mjs) はinventory、UTF-8容量、所有責務、local link、入口からの到達性、要件行対応を検査する。
5. 変更したコードがあれば対象behavior試験を行う。文書の意味的整合性、未実装の誤記、ユーザー要求の欠落はlintだけで保証しない。

配置を変更する場合だけ [DIRECTORIES](../Architecture/DIRECTORIES.md)。開発環境や標準コマンドが必要な場合だけ [CONTRIBUTING](CONTRIBUTING.md)。認証、外部コード、archive境界を変更する場合だけ [SECURITY](SECURITY.md) を読む。
