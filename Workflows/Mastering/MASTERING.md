# マスタリング

読む条件: マスタリングの依頼、kind=masteringの曲・アルバム編集。
対象確認と確定は[EDITING](../EDITING.md)。ユーザーの指定を優先する。

## 指定のない「マスタリングして」への既定手順

1. **原音を先に確認する。** sourceとreferenceを区別し、全体と静かな箇所・最も密な箇所・終端を確認する。audio_measureでLUFS/true peak/LRA、audio_analyzeでsample peak/RMS/clipを測定。中低域の滞留、明瞭度、残響、左右差・逆相、モノ試聴での痩せを調べ、帯域/相関を解析する。自動判定済みと推測しない。聴感は聴けなければ未確認と記録する。
2. **目標と変更理由を決める。** 音圧は指定→参考音源/用途→原音・曲調の順に判断する。未指定ならGoldenTips基準の-13 LUFSを暫定目標にし、原音・用途に応じ変更して根拠を記録する。過度な歪み・潰れが出る目標は下げる。アルバムは曲間の聴感音量とダイナミクスも合わせる。
3. **入力ゲイン→EQ。** AIDAW Gainで後段の増幅余地を確保する。AIDAW EQで確認できた中低域のモコつき・濁りを減らす。150～500Hz付近は調査候補であり、周波数・Q・カット量は曲から決める。低音の芯や声の厚みを失うなら戻す。毎曲同じ帯域を自動カットしない。
4. **Enhancer→Reverb。** GoldenTips方式のAIDAW Enhancerを基準に輪郭・明瞭度を補う。刺さる場合はProcessを弱める。AIDAW Reverbも少量の候補を比較し、馴染み・空間の質感が改善するときだけ有効にする。残響増加や中低域の再混濁を確認し、十分な残響がある原音では無効のままにする。
5. **Imager→BassMono。** 基準の全帯域M/Sから曲に合わせ幅を決め、モノ合算でも確認する。完全mono（L=R）はImagerでは広がらない。別処理が必要と明示し、効果を捏造しない。低域の左右差が濁りに寄与する場合はAIDAW BassMonoで低域を整理する。低域の逆相、痩せ、定位・意図した広がりの悪化を確認し、問題がある/判断できない場合は弱めるか無効にする。mono化を位相修復と扱わない。
6. **最後にLimiter。** AIDAW Limiterのdrive/ceiling/releaseを調整して目標音圧へ近づける。出力をaudio_measureで再測定し、true peak・歪み・アタック・低域の揺れを確認する。sample ceilingをtrue-peak保証と読み替えない。音圧不足だけを理由に押し込まない。
7. **音量をそろえてA/B、再調整。** 原音/前版と等音量で比較し、音量増加を音質改善としない。改善した段だけ採用。測定値、変更理由、不採用理由、未確認事項を作品の履歴へ残す。

## チェーン適用と版管理

AIDAW Mastering Chainを出発点にする。effect_chain_list/inspectで版・順序を確認し、effect_chain_applyへproject/revision/song/親版を明示する。FX置換で新版を作る。Reverbは上記判断、初期値は暫定。構文は[EFFECT_CHAINS](../../Docs/Contracts/EFFECT_CHAINS.md)。

原音・FX順序・保存状態・入力ゲイン・範囲・末尾を各版に保持する。曲切替で設定を引き継がない。currentは編集基点、acceptedは納品候補、A/Bは試聴参照。mastering_create_versionで旧版を残し、比較だけで採用版を変えない。

書き出し対象を明示。版仕様: [DOCUMENTS](../../Docs/Contracts/DOCUMENTS.md)・[HISTORY](../../Docs/Contracts/HISTORY.md)、音源選定時だけ[SOUNDS](../Composition/SOUNDS.md)。

完了報告前にpreparation.job_id（なければmastering_prepare）をjob_statusで確認しsucceededまで待つ。再生で待機なら停止する。GUIは生成済み版のみ再生。
