# ステム分離の試聴波形

読む条件: ステム分離のstrip波形・ミュート/ソロ追従を変更するとき。
正本範囲: project_waveformのstem layersと共通surface表示。

Design status: ready

分離済み原データから各stemの全曲peakを実測し、共通時間軸で重ねた同じ青色の半透明4層をstripに表示する。未分離・欠損は波形を捏造しない。これは各stemの包絡の重ね合わせであり、位相を含む合成音の実測波形ではない。

project_waveformは分離時にlayers[{track_id,peaks}]を返す。immutable asset hashとfile metadata・binsで測定結果をcacheし、再レンダリングしない。測定は順次で既存の波形取得経路、音声処理laneを奪わない。project/revision切替時の遅延応答を破棄する。

surfaceは現在作品と一致するplayback.effective_mixを優先し、不足項目は文書のmute/solo/gainへfallback。soloがあれば先頭soloだけをmuteより優先して描き、それ以外は非muteだけ描く。全muteは基線のみ。停止後も存在するeffective_mixを反映する。各layerは同じ色・同じ軸、0.45 opacity、gain倍率を反映する。無効layerを描かず、キー選択だけでは波形を変えない。ミュート/ソロ操作時は既存peakから即時再描画し、測定APIを再要求しない。

800×100画像、400×50のstrip表示、シークと経過色・head・ノブoverlayは保持。tooltipに「再生対象ステムの重ね合わせ」と鳴るstem名を表示。音声の未生成を準備中と偽らない。

検証: 実PCMから4層測定、mute/solo複合・全mute・違うprojectのmix拒否、gain、再生位置、既存mastering波形の回帰。
