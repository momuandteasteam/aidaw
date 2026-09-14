# 標準エフェクトDSP

読む条件: 標準EQ・Limiter・Enhancer・Imager・BassMono・Gainの実装・品質検証を変更するとき。
正本範囲: DSP特性、パラメーター互換、遅延、品質判定。
関連要件: R-010, R-012。
Design status: ready

## 監査と改修

標準DSPはCore/Source/StarterPluginsの共通header、各VST3は独立package。標準音源GMと全標準エフェクトの初期リリース版は0.0.1。AIDAW Exciterは廃止し、倍音・音色補強はEnhancerを使う。未リリース試作の保存状態との互換性・移行は提供しない。標準packは単体更新も可能。導入先はPlugins/InstrumentsとPlugins/Effects、OSのプラグインフォルダへ書かない。依存ライブラリとschema/protocolのversionは製品版番号とは別管理。


## 各処理

Gain: AIDAW Gain、gain -60–12dB（既定0）。double精度でdB→倍率・乗算を計算しfloatホスト出力へ戻す。左右同一倍率、20msのdB平滑化、初期prepareでは保存値から開始。遅延0、process内確保なし。ディザ/clipなし。倍率・左右比・無音・可変block・単調性を検証。

EQ: マスタリング用8band（low shelf + 6 bell + high shelf）。既存low/mid/highのHz・dB・Qを維持し、band3～7のHz（20–20000）/dB（-18–18、既定0）/Q（0.2–12）を追加。double状態と係数、20msのパラメーター平滑化、固定16sampleごとの係数更新。Nyquist手前へ周波数制限、最小位相。[RBJ係数](https://www.w3.org/TR/audio-eq-cookbook/)を使用。

Imager: 既存の分帯方式は既定のまま保持。Full band=1ではS全帯域へwidthを掛け、Mid dB/Side dB（各-12–12、既定0）を独立適用する。新規方式ではbass_width/hzは不使用。既存の初期値とIDを維持する。M=(L+R)/2、S=(L-R)/2。Sを2段の相補high-pass残差で低域/高域へ分ける。width 0–2（既定1）、bass_width 0–1（既定1）、bass_hz 40–400Hz（既定120）。低域幅を抑えながら高域幅を調整。Mを変えずモノ合算を保持し、遅延/位相差による擬似ステレオは生成しない。width=bass_width=1はunity。音量増大があり得るので後段Limiterで管理。

BassMono: 専用低域モノ化VST3、AIDAW BassMono。Mを無変更、Sへ4次Butterworth high-pass（24dB/oct、2段biquadのQ=.541196100146197/1.306562964876377）を適用。cutoff 20–500Hz（既定120）、amount 0–1（既定1）。S_out=(1-amount)*S+amount*HP(S)。amount=0はunity、入力がmonoなら全設定で無変更。cutoffでSは約-3dB。有限の遷移帯域があり完全monoと表現しない。失われたMを創作しない。double係数/状態、20ms平滑化、16sample係数更新、遅延0sample（最小位相の周波数依存位相はある）、process内確保なし。既存ImagerのID・挙動は変えない。低域抑制/高域幅/mono和/unity/block不変性/変更時有限性を44.1/48/96kHzで検証する。

Limiter: 4倍FIR oversampling、5ms先読み、stereo linked peak、短いattack平滑化と既存release制御。窓内peakの保持領域はprepareで確保。downsample後も左右共通のsample ceiling保護。release/drive/ceilingを平滑化する。検出はoversampled peakであり、任意DACや全波形での厳密true-peak保証・認証は主張しない。過負荷時は保護処理の歪みが増す。

[JUCE oversampling](https://docs.juce.com/develop/classjuce_1_1dsp_1_1Oversampling.html)はprepare時に確保しinteger latencyをホストへ報告。Enhancer/Limiterは内部block上限で分割し可変blockに対応。process中のresize/heap確保を行わない。変更をsample単位で平滑化、resetは状態を消去し再現性を確保する。

Enhancer: GoldenTipsのcreateEnhancerを基準に、70Hz low shelf（Low contour 0–100×.06dB）→7800Hz high shelf（Process 0–100×.035dB）→dry＋4200Hz HP/Q .8のtanh並列処理→Output dB（-12–6）。既定11/20/-1。drive=1+Process×.07、wet=Process×.0018、非線形=tanh(drive×x)/tanh(drive)。棚はWeb Audioのshelf slope=1に合わせる。非線形だけ4倍FIRで折り返しを低減し、dryも同じ遅延経路へ置く。20ms平滑化、prepare時確保、可変block、報告遅延・無音・静的周波数応答・参照方式との比較を検証。GoldenTipsの非oversampling実装やWeb Audio compressorとのbit一致は主張しない。参照はMTSのsrc/processing/analyzers/client/mastering-goldentips.ts（buildFixedMasteringSettings/createEnhancer/createStereoControl）。

## 合格条件

native DSPで44.1/48/96kHz、block境界の違い、無音/有限性、EQ unity・8band個別bell/shelf応答・高Q有限性、Imager unity・モノ和・低域抑制、Enhancer参照応答・無音・block不変性、Limiter天井・stereo比・latencyを数値検証する。parameter変更時の有限性も検査。VST3を共通APIでscan/保存復元/renderし、既存starter回帰を通す。実機未検証OSを検証済みと報告しない。聴感確認なしに主観的優劣を断定しない。
