# 音源・音色を選ぶ

読む条件: 制作に使う音源・プリセットを新規選定または変更するとき。既存音色を変えない編集では読まない。

1. `catalog_search`で手元の登録情報、`catalog_reference_search`で共有された製品・版・OS/arch別パラメーターを必要な分だけ検索する。参照JSON全体を読まない。情報が揃っていれば全体索引を繰り返さず、未登録候補だけ`catalog_discover` / `catalog_scan`で確認する。参照はホスト公開情報であり、意味や動作の保証ではない。不一致・不足は対象だけ`plugin_inspect` / `effect_index`で確認する。
2. Kontakt、Reaktor、Battery等はホスト名だけで決めない。`content_discover_roots` → `content_index` → `content_search` でライブラリ・パッチまで調べる。追加保存先は `content_register_root`。部分スキャンや未確認の保存先を明記する。
3. 曲調、役割、奏法、音域で候補を比較し、保存プリセットを `sound_probe` / `sound_audition_in_context` で試す。呼び出し元AIが音声を確認し、選定理由と正確なプリセット・状態を記録する。未確認なら聴いたと書かない。音声評価を別プロバイダーへ切り替える機構は不要。

Apple DLS、QuickTime、GM、内蔵簡易音源へ便利だからという理由で逃げない。明示された音色希望、テスト・スケッチ用途のみ `instrument_policy=allow_basic` を使う。指定音源のロード失敗を避けるために緩めない。

手持ち音源がない環境または標準音源希望時は、標準AIDAW GM（FluidR3）を `plugin_first` のまま明示的に選べる。先に利用可能な音源と内部ライブラリを比較する方針は維持する。

ファイル発見はロード成功でもライセンス確認でもない。NKI/NKSN等は対応adapterまたは確認済み保存状態でロードし、未対応形式をJUCE状態として渡さない。代替が必要なら適性を比較して理由を明記し、黙って置換しない。

作品へ反映するときは [EDITING](../EDITING.md)。プラグイン導入・adapter実装を変更するときだけ [EXTENSIONS](../../Docs/Contracts/EXTENSIONS.md) を読む。
