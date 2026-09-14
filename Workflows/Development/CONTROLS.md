# GUI・機器操作を変更する

読む条件: skin、キー配置、ノブ、MIDI入力などを変更するとき。

最初に [設計確定手順](DESIGN_FIRST.md) を実行する。設計文書の更新・確定より先に実装を変更しない。

AIDAWの編集指示はCodex／Claude Code。GUIはAI応答待ちなしの再生・試聴・読込・書き出しを優先する。データがあるだけで表示を増やさない。ファイル操作はメニューへ分け、設定画面には音声出力だけを置く。

設計の正本は [CONTROLS](../../Docs/Architecture/CONTROLS.md)。既定deckは全15キー・4ノブを割り当て可能にする。曲制作の初期キーは左上から「停止/先頭へ（自動切替）・再生/一時停止・書き出し」の3個だけ。残りのキーは未割り当て、ノブは右端の再生音量だけ。内部モードを通常UIへ露出させず、設定は曲制作/マスタリング別に扱う。ノブ回転と押下は独立した割り当てとし、保存・復元・空欄・利用不能な対象を検証する。キー72px、画像144px、1×固定。stripは実測波形とシーク、ノブ値は操作時の一時表示。

skinは共通snapshot/actionを使い、交換で再生・作品・MIDI接続を再初期化しない。OS機能はdesktop host、機種別変換はPlugins/Controllersに置く。MIDI Learnと専用bridgeを区別し、未実機検証をネイティブ対応済みと報告しない。作品ZIPから拡張コードを自動実行しない。

契約を変更するときだけ [SURFACE](../../Docs/Contracts/SURFACE.md)、拡張導入を変更するときだけ [EXTENSIONS](../../Docs/Contracts/EXTENSIONS.md) を読む。

停止/先頭への自動切替は、再生中・一時停止中・準備中/待機中に「停止」、停止後・完了後・再生セッションなしで「先頭へ」とする。停止は位置を保持し、次の押下で先頭へ戻る。共通モデルで表示・色・commandを同時に切り替え、単独の停止/先頭へも割り当て候補に残す。

ボタン名・記号・翻訳を変える場合は[UI用語](../../Docs/Contracts/UI_TERMINOLOGY.md)を読む。

ファイルメニューを変更するときは[作品ファイル操作](../../Docs/Contracts/PROJECT_FILES.md)を読む。

ステム波形は[STEM_WAVEFORM](../../Docs/Contracts/STEM_WAVEFORM.md)を読む。

版表示は[SYSTEM_VERSIONS](../../Docs/Contracts/SYSTEM_VERSIONS.md)を読む。

分離方式は[SEPARATION_ENGINES](../../Docs/Contracts/SEPARATION_ENGINES.md)を読む。
