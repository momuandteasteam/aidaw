# マスタリング

読む条件: `kind=mastering` の曲・アルバムを処理するとき。対象確認と確定は [EDITING](../EDITING.md) に従う。

- アルバムの曲一覧と曲ごとの不変な処理版を持つ。選択した曲・版だけを一つのステレオ経路へロードする。トラック数で用途を推測しない。
- 各版の原音、FX順序、保存状態、入力ゲイン、範囲、末尾条件を完全に保持する。曲切替で直前の曲の設定を継承しない。
- `current` は編集基点、`accepted` は納品候補、A/Bは試聴参照。版作成は `mastering_create_version`。比較割当で採用版を変えない。
- A/Bには任意の保持版を指定できる。試聴しただけで音質評価済みと記録しない。選択版と正本revisionを区別する。
- 書き出しは曲単位／アルバム全体を明示する。A/B試聴先を暗黙の納品版にしない。2mix原音から楽器別stemやMIDIを生成できると偽らない。

版参照の仕様が必要なときだけ [DOCUMENTS](../../Docs/Contracts/DOCUMENTS.md) / [HISTORY](../../Docs/Contracts/HISTORY.md)。新たに音源を選ぶ場合だけ [SOUNDS](../Composition/SOUNDS.md) を読む。
