# 作品文書の意味

読む条件: 曲制作/masteringのモデル、operation、時間、compileを変更するとき。
正本範囲: mode別の正本文書と不変条件。保存媒体・履歴は [HISTORY](HISTORY.md) が所有する。
関連要件: R-003, R-004, R-006, R-013。

## 共通

新規文書はschema_version 3でkindをcomposition、mastering、separationから明示する。id、name、revision、instrument_policyを持つ。トラック数、ファイル名、拡張子からkindを推測しない。実行用graphと作品正本を同じ型として扱わない。

具体的な入力型は [domain](../../Core/Source/Domain/domain.ts) と [schema](../../Core/Source/Domain/schema.ts)。旧schema 1/2の読取はcompositionとして扱い、音声だけの旧作品をmasteringへ黙って変換しない。文書版、archive版、engine版は独立して識別する。未登録の版変換や不透明plugin stateの推測変換をしない。

## Composition

compositionはtiming、tracks、buses、master_effects、sections、harmonyを持つ。MIDI trackは具体的notesとinstrument、audio trackはassetとclip範囲を持ち、それぞれinsert FX、gain、pan、mute/solo、sendを保持する。returnはbusとしてFXとlevelを持ち、masterへ合流する。

track、note、bus、plugin parameterの参照は安定IDで解決する。存在しないsend先、ID重複、不正な時間・音高・値を拒否する。配列位置や表示名をIDの代わりに使わない。

トラック数に固定の製品上限を置かない。実際のメモリや処理能力不足を失敗として返し、trackを切り捨てたり音源を無断代用したりしない。これは全データ項目や資源予算が無制限という意味ではない。FX数等の現在の入力制約はschemaを確認する。

MIDIはPPQ 960、音声時間は48 kHz frameを10進文字列で表す。音声clipのstart/end/timeline/fadeを明示し、プロジェクト長で原音を暗黙に切らない。原音の終止を推測して曲中から長いfadeを加えない。表示音高と発音音高、keyswitch用途を区別する。

sourceとreference/artworkのasset役割を保ち、参考音源をrender入力へ代用しない。音色・奏法・終了位置・目標音圧等の曲固有値は作品へ記録し、共通処理へ埋め込まない。

## Mastering

masteringはsong_orderとsongsを持つ。各songにはversions、current_version_id、任意のaccepted_version_id、comparisonのA/B割当がある。曲順には各song IDが一度ずつ現れる。

各versionは不変の完全な処理設定を持つ。原音asset ID/hash、clip、duration、tail、input gain、順序付きeffectsと保存状態を保存する。変更は新version IDを作る。parent_version_idは同じ曲の保持版を参照し、自己参照や循環を許さない。曲切替で直前曲の未指定parameterを継承しない。

| 値 | 意味 |
|---|---|
| current | 次の編集・通常選択の基点。新version追加で更新される |
| accepted | 納品候補。明示した採用操作で更新する |
| comparison.a / b | 同じ曲の任意保持versionまたは原音への保存済み割当 |
| GUIのA/B選択 | 今どちらを試聴するか。割当やacceptedを書き換えない |

A/Bの割当変更は正本operationとしてrevisionを作る。一方、割当済みA/Bへ試聴を切り替えるだけでは作品revisionを増やさない。比較先を変更してもacceptedを変更しない。版を選択・再生したことを音質評価済みの根拠にしない。

選択song/versionだけを一つのstereo sourceとFX chainへcompileする。アルバムの全曲を同時に鳴るtrackとして保存しない。source比較では基準versionの範囲とtimelineを保ち、input gain、FX、clip fadeを迂回する。任意の別原音や全ファイル長へ無言で切り替えない。

## compileと変更の確認

[mode-compilers](../../Core/Source/Domain/mode-compilers.ts) がmode文書から実行用graphへ変換する。masteringの仮tempoや一つのaudio trackは変換の内部表現であり、作品の制作モデルではない。

現在の単曲durationはtail込み30分、sample rate・tempo等の実行制約は [ENGINE](ENGINE.md)。アルバム総時間と単曲制約を混同しない。納品対象の選定は [APPLICATION](APPLICATION.md)。

検証入口は [domain](../../Core/Tests/domain.test.mjs)、[project](../../Core/Tests/project.test.mjs)、[history](../../Core/Tests/history.test.mjs)。根拠・残る制約は [VERIFICATION](../Development/VERIFICATION.md) の関連要件行を読む。制作手順は [PRODUCTION](../../Workflows/Composition/PRODUCTION.md)、[MASTERING](../../Workflows/Mastering/MASTERING.md)。

## Separation

Design status: ready

分離作品はcomposition graphを音声stemの再生・mixへ再利用する。追加の来歴とAPI・出力・検証は[SEPARATION](SEPARATION.md)を正本とする。kindを分離完了の有無やtrack数から推測しない。
