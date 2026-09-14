# Control runtimeとskin契約

読む条件: 共通操作runtime、action/snapshot、skinの追加・切替・破棄を変更するとき。
正本範囲: 表示moduleとhostの境界。キー寸法や操作配置の正本は [CONTROLS](../Architecture/CONTROLS.md)。
関連要件: R-007, R-008, R-009, R-011。

GUIと作品の継続同期を変更するときは [PROJECT_SYNC](PROJECT_SYNC.md) を読む（設計済み・未実装）。

GUI調整の自動保存・取り込みは [WORKING_MIX](WORKING_MIX.md)。

## 所有する状態

Control runtimeが作品選択、再生状態、polling、dispatch、購読を所有する。skinは渡された表示用snapshotを描画し、操作intentをdispatchする。skinが作品正本、plugin state、native handleを所有・変更しない。

Desktop hostはOS window、file dialog、audio output、設定UI、MIDI接続等を担当する。skinを変えてもhostとruntimeは同じinstanceを保つ。機器transportの寿命をskinや設定dialogへ結び付けない。

## version 1の境界

Design status: ready

現行のsurfaceContractVersion / snapshot.contractVersionは1。snapshotはsequence、project要約、selection、transport、使用可能action、key画像/label、encoder値、waveform、overlayを持つ。完全な作品文書・engine実装objectを公開しない。生成したsnapshotを再帰freezeし、共有する波形等は複製する。

snapshotの任意追加項目tempoBpmは曲制作graphのBPM（有限な正数）、不明ならnull。既存skinは無視でき、versionは1を維持する。

project_artworkはproject_idを受け、manifestの最後のartwork（JPEG/PNG）をhash・包含確認後にdata URLで返す読み取りAPI。20MiB超・破損・不在はdata_url:null。新しい設定項目や外部URLは使わない。snapshotの任意artworkUrlはその画像かnull。runtimeは選択/再読込で更新し、古い要求の完了は捨てる。skinは背景画像の読込失敗時も通常背景へ戻す。作品・キー画像・再生を変更しない。

actionはtransport操作、key、encoder、monitor volume、project入出力、settings等の識別されたintent。具体的なtypeと値制約は [surface-contract](../../Core/Source/ControlSurface/surface-contract.mjs) が正本。未知action、不正index、非数値、不正範囲を実行せず、使えない操作と不正要求を区別する。

key座標、画像、commandとencoder動作はControlSurfaceの共通モデルから生成する。skin/deviceごとに独自の意味へ再実装しない。snapshotのsequenceは表示更新の順序であり、音声callbackの適用ackや作品revisionの代わりではない。

## skin module

moduleはmanifestとmountを公開する。現行registryはIDの形式・重複、contractVersion 1、mount関数を検証する。mountはroot、dispatch、initialSnapshotを受け取り、updateとdisposeを持つinstanceを返す。

- mount: 渡されたroot内へ表示し、必要なイベントを接続する。
- update: 同じinstanceへ新snapshotを反映し、再生や作品を作り直さない。
- dispose: イベント、購読、timer、表示資源を解放し、二重dispatchを残さない。

hostは前skinをdisposeしてから次をmountする。切替中もruntimeの再生ID/position、選択作品、共有context、MIDI接続を保つ。unknown IDや契約不一致を明示エラーとする。mount失敗時の表示復旧と正常な切替成功を混同しない。

同梱skinはdeckとtransport。registryへの明示module注入が入口であり、任意ファイルの自動発見・GUIからの外部module導入があると仮定しない。外部moduleはユーザーが明示登録したものだけを扱う。作品archive内から実行先を選ばない。

## 実装と確認

[control-runtime](../../Core/Source/Desktop/runtime/control-runtime.mjs) がstateとcommandを処理し、[skin registry/host](../../Plugins/Skins/index.mjs) がmount/update/disposeを接続する。OS境界は [desktop main](../../Core/Source/Desktop/main.mjs) と [preload](../../Core/Source/Desktop/preload.cjs)。

[surface-runtime](../../Core/Tests/surface-runtime.test.mjs)、[surface-browser](../../Core/Tests/surface-browser.test.mjs)、[architecture](../../Core/Tests/architecture.test.mjs) で同等操作、切替時のsession維持、破棄後イベント、依存方向を検証する。実施根拠は [VERIFICATION](../Development/VERIFICATION.md) の関連行。機器moduleは [EXTENSIONS](EXTENSIONS.md)。

マスタリングA/Bは[MASTERING_AB](MASTERING_AB.md)。

ファイルメニューのaudio.exportは通常デッキの書き出しと同じ操作へ解決する。マスタリングはdownloadMaster、ステム分離はseparationの保存dialogを開き、mode・選択を維持する。曲制作はexport画面。未選択時は無効。
