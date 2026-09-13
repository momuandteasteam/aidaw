# 検証の入口と根拠

[REQUIREMENTS](REQUIREMENTS.md) の必要なIDだけを確認する。仕様本文は同表が示す所有文書へ進む。証拠欄は実ファイルへのリンク。最小テスト欄のファイル名はすべて `Core/Tests/` 相対。

`implemented` は実装と検証入口がある状態。現在の環境で成功した、音を聴いた、実機確認したという意味ではない。`partial` は利用範囲と残件がある状態、`planned` は設計のみ。

## ID別の証拠と限界

| ID | 状態・source／test | native／hardware・残件 |
| --- | --- | --- |
| R-001 | implemented。[home.ts](../../Core/Source/Adapters/node/workspace/home.ts)、[check-layout.mjs](../../Core/Tools/check-layout.mjs)。[home-layout試験](../../Core/Tests/home-layout.test.mjs)、[runtime-paths試験](../../Core/Tests/runtime-paths.test.mjs) | 作品ZIPとrepo配置を分ける。移動時はsetup・配布も検証。 |
| R-002 | partial。[active-context.ts](../../Core/Source/Adapters/node/runtime/active-context.ts)、[control-runtime.mjs](../../Core/Source/Desktop/runtime/control-runtime.mjs)。[active-context試験](../../Core/Tests/active-context.test.mjs) | 選択共有APIとAIの再照会手順はある。context世代と文書変更を同じ原子的条件で検査するserver guardは未実装。 |
| R-003 | implemented。[domain.ts](../../Core/Source/Domain/domain.ts)、[mode-compilers.ts](../../Core/Source/Domain/mode-compilers.ts)。[domain試験](../../Core/Tests/domain.test.mjs)、[mixer試験](../../Core/Tests/mixer.test.mjs) | 製品上限なし。メモリ・音源負荷は実測。 |
| R-004 | implemented。[domain.ts](../../Core/Source/Domain/domain.ts)、[service.ts](../../Core/Source/Application/service.ts)。[domain試験](../../Core/Tests/domain.test.mjs)、[core-controls試験](../../Core/Tests/core-controls.test.mjs) | current／accepted／比較は独立。試聴を採用・評価としない。 |
| R-005 | implemented。[node-workspace.ts](../../Core/Source/Adapters/node/workspace/node-workspace.ts)、[history.ts](../../Core/Source/Adapters/node/workspace/history.ts)。[history試験](../../Core/Tests/history.test.mjs)、[workspace-port試験](../../Core/Tests/workspace-port.test.mjs) | prepare失敗・競合も検証。複数commitは非原子的。 |
| R-006 | implemented。[package.ts](../../Core/Source/Adapters/node/workspace/package.ts)、[export.ts](../../Core/Source/Application/export.ts)。[archive試験](../../Core/Tests/archive.test.mjs)、[export試験](../../Core/Tests/export.test.mjs) | 未レンダー保存と音声書出しを区別。曲／album・版・形式を確認。 |
| R-007 | partial。[model.mjs](../../Core/Source/ControlSurface/model.mjs)、[key-image.mjs](../../Core/Source/ControlSurface/key-image.mjs)、[index.html](../../Core/Source/Desktop/renderer/index.html)。[core-controls試験](../../Core/Tests/core-controls.test.mjs)、[button-layout試験](../../Core/Tests/button-layout.test.mjs) | 補助画面内の8キー到達試験あり。通常面3キーから全操作への到達は未確認。質感・BPM・割り当て非表示・正方形内の全操作・10pxノブ名・作品種別・青緑波形とカバー2枚はChromium確認。[artwork試験](../../Core/Tests/artwork.test.mjs)で不在・破損・切替競合を確認。 |
| R-008 | implemented。[encoders.mjs](../../Core/Source/ControlSurface/encoders.mjs)、[waveform.mjs](../../Core/Source/ControlSurface/waveform.mjs)、[elements.mjs](../../Plugins/Skins/elements.mjs)。[waveform-ui試験](../../Core/Tests/waveform-ui.test.mjs)、[player-knobs試験](../../Core/Tests/player-knobs.test.mjs) | 実測波形のみ。monitorと保存mixを分け、実音を検証。 |
| R-009 | partial。[layout-customization.mjs](../../Core/Source/ControlSurface/layout-customization.mjs)、[index.mjs](../../Plugins/Skins/index.mjs)。[button-layout試験](../../Core/Tests/button-layout.test.mjs)、[surface-runtime試験](../../Core/Tests/surface-runtime.test.mjs) | deck/transport交換・注入は可。任意skin導入は未実装。自由配置の8キー到達・隣接は未保証。 |
| R-010 | partial。[index.mjs](../../Plugins/Controllers/index.mjs)、各機種module。[controllers試験](../../Core/Tests/controllers.test.mjs)、[hardware-profile試験](../../Core/Tests/hardware-profile.test.mjs) | Stream Deck／Ulanziはbridge未実装。Push／Launch ControlはMIDI Learn。機種固有ネイティブ統合・実機検証済みとは報告しない。 |
| R-011 | partial。[engine-contracts.ts](../../Core/Source/Contracts/engine-contracts.ts)、[application-contract.ts](../../Core/Source/Contracts/application-contract.ts)、[workspace.ts](../../Core/Source/Contracts/workspace.ts)。[engine-port試験](../../Core/Tests/engine-port.test.mjs)、[application-port試験](../../Core/Tests/application-port.test.mjs)、[workspace-port試験](../../Core/Tests/workspace-port.test.mjs) | 各portのfake交換あり。Application/service等にはcatalog・asset・render jobの具象I/Oが残る。ApplicationPortのtool schemaはZod型にも依存する。全層の純粋化・schema library独立は未完。 |
| R-012 | implemented。[StarterPlugins](../../Core/Source/StarterPlugins)、[plugin-packages.ts](../../Core/Source/Adapters/node/engine/plugin-packages.ts)。[starter試験](../../Core/Tests/starter.test.mjs)、[plugin-packages試験](../../Core/Tests/plugin-packages.test.mjs) | scan、load、state復元、renderを分ける。バイナリ・資産移動後は導入先から実音確認する。 |
| R-013 | partial。[version.ts](../../Core/Source/Contracts/version.ts)、[application-contract.ts](../../Core/Source/Contracts/application-contract.ts)、[engine-contracts.ts](../../Core/Source/Contracts/engine-contracts.ts)。[contracts試験](../../Core/Tests/contracts.test.mjs)、[application-port試験](../../Core/Tests/application-port.test.mjs) | 非互換拒否・converter registryあり。作品／ZIP読込との統合は未完。音源状態を推測変換しない。 |
| R-014 | implemented。[processing-queue.ts](../../Core/Source/Adapters/node/runtime/processing-queue.ts)、[audio-lane.ts](../../Core/Source/Adapters/node/runtime/audio-lane.ts)、[http-server.ts](../../Core/Source/Adapters/http/http-server.ts)。[queue試験](../../Core/Tests/queue.test.mjs)、[nonblocking試験](../../Core/Tests/nonblocking.test.mjs)、[http試験](../../Core/Tests/http.test.mjs) | 別process・取消・停止PID・再生中取得を検証。複数曲を並列化しない。 |
| R-015 | implemented。[分離処理](../../Core/Source/Application/separation.ts)、[試験](../../Core/Tests/separation.test.mjs)。 | macOS ARM64で実Spleeterの4stem生成を確認。音質聴取評価・Windows実機は未確認。 |


## 最小実行

以下はrepository rootから実行する。まず新しいsourceをbuildする。失敗後に以前のJSを実行して成功扱いにしない。

```sh
npm --prefix Core run build
```

依存不足は [SETUP](../../Workflows/Development/SETUP.md) へ。nativeに変更がある場合は `npm --prefix Core run configure:native`、`npm --prefix Core run build:native` を先に実行する。

`node Core/Tools/test.mjs` はcwdをrootへ固定し、開発engine／soundfontを試験入力として明示する。これは製品fallbackではない。表から必要なファイルだけ選び、例えば履歴変更なら次を実行する。

```sh
node Core/Tools/test.mjs Core/Tests/workspace-port.test.mjs Core/Tests/history.test.mjs Core/Tests/archive.test.mjs
```

以下のファイルはすべて `Core/Tests/` 配下。

| 変更 | 最小テスト | 追加条件 |
| --- | --- | --- |
| 配置・settings | `home-layout.test.mjs`、`runtime-paths.test.mjs`、`architecture.test.mjs`、`player-settings.test.mjs` | setup変更は`setup.test.mjs`、配布変更はstaging確認。 |
| 文書・mode | `domain.test.mjs`、`workspace-integration.test.mjs` | graph変更は`mixer.test.mjs`と実音。 |
| 履歴・保存 | `workspace-port.test.mjs`、`history.test.mjs`、`archive.test.mjs` | retry、競合、破損入力、未レンダー往復を含む。 |
| API・選択 | `application-port.test.mjs`、`active-context.test.mjs` | transport変更は`mcp.test.mjs`、`http.test.mjs`。 |
| engine | `contracts.test.mjs`、`engine-port.test.mjs` | native変更は`engine.test.mjs`、`state-capture.test.mjs`と実音。 |
| plugin導入 | `plugin-packages.test.mjs`、`engine-installation.test.mjs`、`starter.test.mjs` | 導入先からscan/load/state復元/render。 |
| キー・個人配置 | `core-controls.test.mjs`、`button-layout.test.mjs`、`hardware-profile.test.mjs` | 実画面で8キーのみの到達性を確認。 |
| skin・波形・ノブ | `surface-runtime.test.mjs`、`surface-browser.test.mjs`、`waveform-ui.test.mjs` | 計算変更は`waveform.test.mjs`、実音反映は下記device試験。 |
| MIDI・機種 | `controllers.test.mjs`、`hardware-profile.test.mjs` | bridge変更は対象実機。 |
| queue・取消 | `queue.test.mjs`、`nonblocking.test.mjs`、`home-layout.test.mjs` | worker変更は`player-lifecycle.test.mjs`、`player-start.test.mjs`。 |
| export・納品 | `export.test.mjs`、`delivery.test.mjs` | 対象曲／album、版、codec、hashを成果物で確認。 |

## 実音・GUI・配布

再生device、monitor音量、mute/solo、gain/panの反映を変えた場合は出力を選びdevice試験を有効化する。macOS/Linux:

```sh
AIDAW_TEST_PLAYBACK=1 node Core/Tools/test.mjs Core/Tests/player.test.mjs Core/Tests/player-knobs.test.mjs
```

PowerShellは同名環境変数を一時設定し、終了後に元へ戻す。deviceなし、条件付きskipは未確認として残す。fake試験を実DSP互換の認定にしない。音声比較では範囲、sample rate、版、processor stateを固定し、無音・clip・遅延・tail等の変更対象を確認する。指標確認と聴取を区別する。

GUI変更はChromium試験に加え `npm --prefix Core run player` で常駐サイズを確認する。関連キーの隣接、文字切れ、disabled/active、波形tap/drag、ノブ反応、skin切替後の再生継続、file/settings分離を見る。起動だけでは操作確認にならない。実機では機種・firmware・接続・mapping・gestureを記録し、MIDI Learnをnative対応と呼ばない。

配布変更は対象OSのpackage scriptでstagingを生成し、必要entry/engine/pluginが揃い、開発側の別コピーに依存しないことを確認する。Projects、個人設定、秘密情報、旧sourceの混入を検査する。

複数境界・共通契約・release前は `npm --prefix Core test`。新変更・失敗・懸念がなければ同じ全体試験を繰り返さない。

## 結果記録

一時ログは `Core/Build/Verification/`。PR／変更報告には対象ID、source revisionまたは差分、command、OS/arch、engine/device/plugin版、実際の成功/失敗/skip、実音/GUI確認範囲、残件と再試験条件を残す。個人作品や録音をGitへ追加しない。

原因不明の失敗を期待値変更やskipで隠さない。状態は上表、仕様は所有文書へ。ログを仕様正本にしない。

セットアップ補足（2026-09-14）: 対応OSはWindows 11・macOS・Linux（未検証）。setup/配置の回帰8件、shell構文、macOS依存確認を通過。Linuxのビルド・音声・GUIとWindows 11実機の再検証は今回未実施。Antigravity生成設定からstdio接続・system_capabilities成功、アプリ内有効化はRefresh待ち。Demucs 4.0.1/HTDemucsは外部取得・モデルロード・hash記録を確認し、実音分離の評価は未実施。
