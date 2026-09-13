# Application操作と共有選択

読む条件: API、MCP、HTTP、CLI、desktop接続、作品選択、export要求を変更するとき。
正本範囲: ApplicationPortの意味、transport境界、編集対象と試聴対象の区別。
関連要件: R-002, R-006, R-011, R-013。

## 共通操作境界

ApplicationPortはprotocolVersion、contract、definitions、invoke、closeを公開する。現行contractはaidaw.applicationのmajor 1 / minor 0、commands.v1。接続側はmajor、最低minor、必須featureを検証する。対応しない契約で処理を始めない。

operation名・入力構文は [definitions](../../Core/Source/Application/local-application.ts) が正本。共通 [call](../../Core/Source/Application/api.ts) は未知operationと不正入力を拒否し、結果がJSONとして表せることを検証する。HTTP/MCPはこの同じ境界へ変換し、独自Service操作やnative commandの透過転送を作らない。

現行portはZod schemaを公開する型を含む。汎用wire envelope、全操作共通のtyped error、独立negotiate要求が実装されていると仮定しない。変更時は [型](../../Core/Source/Contracts/application-contract.ts) と利用側を同時に更新する。

## 作品と選択

| 操作・値 | 意味 |
|---|---|
| active_context_get | 同じworkspaceを使うGUI/AI間の現在選択 |
| active_context_set | project、必要ならsong/version/comparison/過去revisionの選択更新。作品編集ではない |
| project_document | mode別の正本文書。revision指定は保持された過去版の読み取り |
| revision | 現在の作品head。編集時のbase_revisionの根拠 |
| selected_revision | 試聴する過去版。編集base_revisionに自動転用しない |
| song_id / version_id / comparison | masteringの試聴対象。版指定とA/B指定を重ねない |
| available / updated_at | 選択の有効性と更新時刻。commit用CAS tokenではない |

既存作品の内容を変更する命令ごとに選択と正本を読み、確定直前にも選択を確認する。対象が未選択・削除済みなら適当な作品を選ばない。ユーザーが明示した対象を優先し、GUIが違うだけで別作品へ適用しない。本体コードや文書の編集にこの作品選択手順を要求しない。具体的な手順は [EDITING](../../Workflows/EDITING.md)。

現在の編集要求はproject_id / base_revision / request_idを持つ。共有選択のgenerationをcommitに添える契約はないため、直前再取得とcommitの間のGUI切替を原子的に拒否する保証はない。base_revisionの競合拒否と混同しない。選択共有の仕様を変える場合は [active-context](../../Core/Source/Adapters/node/runtime/active-context.ts) と編集入口の双方を調べる。

## 更新と即時操作

project_applyは具体的operation群を一つの原子的編集として適用する。保存、再試行、復元の意味は [HISTORY](HISTORY.md)。masteringの版操作は [DOCUMENTS](DOCUMENTS.md) に従う。

playback_startは対象revisionと必要なsong/versionを固定して再生する。再生中に正本を編集してもそのsessionへ自動適用しない。playback_set_mixとplayback_set_volumeは試聴状態。作品へ残す場合は編集操作を明示する。画面更新と実音反映を同一視しない。

project_saveは編集可能なarchiveの保存、export_startは選択対象・scope・形式を固定した音声書き出し。音声exportの完了はjob成功と成果物を確認して判断する。A/Bの試聴先を暗黙の納品版にしない。2mix入力から楽器別stemやMIDIを作れると扱わない。

## transportと障害

HTTP経由のpathはサーバー上のpath。remote clientはupload後の参照を入力し、認証されたartifact取得経路から完成済み出力を取得する。clientのローカルpathをserverに存在すると推測しない。認証・公開範囲は [SECURITY](../Development/SECURITY.md)。

不正入力、未知対象、競合、未対応feature、音源やdeviceの欠損を成功へ変換しない。現在の例外には通常Errorもあり、全失敗で統一codeが返る保証はない。新しいerror contractを追加する場合はcode・retry条件を定義し、messageの曖昧な類似で分岐しない。

検証入口は [application-port](../../Core/Tests/application-port.test.mjs)、[active-context](../../Core/Tests/active-context.test.mjs)、[http](../../Core/Tests/http.test.mjs)、[mcp](../../Core/Tests/mcp.test.mjs)。実施根拠は [VERIFICATION](../Development/VERIFICATION.md) の関連要件行を読む。

## 開発時の設計ゲート

Design status: ready

製品変更の前提は [設計確定手順](../../Workflows/Development/DESIGN_FIRST.md)。design-gateのbeginは作業IDと登録済みArchitecture/Contracts文書を入力し、ready・文書検査成功を要求する。Core/State/Designに文書と製品コードのSHA-256を記録し、checkは文書の一致を検証する。文書欠落、未確定、改変は失敗とする。PR検査は製品変更に伴う設計文書差分の欠落を拒否する。負例検証は未確定・文書変更・PR文書欠落・不正IDを含む。receiptに秘密やソース本文を保存しない。

## 還元案内

セットアップ成功時は必ず還元tipを標準出力へ表示し、AIは完了説明にも含める。project_createの成功結果は同じtipを含む。GUI新規作成時は非モーダル通知として表示する。tipは「この変更を作者に共有して／プルリクを作成して」という依頼例を含み、自動送信しない。共通tipを使う。失敗時にセットアップ成功の案内を出さない。検証は成功result・GUI・setupを対象とする。PR送信手順は[還元workflow](../../Workflows/Development/CONTRIBUTE.md)。
