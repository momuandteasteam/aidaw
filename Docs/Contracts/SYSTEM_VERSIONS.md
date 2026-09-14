# バージョン表示

読む条件: 設定の版表示・内部コンポーネント一覧を変更するとき。
正本範囲: system_versions APIと設定の情報dialog。

Design status: ready

設定見出しの横にGUI releaseVersion由来のv表記を置き、押すと独立した「バージョン」dialogを開く。設定項目は音声出力だけのまま。閉じると設定へ戻る。小さいバージョン番号にも32pxの押下領域を用意する。

system_versionsは空入力・読取専用。返却はschema_version、version、components[{id,name,version,status,category}]。コア/GUIは実行中release、Node/Electronはprocess.versions、エンジン・Instruments/Effectsは導入manifestから取得する。分離エンジンはinstallation receiptから取得。manifest値は「導入済み」、process値は「実行中」と区別。欠損/不正は未確認として返し、勝手に0.0.1で補完しない。作品パスや個人設定は返さない。外部pluginをロード/全スキャンせず、音声laneに入れない。

GUI表示はこのAPIを使い、取得失敗はdialog内に表示、再度開けば再取得。取得中に閉じた応答は破棄。APIはMCP/HTTPにも同じ定義で公開する。日本語名と英語IDを分離し、動的値はtextContentで挿入する。

検証: 導入済み・欠損・不正manifest、読取専用、dialog開閉、実アプリ一覧。

categoryはcore（AIDAW・コア）、builtin（内蔵音源・エフェクト）、technology（技術スタック・ライブラリ）。GUIはこの順に見出しを付け、空分類は省略。AIDAW Audio Engineはcore、aidaw-音源/FXはbuiltin、Node/Electron/Demucs/Spleeterと外部拡張はtechnology。既存components配列は維持し、未知categoryはtechnologyに表示する。分類は版の実測・未確認の区別を変えない。

標準音声エンジンの正式名称はAIDAW Audio Engine。表示・説明・診断に同名を使う。識別子engine:juce、実行ファイルaidaw-engine、環境変数AIDAW_ENGINEは機械用の安定名として維持する。

AIDAW APIとAIDAW MCP BridgeはCore配下でも別コンポーネントとしてcore分類に表示。APIは実行中、MCP Bridgeは導入済みとしてreleaseVersionを返す（接続の実行状態を推測しない）。
