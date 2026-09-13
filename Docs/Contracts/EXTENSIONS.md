# Plugin・engine・controllerの交換単位

読む条件: 拡張package、manifest、導入、機種module、標準音源/FXを変更するとき。
正本範囲: 交換単位の識別・検証・登録と、発見/実行/実機確認の区別。
関連要件: R-009, R-010, R-011, R-012, R-013。

## 共通

Pluginsは実行する交換単位、Librariesは参照資源。分類と保存責務は [DIRECTORIES](../Architecture/DIRECTORIES.md) に従う。宣言manifest、導入receipt、実行時に得たcatalog IDを別物として扱う。表示名が同じだけで互換と判断しない。

manifestはデータであり、読み取り時にpackage内コードを実行しない。相対path、platform/arch、format、resource hashを検証する。作品archiveに含まれるコード・skin・controllerを自動登録・実行しない。外部moduleの導入はユーザーの明示操作に基づく。

契約の識別・version・capabilityを変更するときは利用側と対応範囲を更新する。未知版や未知parameterを無言変換しない。契約versionの検査が一つ存在することを全loaderの世代間変換完成と数えない。

## Instrument / Effect

標準GM、EQ、Limiter、Reverbは独立した高速native plugin packageとして導入する。曲ごとのスクリプトにDSPを閉じ込めず、本体の簡易音源へ無断代用しない。共通native sourceの所在と、実行する独立binaryの所在を区別する。

現在の管理package manifestはschema_version 1。package_id、version、category、format、entry、platform、archを持ち、任意resourcesに相対pathとSHA-256を記す。管理packageのformatはVST3、entryは完全なVST3 bundle。一般のcatalog探索で扱う他formatとは別の契約である。

resourceはpackage境界内の実ファイルであることを検証する。巨大bank、SDK、native binaryをsourceとしてGit追加しない。resourceの由来・所有者・licenseを保持し、商用音源の発見をライセンス確認と同一視しない。標準GMの選定条件を含む制作手順は [SOUNDS](../../Workflows/Composition/SOUNDS.md)。

packageの発見、pluginのscan/load、state復元、render互換性、実音の評価は異なる状態として記録する。保存presetの存在だけで発音成功としない。内部ライブラリや音色の探索結果がpartialなら完全発見と報告しない。

## Engine

導入engineはPlugins/Enginesのpackage。現在のJUCE導入manifestはschema_version、protocol_version、version、platform、arch、executable、SHA-256を持つ。導入処理はhash別の実行物を作り、検証後にmanifestを原子的に更新する。

通常のworkspace起動は導入manifestから実行物を解決し、破損や不一致を明示エラーにする。明示的な開発用overrideを、旧配置の暗黙fallbackに広げない。driverの実行契約とresourceを含むidentityは [ENGINE](ENGINE.md) に従う。

## Controller

機種moduleはprofileとadapter factoryを持ち、共通commandへ入力を変換する。現行profileはid、name、transport、status、verifiedHardware等を持つ。registryは明示登録、ID重複拒否、profileの基本形検査を行う。現在のcontroller profileには独立した契約version fieldがないため、全moduleでversion交渉済みと扱わない。

| module | 現在の境界 |
|---|---|
| Stream Deck / Stream Deck + | 共通frame、key/encoder/touch変換。メーカーbridgeは別途必要 |
| Ulanzi | 機種moduleの入口。モデル固有transport/制御実装が必要 |
| Ableton Push / Launch Control | 共通MIDI adapterとLearn。メーカー固有native操作の保証ではない |

MIDI adapterはchannel、note/CC、key/encoder割当、absolute/relative入力を扱う。note-offやvelocity 0を押下とせず、Learnした押下を直ちに操作として実行しない。接続の持続と解除はhostが所有し、skin切替で重複接続しない。

機種statusとverifiedHardwareは別に表示する。実機を接続して確認していない機種をnative対応済みと報告しない。キー画像・座標・ノブ値は共通ControlSurfaceを使い、製品配置は [CONTROLS](../Architecture/CONTROLS.md)。skin固有のlifecycleは [SURFACE](SURFACE.md)。

## 実装と確認

入口は [plugin-packages](../../Core/Source/Adapters/node/engine/plugin-packages.ts)、[engine-installation](../../Core/Source/Adapters/node/engine/engine-installation.ts)、[StarterPlugins](../../Core/Source/StarterPlugins/StarterPlugin.cpp)、[controller registry](../../Plugins/Controllers/index.mjs)、[MIDI adapter](../../Plugins/Controllers/midi.mjs)。

[plugin-packages試験](../../Core/Tests/plugin-packages.test.mjs)、[engine-installation試験](../../Core/Tests/engine-installation.test.mjs)、[controllers試験](../../Core/Tests/controllers.test.mjs)、[hardware-profile試験](../../Core/Tests/hardware-profile.test.mjs) を変更範囲に応じて確認する。実機・native・商用音源の確認範囲は [VERIFICATION](../Development/VERIFICATION.md) の関連行。
