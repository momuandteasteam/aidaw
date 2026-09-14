# エフェクトチェーン

読む条件: 名前付きFX列の作成・解決・適用を変更するとき。
正本範囲: 再利用template、版固定、atomic適用。
関連要件: R-012。
Design status: ready

チェーンは複数effectの順序と初期値を持つ宣言JSON。DSP binaryではない。Workflows/Templates/EffectChains/<chain_id>.jsonに配置する。schema_version=1、id/name/version、stagesのstable ID、pluginのvendor/name/format/version、enabled、normalized parameters（host公開名と値）、説明を持つ。デスクトップ配布にも同じtemplateディレクトリを含める。strict schemaでunknown field、stage重複、16段超、path traversalを拒否。コード・絶対path・plugin stateはtemplateに持たない。追加/変更は独立したchain versionとして管理し、同じ版の意味を後から変えない。

effect_chain_list/inspectはnative pluginをロードしない。resolveは有効stageだけを現在catalogと正確なvendor/name/format/versionで照合し、plugin_inspect相当で公開parameter名を一意なIDへ変換する。曖昧・未導入・版不一致・未知parameterは全体失敗。disabled stageはロードしない。enabled/parameters overrideはstage IDを指定し、未知IDを拒否する。parameters overrideは公開名とnormalized値を指定し、既定値へ上書き統合する。重複名を拒否する。返却するeffectsは既存plugin配列契約を使用する。

effect_chain_applyはproject_id/base_revision/request_idとtargetを必須指定。初版はcompositionのmasterまたはmasteringのsong_id/parent_version_id。replace方式だけを提供し、既存FX置換を明示した操作として扱う。masteringは新しい版を作り旧版を保持する。書込は既存Service.change経路のCAS・idempotency・保存state固定・作業中mix保護に従う。chain id/version/hashをsummaryへ残す。resolved plugin配列は作品へ展開保存し、template更新を既存作品へ自動適用しない。チェーン単位のnested DSPやリンク編集は初版の範囲外。

## AIDAW Mastering Chain 0.0.1

Gain → EQ → Enhancer → Reverb（disabled）→ Imager → BassMono（disabled）→ Limiter。
GoldenTipsの既定有効段を基準にする。Gain -6dBは解析前の暫定値、EQはflatから曲の濁りに応じ316Hz/Q1.05を候補に補正。Enhancerは11/20/-1dB、Imagerは全帯域width1.4・Mid+1dB・Side0dB。Limiter drive0dB/ceiling-1dBFS/release100ms、目標-13LUFSから用途・原音に応じ調整し再測定。固定driveで目標達成としない。Reverb・BassMonoは必要時だけ有効化する。Golden Shine・Match EQ・Glueも自動追加しない。未リリース試作チェーンとの互換性は提供しない。参照DSPとの差は[STANDARD_DSP](STANDARD_DSP.md)。

検証: strict schema、解決失敗時の無変更、disabled除外、順序/初期値、CAS/retry、composition state凍結、mastering旧版保持、実renderを確認する。実作品へ勝手に適用しない。

指定のないマスタリングの判断・処理方針は[MASTERING](../../Workflows/Mastering/MASTERING.md)。template初期値と作品ごとの判断を区別する。
