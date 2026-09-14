# 正本・差分履歴・可搬保存

読む条件: 作品更新、revision、復元、asset保持、保存・ZIP import/exportを変更するとき。
正本範囲: WorkspacePortの意味、確定点、保持版、作業領域とarchiveの関係。
関連要件: R-005, R-006, R-011, R-013。

## 作業正本

Projects/&lt;project_id&gt;/のproject.jsonとstate/historyが正本。project.jsonのenvelopeは現在の文書、公開history head、冪等性receiptを持つ。state/composition・state/mastering・state/separationのJSONは現在ビューで、独立して編集しない。

assetsは原音・参考音源・artwork、jobsは要求・処理記録・途中成果、outputsは完成出力、tempは未確定作業。素材索引はmanifest.json。履歴・原音・保存plugin stateをcache掃除で失わない。配置は [DIRECTORIES](../Architecture/DIRECTORIES.md)。

WorkspacePortはcreate、read、readRevision、history、list、changeを持つ。filesystemの実装はNodeWorkspaceが所有する。changeの準備処理は現版の複製から次版を作り、ID一致とrevision増分を検証してから確定する。

## 一回の編集と復元

1. 正本からbase_revisionを得る。一意なrequest_idと変更内容のfingerprintを持つ要求を作る。
2. 作品lock内でreceiptを確認する。同じID・同じ内容は既存結果を返し、版を増やさない。同じID・異なる内容は失敗。
3. 現在revisionとbase_revisionが一致しなければ失敗。最新内容へ勝手に再適用しない。
4. operationとplugin保存状態を検証し、差分・objects・必要なcheckpointを準備する。
5. project.jsonを原子的に置換して公開headとreceiptを確定する。その後に派生ビューとjob状態を更新する。

一回の編集命令は可能な限り一つのatomic applyで確定し、意図をsummaryへ残す。複数回のAPI commitを一つの原子的変更と表示しない。確定後のビュー更新失敗を理由に新request_idで同じ編集を再実行しない。

project_restoreは保持版を解決し、その内容を新revisionへ保存する。復元元を記録し、復元前の版も保持する。過去commitの上書き・切捨てではない。試聴用の過去版読み取りはheadを更新しない。

## 履歴形式

state/history/revisionsは親・hash・要求ID・summaryを持つJSON差分、checkpointsは再構成の基準、objectsは内容hashで共有する不透明データ。ID付き配列をID別構造へ正規化し、局所編集で未変更演奏を全量複製しない。plugin stateの内部を解釈して独自の意味差分にしない。

checkpoint間隔は50版。保持版はcheckpointと差分から解決し、内容hashを検証する。未公開headより先のcommitを正式履歴として列挙せず、壊れた差分を飛ばして別の音を再生しない。旧履歴を読む場合は実在する到達可能な範囲だけを移行し、不足版を捏造しない。

履歴の状態とrender cacheは別物。cacheは対象revision、song/track範囲、source、plugin state、engine identity、処理条件で区別する。過去版から参照される原音・state objectを「古いcache」として消さない。

## 持ち出しとimport

project_saveは両kind共通の作品名.aidaw.zipを作る。日常編集は展開済みProjectsで行い、保存にrender成功を必須としない。archiveのpackage.jsonは作品形式のmanifestであり、アプリのCore/package.jsonとは別物。

現行package schema 2はkind、revision、history head、entry hash/sizeを保持する。現版、保持履歴、objects、登録asset、mode別ビュー、作品規約を収集する。jobs/work/logs、temp、認証、device設定、plugin binary・ライセンス認証・外部sample libraryを再帰同梱しない。include_audioは対応する凍結音声を加える明示オプションであり、全納品物や全過去renderの収集を意味しない。

保存対象headを固定し、partial出力の完了後に最終名へrenameする。自身や過去ZIPを再帰同梱しない。importはstagingで構文、許可entry、hash、size、履歴、asset参照を検証してから新しいIDへ公開する。path traversal、symlink、大小文字/Unicode衝突、重複entry、欠損・未知形式を拒否し、既存作品を上書きしない。

新IDへのimportはrevision番号と編集内容を保持し、最上位project IDの変更に伴う履歴hashを再構成する。元IDをorigin_project_idへ記録する。旧package schema 1の読取を、全世代履歴の復元と報告しない。

現在のimport予算は圧縮512 MiB、展開合計1 GiB、単体entry 512 MiB。展開はメモリ上で行い、ZIP64・暗号化・分割ZIPは未対応。トラック数上限撤去を、無制限archive展開の許可と扱わない。外部コードの扱いは [SECURITY](../Development/SECURITY.md)。

## 実装と確認

実装: Core/Source/Adapters/node/workspace/ のnode-workspace.ts、history.ts、package.ts、project-views.ts。

[history試験](../../Core/Tests/history.test.mjs)、[archive試験](../../Core/Tests/archive.test.mjs)、[workspace-port試験](../../Core/Tests/workspace-port.test.mjs) を変更範囲に応じて確認する。実行根拠は [VERIFICATION](../Development/VERIFICATION.md) の関連要件行。作品内規約を変える場合は [PROJECT_RULES](../../Workflows/Templates/PROJECT_RULES.md)。

Design status: ready

読取時のschema初期値追加を履歴の親状態に混ぜない。changeは保存された未加工文書をhash比較・差分の親に用い、編集準備にはparse済み複製を渡す。初期値は次の正式commitに含め、過去hashを書き換えない。variants欠損の分離作品を更新・再読込し、旧版の完全保持と実データ改変の拒否を回帰検証する。
