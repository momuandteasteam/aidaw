# 共通処理の統合監査 — 2026-09-09

旧曲別スクリプトと現行本体を照合した。ホストの互換性修正は曲データや個別レシピから独立して動く。stdio / HTTPの双方が同じ本体APIを呼ぶ。

| 過去の問題 | 現在の処理場所 | 検証・境界 |
|---|---|---|
| MODO DRUMがprepare後に遅延を報告 | native/Engine.h Chainと共通PDC | prepare後に取得、経路整列、先頭遅延除去、末尾追加処理。音源名で固定サンプル数を決めない |
| MODO BASSの初回発音欠落 | native/Engine.h Chain::add | 2.0.5の開始前無音prime。実機でtick=0の発音と出力長を確認 |
| 並列トラック・insert・masterのずれ | native/Engine.h、src/mixer.ts | 合計遅延補正、段階ごとの整列。検証音源で基準波形と比較 |
| 処理中に遅延値が変わる | native/Engine.h Chain::process | 検出して停止。動的追従は未実装 |
| MASSIVEのcontroller変更が保存されない | native/Engine.h inspect | 無音ブロックで反映して保存、実機readback |
| MASSIVE Xの無音・Qt終了競合 | native/Engine.h load / PluginDeleter | 1.7.1 (R0)に限定した非表示ビュー、待機、ワーカー終了処理。固定待機であり汎用ready検出ではない |
| 複数NI音源の同一プロセス競合 | src/mixer.ts、src/engine.ts | 各演奏/FX段階を分離したワーカーで実行 |
| BBEの値が保存状態に反映されない | native/Engine.h load | 4.7.1に250msメッセージ処理。パラメーター再指定なしの復元を実機確認 |
| 個別レシピだけにあった保存後readback | src/service.ts capturePluginState | 今回共通化。savePresetと全track/bus/masterのfreezeで、明示的に編集したパラメーターを別ワーカーで状態のみ復元し照合。消失時は保存を失敗させる |
| MODO音色の公開パラメーター不足 | native/ModoBassPreset.h、src/service.ts | 2.0.5 VST3向けmb2アダプター。別製品/版への推測適用を拒否 |
| MASSIVE XのNKS読み込み | src/nks.ts、src/service.ts | 製品ID/コンテナ/対応版を検査 |
| Kontakt 8のNKI/NKSN読み込み | native/KontaktPreset.h、native/Engine.h、src/service.ts | Windows VST3 8.13.0に限定。一時エディターへのOSファイルドロップ後、発音・保存状態・別インスタンス復元後の発音を検査。サンプルstreaming中はメッセージループを進め、短い出力でも内部処理を4秒まで安定化し、releaseResources/DLL終了時の競合をワーカー単位のOS cleanupで隔離 |
| フェーダー・FXの二重適用 | src/mixer.ts | 演奏→insert→fader→send/return→premaster→master。ステム和を検証 |
| 一部だけ直すのに全音源が再発音 | src/mixer.ts、src/fingerprint.ts | 変更下流のみ無効化、確定音声とバイナリーhashを照合 |
| RAWと参考音源の取り違え・暗黙のカット | src/assets.ts、src/schema.ts、src/service.ts | source/reference役割、原音保持、明示的clip/fade範囲、無断の長さ短縮を拒否 |
| LUFS/MP3/タグ/ステムが曲別スクリプト頼み | src/measure.ts、src/delivery.ts、src/batch.ts | 計測・タグreadback・納品・一括ジョブを本体APIで実装 |
| MODOの演奏ピッチと記譜ピッチの違い | src/schema.ts、src/midi.ts | display_pitchとkeyswitch purposeで区別。全プリセットに固定transposeを強制しない |
| 別マシンでローカルパスが読めない | src/http-server.ts | 認証付きアップロード、サーバー処理、出力取得。認証は単一所有者向け |

## 完全実装とは扱わないもの

- Kontaktの別OS・別版への汎用NKI/NKSNロード、コンテナ内の全音色列挙、全プラグイン共通ready判定。
- 処理中の動的PDC、マルチ出力のミックス、CC/サステイン、sidechain、可変テンポ、リアルタイム録音/再生。
- 終止位置の音楽的な自動判定、原音と参考音源の自動時間対応、クリック修復の汎用DSP。
- 曲別に行っていたスペクトル/ステレオ相関の詳細分析、任意プラグインの意味単位変換、ラウドネス目標へ収束する汎用自動マスタリング。

これらを曲固有の処理で動いたことだけで「本体実装済み」と数えない。現行APIで処理条件を指定できることと、その条件をAIが正しく決められることも別。

## ソース整理

曲別制作・比較・後処理スクリプト、旧MCP設定断片ジェネレーター、重複した提案文書を実行ソースから除去。歴史的な修正が失われないよう、除去前の原文をGit対象外の `RepositoryMaintenance.aidaw/jobs/<id>/artifacts/legacy-source.zip` にまとめ、ファイルごとのSHA-256を照合した。

scriptsには自動セットアップと動作確認デモのみ残す。READMEとMASTERING.mdは現行の汎用仕様へ更新した。個人の絶対パス・曲名・固定終了秒数を配布する既定値にしない。リポジトリ外の音源・作品プロジェクト・ローカルデータは保守処理の対象にしない。

.gitignoreで原音/出力/プラグイン/ローカルMCP設定/認証情報/ビルド生成物を除外。リポジトリ検査テストで、曲別スクリプトへの本体依存、個人固有パス、除外漏れを検査する。

## 検証

MODO DRUM/BASS、MASSIVE、MASSIVE X、BBEは実機商用テストで再検証。共通PDC・ミキサー・状態復元失敗時の保存中断、HTTP転送・切断後処理は自動試験で検証。Windows、実際の別マシン間通信、他バージョンのプラグインは未検証。
