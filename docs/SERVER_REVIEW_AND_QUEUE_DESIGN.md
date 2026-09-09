# 音楽生成・マスタリングサーバーのレビューとジョブ設計

2026-09-09。実装コード、共通試験、HTTPの二つのクライアント、インストール済み商用音源で確認した。以下では「現在の実装」「今回修正」「次に実装する設計」を区別する。

## 結論

音声処理の中核はサーバー用途に適した分離になっている。演奏・FX・ミックス・PDC・状態保存・納品を共通本体で実行し、stdioとHTTPで同じ結果を得る。作品ごとの回避スクリプトへの依存は除去した。

追加指示に従い、通常レンダーの同時4件制限を廃止し、共通FIFOキューで音声処理を常に1件にした。完成曲の取得・状態照会は音声キューと別。接続・受付は並行、追加生成・変換は順番待ち。CPUが空いていても並列数を増やさない。

同じ保存先へのHTTP/stdioサーバー二重起動も拒否する。ただし永続キューの再起動復旧と利用者ごとの権限分離は未完成であり、現段階は単一所有者が管理する遠隔実行サーバー。

## 1. レビューで残った課題（重要度順）

### 修正済み：全処理の単一実行枠

src/processing-queue.tsのFIFOに、render/batchの全pipeline、試奏・scan・状態保存・FFmpeg・納品準備を統合した。ネイティブEngine呼出しも同じ枠に属し、内部の入れ子呼出しは同じ実行として扱う。通常renderはqueuedのjob_idを返し、待機中にもcancelできる。待機上限200件。

現在のbatchは全体を1jobとして順に処理する。曲間で他projectへ順番を譲る公平化は今後の設計。実行キューはメモリー内で、job状態とsnapshotのみディスク保存。queue_statusで実行中/待機中を表示する。

delivery_inspect、project_list、job_status、GET /filesは音声枠を取得しない。既存MP3/WAV/ZIPの取得はすぐ開始し、新しい変換・ZIP作成は待機する。配信先の各ファイルは検証済み一時ファイルをrenameして置換する。複数ファイルを同じ版で受け取る用途には完成ZIPを使う。

### P1：再起動・クラッシュ後の状態回復が不十分

根拠：`src/service.ts jobStatus` はPIDの生存確認を使用し、`src/storage.ts locked` はディレクトリロックを使用する。実行者はメモリー上のMapで管理する。

起こり得ること：PID再利用で古いrunningが残る、電源断後のロックが残る、クライアントがjob_statusを呼ぶまで失敗判定されない。成功済みバッチ部分の再利用はあるが、サーバー起動時の統一した復旧処理はない。最終status書き込みがディスク満杯で失敗したときも永続状態の確定を保証できない。

必要な対応：永続ジョブ表、起動ごとのowner UUID、lease/heartbeat、attempt ID、復旧スキャンと中断状態を導入する。PIDだけを所有権としない。

### 修正済み：同じ保存先のサーバー二重起動

src/server-lease.tsでHTTP/stdioサーバー起動時に保存先の所有権を取得し、二重起動を拒否。正常終了で解放する。異常終了で残ったserver.lockは旧プロセス停止を確認して手動復旧する。複数端末は同じHTTPサーバーへ接続する。単独CLIによる直接処理は保守用途であり、稼働サーバーと併用しない。

### P1：多人数向けの認証・権限分離はない

HTTPのBearerは単一所有者の資格情報。APIはプラグインやサーバーファイルを読み込む機能を持ち、ジョブ・プロジェクト単位のアクセス制御はない。

必要な対応：単一所有者の複数端末利用と、別々の利用者へのサービス提供を分ける。後者では認証principal→project権限→job/asset/出力権限を全APIで強制する。パスを直接渡せる操作を管理者操作へ限定する。

### P2：長い同期要求と保守操作との競合

同じMCPサーバーの編集は共通枠で順次実行する。ただしplugin状態保存は依然project lock内であり、直接Serviceを使う保守処理等との競合では待ち期限を超える場合がある。同期試奏・計測・納品は、キュー待ちが長いと通信側がタイムアウトする可能性がある。これらも永続job_idを即時返すAPIへの移行が必要。

必要な対応：長い処理をjob化し、状態捕捉をrevisionスナップショットから行う。最終commitだけ短いロック/DB transactionでrevisionを比較する。競合時に結果を黙って最新作品へ適用しない。

### P2：運用監視・容量・転送の制限

空き容量の予約、全体のリクエスト本文メモリー上限、CPU/RAM使用量による受付抑制、プラグイン隔離リスト、全job履歴一覧がない（実行中/待機中はqueue_statusで表示可能）。upload/bundleには512MiB制限があり、大きな作品全体を移す運用には不足することがある。Range/再開転送も未対応。

必要な対応：資源上限、保持期間、監視メトリクス、ダウンロード途中再開、ファイル単位の転送を設計に含める。作品素材と確定テイクは自動清掃の対象にしない。

## 2. 今回修正した不整合

- 個別レシピの保存後readbackを `capturePluginState` に統合。別ワーカーでパラメーターを再指定せず復元し、指定した値が保持されたか確認する。
- 納品準備で `exportMidi` が既存outputsを書き換えていた。job artifactsに固定revisionから生成するよう変更。準備中の失敗で前回納品MIDIが変わらないことを回帰試験で確認。
- 納品の最終commit時にproject lock内でrevisionを再比較。準備中に編集された古い結果を現行納品として適用しない。
- バッチのstatusがowner_pidを失っていたため保存するよう変更。PID方式自体の限界は上記のとおり残る。
- バッチ再開時に成功済みファイルが消失していると全体が例外終了していた。hash確認失敗を再処理へ回すよう変更。
- バッチの処理後にも入力assetのハッシュを再確認。途中で変化した原音を正常結果として扱わない。
- renderの最終status書き込み失敗時でもメモリー上の実行枠を解放し、未処理Promiseでサーバーが終了しないようにした。永続状態復旧は別途必要。

## 3. 永続ジョブキューへの拡張設計（永続化・自動復旧は未実装）

### 保存先と表

固定構成を守り、`AIDAW_HOME/Server.aidaw/state/jobs.sqlite` にSQLite WALを置く。同一ホスト・ローカルディスク・単一coordinatorを前提とする。ネットワーク共有上のSQLite運用や分散workerはこの段階では行わない。

- jobs：id、kind、project_id、principal_id、request_id、payload_hash、revision、snapshot_hash、状態、priority、受付時刻、開始/終了時刻、attempt数、キャンセル要求、必要資源、エラーコード。
- attempts：job_id、attempt_id、owner_boot_uuid、lease期限、heartbeat、worker PID、使用plugin fingerprint、ログ/成果物パス。
- events：job_id、連番、遷移、時刻、理由。クライアントの再接続で未受信分を取得する。
- artifacts：job/attempt、種類、相対パス、bytes、sha256、検証状態。確定したものだけダウンロード/納品対象。
- plugin_health：製品ID、版、binary hash、platform/arch、直近クラッシュ、同時実行可否、隔離状態。

作品の素材・render snapshot・work・artifactsは従来の `projects/<id>/jobs/<job_id>/` に置く。coordinatorの設定を作品の中へ重複保存しない。

### 受付と冪等性

1. 認証、権限、サイズ、schema、受付上限を検証。
2. project revision、asset hash、プラグイン版・保存状態、処理指定を固定する。
3. `(principal_id, project_id, request_id)` を一意制約にしてtransactionでjobを保存。同じpayloadの再送は同じjob、異なるpayloadは競合エラー。
4. job_idと `queued` を直ちに返す。受付したと言う前に永続化を終える。
5. source大容量転送は別upload job。完了・検証済みassetから計算jobを作る。

初期値案：全体200件、project当たり20件まで待機。超過時はqueue_fullと再試行目安を返す。大量の音声や状態をメモリーに溜めてから拒否しない。数値は負荷試験で調整する。

### 状態遷移

```text
queued → preparing → running → validating → succeeded
   │          │          │          │
   └──────────┴──────────┴──────────┴→ failed
   └→ cancelled
running → cancelling → cancelled
lease喪失 / 再起動 → interrupted → 明示的なretryでqueued
不足素材 / 認証 → blocked_dependency → 解決後に明示的なretry
```

成功とは、処理終了に加えて出力の再読込・フレーム数・ハッシュ・必要ステムの検証が終わった状態。音質の試聴評価は `listening_status` として分離する。成果物の納品採用は別のpublish job。

### 順次実行と並列実行

| 種類 | 初期方針 |
|---|---|
| job状態照会・小さい検索 | 音声キューと分離し、すぐ応答 |
| ソフト音源render・FX・試奏・scan・状態捕捉 | 全て共通の処理枠。常に1worker |
| FFmpeg計測・MP3・ZIP/hash | 新規計測・変換・ZIP作成は共通枠で順番待ち。既存ファイル取得は別 |
| 同じ作品の音声job | 一度に1job。revisionを固定した編集・次job受付は可能 |
| 別作品のjob | projectごとのround-robin、同project内はFIFO |
| batch | 1曲を子jobとして処理し、曲間で他projectへ順番を渡す |
| 同じpipeline内の段階 | 演奏→insert→send/return→mix→masterの依存順。成果物再利用で不要部分を省く |
| 納品・採用 | project当たり排他。最新revisionまたは明示した版の採用のみ |

音声処理はプラグインに関係なく常に1件。別の曲を並列実行しない。プラグイン自身の内部スレッド数は別であり、ホストから勝手に変更しない。

プラグインの互換性とクラッシュ履歴は版・バイナリー・OS/CPU単位で保存する。MASSIVE Xのような制約を作品ファイルのsleepで解決しない。必要ならサーバー全体の排他resource keyを取る。

### 中断・例外・再試行

- coordinatorは起動UUIDで識別。10秒間隔heartbeat、60秒leaseを初期値とする。期限切れのattemptは成果物を確定できないようfencing tokenを検証する。
- 通信切断は計算キャンセルとしない。クライアントはjob_idで再取得する。
- cancelは永続フラグを立て、まずcancellingを返す。待機jobは即時cancel、実行中workerは停止し、未確定ファイルだけ削除。完了済み子jobは保持する。
- プラグインクラッシュ/認証失敗/不正入力は自動再試行しない。繰り返しクラッシュする同じfingerprintを隔離し、管理者の解除を要する。
- 一時I/O失敗の自動再試行は回数制限付き。ディスク不足は空き容量確保まで再実行しない。元音声・成功済み結果を容量確保のため勝手に削除しない。
- 再起動時、期限切れattemptはinterruptedとして確定。既存出力hashと段階検証から再利用可能な部分を判定する。古い未完成音声を成功扱いしない。
- pluginの版/asset hashが変わった場合、元jobのretryで新しい音へ黙って置き換えない。依存解決または明示した新jobを要求する。
- publishは準備→検証→revision照合→短い確定transaction。障害時は前回releaseを保持。大きなコピー中の長いproject lockを避けるため、将来はimmutable release directory＋current manifest参照切替へ移行する。

### 管理API

`server_status`、`queue_status`、`job_list`（project/状態/種類/ページ）、`job_status`（段階・実測進捗）、`job_cancel`、`job_retry`、`server_drain`（受付停止・現在job完了待ち）、`plugin_health` を提供する。

割合進捗は既知フレーム数など計算可能な場合のみ返す。未知のロード時間に架空の進捗を作らない。待ち順は参考値で、所要時間の保証ではない。

## 4. 実装順序と受け入れ試験

1. **永続ジョブ表・single coordinator・復旧**：受付直後のkill/restart、重複request_id、PID再利用、古いattemptの確定拒否を試す。
2. **全処理のscheduler統合**：render/batch/probe/inspect/FFmpeg/ZIPを混在させて、設定上限を超えるworkerが出ないことを確認。
3. **公平性とキャンセル**：長いbatch中に別作品の試奏を入れ、曲間で実行機会があること、queued/running双方のcancelを確認。
4. **容量・入力・プラグイン例外**：ディスク満杯、音源クラッシュ、素材消失、版更新、破損ZIP、転送中断でも成功を誤報しないことを確認。
5. **採用・権限**：同revisionの別テイク、編集中のpublish、同じ出力先への競合、他principalのjob/assetアクセス拒否を確認。
6. **負荷試験**：音声処理1件のまま同時受付・完成曲ダウンロードを増やし、処理の非重複と取得応答・RAM/I/Oの上限を確認する。

キュー永続化・復旧・利用者の権限分離を実装するまでは、不特定の接続元に開放する運用を完成扱いしない。現行HTTP機能の実装完了と、上記scheduler設計の実装完了を混同しない。
