# 作品を編集する

読む条件: 作品を作成・編集するとき。本体コード・文書・設定だけの変更には適用しない。

新規作品はkindを明示して `project_create` し、返されたIDを明示対象として手順2へ進む。既存GUI選択へ新規制作を適用せず、未選択だけを理由に新規作成を止めない。

1. `active_context_get` でGUIのproject_id、song_id、version_id、comparisonと正本revisionを取得する。ユーザーの明示対象を優先する。未選択を任意作品への編集許可にしない。
2. `project_document` で対象の正本を読む。試聴中の `selected_revision` を編集元に使わない。新規作品は `kind` を明示する。
3. 変更を組み立て、確定直前に選択を再取得する。対象が変わっていたら別作品へ誤適用しない。曖昧なときだけ対象を確認する。
4. 正本の `base_revision` と一意の `request_id` を指定し、`project_apply` 等で確定する。同じ要求の再送は同じID・内容を使う。意図はsummaryへ記録する。複数コミットを一回の原子的変更と呼ばない。
5. 戻り値と正本revisionを確認する。競合時は正本を再取得し、変更を再計算する。選択とcommitの原子的照合は未実装であり、直前の再確認だけで競合が完全に防げるとは扱わない。

正本は `project.json` と `state/history`。現在ビューやjob snapshotを直接上書きしない。保持版へ戻すときは `project_restore` で新revisionを作り、過去版を削除しない。

`project_save` は素材・状態・履歴を含む `.aidaw.zip` を作る。作業正本はProjects内のディレクトリ。`project_open` は新IDへ復元する。音声書き出しは対象・形式・版を固定し、job成功・出力hash・codecを確認して完了とする。参考音源を原音の代わりに使わず、原音・演奏・FX状態・履歴をcacheと一緒に削除しない。

追加で読む条件:
- 曲制作の状態を変える: [PRODUCTION](Composition/PRODUCTION.md)
- マスタリングの曲・版を変える: [MASTERING](Mastering/MASTERING.md)
- API仕様が必要: [APPLICATION](../Docs/Contracts/APPLICATION.md)
- 保存・復元の詳細が必要: [DOCUMENTS](../Docs/Contracts/DOCUMENTS.md) / [HISTORY](../Docs/Contracts/HISTORY.md)

ステム分離の依頼はkind=separationで作成し、[分離契約](../Docs/Contracts/SEPARATION.md)に従いsourceをimportしてseparation_startを呼ぶ。分離後も通常の対象確認・revision指定を守る。
