# AIDAW Audio Engine・音声実行契約

読む条件: render、再生、DSP、plugin parameter、audio queue、engine driverを変更するとき。
正本範囲: EnginePort/AudioPlanの意味、音声処理の排他と再現条件。
関連要件: R-008, R-011, R-012, R-013, R-014。

Design status: ready

正式名称は **AIDAW Audio Engine**。命名は[SYSTEM_VERSIONS](SYSTEM_VERSIONS.md)に従う。

## portと版

EnginePortはdescribe、render、startPlayback、分析、plugin探索/検査等の型付き操作を持つ。EngineDriverはそれらを実行するadapter境界。公開型は [engine-contracts](../../Core/Source/Contracts/engine-contracts.ts) が正本で、未知commandを通すcall(any)を共通境界へ追加しない。

describeのengine/adapter ID・version、contract major/minor、content_fingerprint、features、sample_rates、plugin_formatsを使う。現行facadeはcontract major 1と操作ごとのfeatureを確認し、未対応なら失敗する。アプリpackage版と契約版を同一視しない。メーカー固有のpreset操作は宣言された型付き機能であり、別製品・別版へ名前から推測適用しない。

JuceFileDriverだけがnative command、worker、status/control file、JUCE bindingを扱う。別driverが同じportを実装してもapplicationの作品正本を変更しない。native版対応はdriverの宣言を確認し、未宣言版を互換と判断しない。

## AudioPlan

[audio-plan](../../Core/Source/Contracts/audio-plan.ts) のaidaw.audio-plan version 1を使う。provenance、timing、channels、returns、masterからなり、MIDI events、source、processor、level、sendを明示する。composition/masteringからのcompileは [DOCUMENTS](DOCUMENTS.md) に従う。

native XMLやJUCE固有fieldを公開planへ運ばない。現在のaudio/frozen sourceとrender出力はサーバー上のfile pathを持つ。managed asset referenceだけのwire契約だと仮定せず、filesystem解決・許可範囲はadapter側で管理する。

ProcessorReferenceはplugin ID、任意version/program、opaque state、ID付きparameters/automationを持つ。現在のparameter値はnormalized 0..1。descriptorの表示文字列や単位からHz/dBへ勝手に線形変換しない。未知ID、値範囲外、復元不能な保存状態を「近い設定」で代用しない。意味単位の汎用操作や任意メーカーの状態世代変換は、別の明示契約が必要。

## renderと再生

renderは固定したplanと処理条件から成果物を返す。出力の存在・hash・codec・対象revisionを確認してjob成功とする。cacheはengine/adapter/resource identity、source、plugin state、plan、scopeを含めて識別し、engine交換で別結果を誤再利用しない。

PlaybackSessionはready、done、status、control、closeを持つ。controlはpause/resume/stop、seek、set_mix、set_volume。戻り値はvoidであり、公開ack DTOを仮定しない。mix/monitor volumeはnative側でcallback適用を待つ。seek等の受付確認と同一視せず、失敗・終了済みsessionへ成功表示を返さない。

開始時の作品revisionを固定し、session中の正本編集を暗黙に差し替えない。seekはframeと実際のduration/sample rateで扱う。gain/pan/mute/soloは一時mix、monitor volumeは再生専用で、保存やexportの状態を変えない。保存する場合はapplication編集を明示する。

callbackへ新たなallocation、lock、file I/Oを持ち込まない。control側で検証した変更を安全な境界で適用し、pause中も適用待ちが停止しないことを確認する。開始前失敗、cancel、worker終了でもsessionの待機を取り残さず、stop/closeを再試行可能にする。

## 単一audio lane

音声処理はサーバー全体で常に一件。試奏、plugin検査での発音、render全pipeline、再生、batch内各曲、変換を同じlaneへ通す。内側のnative呼出しで別queueを作らず、再生はsession寿命全体でlaneを保持する。

同じworkspaceの別processも共有lockを守る。lockは所有PID/tokenを確認して扱い、停止を確認できない所有者のlockを時間経過だけで削除しない。空いたCPUを理由に曲を並列処理しない。

接続受付、状態照会、選択・履歴の読み取り、完成済みWAV/MP3/ZIP取得はaudio lane外で応答する。再生停止とjob取消は区別する。queue待機の取消と開始済み処理の停止を適切にsettleさせる。

## 実音と現在の実行制約

共通pipelineは演奏→insert→fader→send/return→premaster→masterを扱う。非決定的な音源をstem用に別テイクで再演奏せず、同じ確定演奏を共有する。静的遅延補償、先頭発音、末尾、stem和、保存state readbackを確認する。処理中の遅延変化を黙って通さない。

現在の基準は48 kHz stereo、固定tempo、単曲30分以内（MIDI timingは29.5分以内）、1段pre/post-fader send。sidechain、任意bus間routing、可変tempo、CC/サステイン、他sample rateへの自動変換、リアルタイム録音、動的PDCを対応済みとしない。測定値と音楽的な聴取評価は別の根拠として扱う。

実装入口: [facade](../../Core/Source/Adapters/node/engine/engine.ts)、[Juce driver](../../Core/Source/Adapters/node/engine/juce-file-driver.ts)、[queued-engine](../../Core/Source/Application/queued-engine.ts)、[audio-lane](../../Core/Source/Adapters/node/runtime/audio-lane.ts)、[native Engine](../../Core/Source/Audio/Engine.h)、[native Player](../../Core/Source/Audio/Player.h)。

検証は [engine-port](../../Core/Tests/engine-port.test.mjs)、[mixer](../../Core/Tests/mixer.test.mjs)、[queue](../../Core/Tests/queue.test.mjs)。実音・実機の実施範囲は [VERIFICATION](../Development/VERIFICATION.md) の関連行を読む。
