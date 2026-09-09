# AI DAW v2 実装仕様と運用

2026-09-09。設計案の主要機能をMCP/APIとネイティブエンジンへ実装した。音声モデルの接続先設定は持たず、呼び出し元が試奏音声を確認して評価を返す。

## 保存と時間

新規projectはschema_version 2。schema_version 1も読み込める。プロジェクト内は assets / state / jobs / outputs / temp の5ディレクトリ。編集履歴と処理途中のファイルはjobs内に集約し、元の素材や既存のマスタリング成果物を自動移動・削除しない。

project.jsonは編集状態と冪等性receiptを含む。manifest.jsonは素材のID、SHA-256、役割、相対パス、来歴を持つ。asset_importはコピー収集、asset_relinkは元と同一ハッシュの素材だけを復旧する。sourceとreferenceは別の役割で、referenceから派生した音声もレンダー入力として拒否する。

MIDIはPPQ 960。音声のduration_frames、start_frame、end_frame、timeline_frame、fade_in_frames、fade_out_framesは48 kHzのフレーム数を10進文字列で表す。音声長のための仮テンポは不要。終端は既定で原音全体、fadeは0。プロジェクト長が音声を暗黙に切る場合はエラー。編集する場合はedit_audio_clipで明示する。

音声の中央パンはステレオバランスとして音量を保持する。MIDI楽器は従来の等電力パン。noteのdisplay_pitchとpurposeを使えば、発音用MIDIと、キースイッチを除いた譜面用MIDIを分けて書き出せる。

## 音声生成と完成出力

render_startは不変revisionから次を作る。

1. 楽器の実演奏を一度だけ32bit floatへ録音する。
2. その録音にトラックFX、ゲイン、パンを適用し、mix contributionを作る。
3. post-fader sendを合算して共有FXバスを処理し、FX returnを独立ステムにする。
4. contributionとreturnを合算しpremasterを作る。別の比較処理でステム合計との誤差を検証する。
5. master FXを一度だけ適用して24bit WAVを作る。

楽器を再演奏して別々のステムを作る方式ではない。非決定的なプラグインでも完成ミックスとステムは同じテイクを共有する。ノート開始、最終フレーム、トラック・楽器・masterの静的遅延補償を回帰テストで検証する。処理中に遅延が変わればエラーにして再実行を求める。

トラック／master／共有FXのパラメーターは、tickまたはframeによるautomationに対応する。制御更新間隔は最大64サンプル。ホストに公開されないGUI操作を対応済みとは扱わない。

成功した全体レンダーはstate/frozenにも収集する。ソロのレンダーは全体の凍結再生を置き換えず、完成ミックスとしてpublishできない。

delivery_publishはWAV、premaster、ステム、MIDI、タグ付き320 kbps MP3、レポート、可搬project ZIP、配布ZIPを固定outputsへまとめる。2mix入力では楽器別ステムを捏造せず、生成不能な理由をmanifestへ記録する。MP3はタグを再読込し、指定された場合は画像の埋め込みも確認する。更新journalで旧版を保存し、失敗時は復旧する。delivery_recoverは中断した公開を復旧する。

batch_renderは複数曲を一つのjobで処理する。素材、設定snapshot、attempt、完了ファイルのハッシュを記録し、batch_render_resumeは成功済みを再生成しない。batch_delivery_publishは全曲のWAV／MP3／レポート／ZIPを同時に採用する。各曲の長さと終端設定は独立で、参考音源の位置を処理対象へ自動転用しない。

audio_analyzeはsample peak/RMS。audio_measureはFFmpegによる入力LUFS・true peak・LRAで、音声を変更しない。測定上使うフィルター設定は納品音圧の目標ではなく、-14 LUFSへの正規化を強制しない。技術検査と音楽的な聴取評価は別の状態にする。

## 可搬性

bundle_exportはmanifestから素材と確定テイクを収集する。jobs、temp、outputs、過去ZIPを再帰的に入れない。選択したpluginのmetadata snapshotを含み、プラグイン本体・認証・外部サンプルライブラリは同梱しない。

bundle_importは新しいIDへ取り込み、相対パス、Windows禁則名、Unicode／大文字小文字の衝突、展開量、ハッシュ、必須項目を検査する。未知の形式・依存は黙って捨てない。project_validateは必要プラグインの解決状況と凍結音声のパスを返す。プラグインのない状態で元プロジェクトを削除した後でも、取り込んだ凍結音声を再生できることをテストする。

現在のZIP読込上限は圧縮512 MiB、展開合計1 GiB、単体512 MiB。巨大アーカイブのストリーム展開・RF64は今後の対応。大きい成果物はプロジェクトフォルダをコピーできるが、プラグインのインストールまで可搬になるわけではない。

## 音色とエフェクトのDB

共通DBは PluginLibrary.aidaw/state/catalog.sqlite。プラグインのホスト用登録情報もこのライブラリへ保存する。旧catalog.jsonは読取互換を残す。音色・parameter・評価・互換性・ユーザー好みは、それぞれ根拠を持つ追記レコードで保持する。

- catalog_index: plugin/preset情報を差分登録。
- effect_index / parameter_annotate: 公開パラメーターと、根拠付きの意味の対応を保存。normalized値を勝手にHz/dBへ線形変換しない。
- sound_probe / instrument_probe: プリセットを実際に発音。短い複数音高のフレーズと音声hashを返す。一括試奏は一つのjobで失敗分を再開できる。
- effect_probe: 短い入力にFXを適用し、処理前後の音声と、全区間RMSで近似的に音量を揃えた比較音声を返す。
- sound_audition_in_context: プロジェクトを変更せず、曲中のMIDIパートに候補を適用して試奏する。
- sound_assess: 呼び出し元が返した評価と音声hashを照合し、保存する。caller_audio_review、metadata_inference、human_audio_reviewを区別する。
- sound_search / effect_search / knowledge_search: 根拠を残したまま検索。登録の存在とrender互換性の認定を区別する。
- plugin_verify: 分離プロセスでload、state readback、楽器の再レンダー比較を行い、版・OS・CPU・binary/engine hashと一緒に記録する。
- catalog_feedback: 対象レコードに紐づく好みを保存。一曲の感想から全pluginの禁止規則は作らない。

試奏cacheはplugin binary、engine、state、音高・velocity・tempo、sample rate・block・profile版を含む。検証できないbinaryでは再利用しない。cacheは確定音声の再利用であり、再演奏の一致を保証するものではない。音声確認そのものをサーバーから独立に証明はできないため、呼び出し元の申告として明示する。

## 現在の対応範囲

macOSのAU/VST3とWindowsのVST3を共通C++/TypeScript実装で扱う。GitHub CIはmacOSで実行し、Windowsは別途実機で検証する。今回の実行検証はmacOSで行い、Windows商用プラグイン実機の成功とは区別する。

48 kHz、ステレオoffline、固定tempo、1段のpost-fader sendが現在の範囲。sidechain、bus-to-busの任意routing、可変tempo、CC、他sample rateの自動変換、リアルタイムtransport、ベクトル類似検索は未対応。非対応はstrict schemaまたは明示エラーにし、対応済みとして扱わない。通常の音色・用途検索は登録済みの文とタグの検索で実装する。

project_cleanupは成功jobのworkに限定し、素材・凍結・候補artifacts・失敗jobを保持する。プロジェクト外の素材や既存成果物は変更しない。


## 実行した受け入れ確認

- ネイティブC++とTypeScriptのビルド成功。
- `npm test`: 37件中34件成功、条件付き商用試験3件を通常実行ではskip。
- `AIDAW_TEST_NI=1 AIDAW_TEST_BBE=1 node --test tests/ni.test.mjs`: パーサーとMASSIVE、MASSIVE X、BBEの計4件成功。MASSIVE Xは実際のプリセット状態から音声を生成。
- effect_probeの音量比較音声追加後に、DB・一括試奏／再開・互換性・FX比較・LUFS測定の3件を再実行して成功。
- 原音全サンプル保持、局所フェード前の不変、共有FXを含むstem合算、遅延補償、ZIP自己包含防止、元project／catalogなしの凍結再生、タグ再読込、publish中断復旧、batch取消、100回編集時の固定ディレクトリ、譜面／発音MIDIの分離を含む。

Windows実機での動作、Windows商用プラグインの実機動作、生成音色の音声AI聴取評価は、この検証結果には含めない。


## ミキサー追加実装

[内部ミキサー仕様](MIXER_GRAPH.md)に、パート単位の差分レンダー、pre/post send、return strip、mute/solo、MIDI読み込みを追記。従来のpost-fader限定からpre-faderにも対応した。通常テストは40件中37件成功、商用条件付き3件は別実行で全て成功。追加したミキサー3件は、その後のキャッシュ識別改善後にも成功。
