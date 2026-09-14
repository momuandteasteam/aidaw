# マスタリングA/B試聴

読む条件: A/B選択、版ローテーション、同位置切替、比較メーターを変更するとき。
正本範囲: GUIとApplication/engine間の比較操作。関連: R-007, R-008, R-013。

Design status: ready

通常面の基本4×2は上段「停止/先頭へ・再生/一時停止・書き出し・前の曲」、下段「A・B・音を切替・次の曲」。切替は押下時の非選択slotの音を保存順に一つ進め、末尾から先頭へ循環する。dialogは開かず、再生を維持する。未選択なら無効。曲移動は先頭/末尾を循環し、1曲以下は上下とも無効。移動先は先頭、A/B選択を維持し、再生中のみ再生を継続する。キー用語と配色は[UI用語](UI_TERMINOLOGY.md)。

版切替は同じ曲のversions保存順を循環し、末尾から先頭へ戻る。原音割当からは先頭の版へ進む。1版しかない場合は変更なし。current/acceptedは変更しない。mastering_comparison_cycle(project_id,song_id,slot,base_revision,request_id)で保存し、再試行を冪等にする。比較metadata操作は音声lane外でGUI作業mixを変更しない。非選択側の変更は再生を維持。選択側は保存後同位置へ反映。

playback_switch_mastering(playback_id,project_id,song_id,comparison,revision)は対象・版の検証後旧sessionを停止し、停止ackのframeを新sessionへ渡す。再生中は再生を、一時停止中は一時停止を引き継ぐ。停止操作は切替を取消し、連続切替は重複開始を拒否する。旧sessionの停止失敗時は新sessionを開始しない。失敗は明示し旧音へ戻さない。旧engineは無音隙間あり。長さが異なる場合は新しい音源の末尾内へclampする。monitor音量・output device・loop設定を引き継ぐ。GUIはsession/版/位置を照合。選択だけでは保存割当を変えない。

PlaybackRequestに任意start_pausedを追加。対応featureはplayback.initial_pause.v1。停止位置ackはplayback.position_switch.v1を要求し、旧engineの受付だけの停止と区別する。未対応engineへ一時停止開始を要求しない。nativeはcallback登録前にpause設定する。pause/stopはcallbackが停止を認識してから位置を返す。callbackへlock・I/O・allocationを追加しない。

比較表示はA/Bの版名と直近試聴の400ms RMS・sample peak（dBFS）。LUFS/true peak/曲全体測定と呼ばない。FX後・monitor音量前のstereo平均二乗と最大振幅をnativeで集計し、既存statusで低頻度取得する。未試聴は「未測定」、無音は−∞。選択曲/版/原音種別ごとに照合し、古いstatusを別slotへ表示しない。非再生側は最終値を保持し「直近試聴」と明示する。同じ版のA/Bは同じ記録を参照する。比較名は波形上段A・下段Bに常時表示し、各行右端にその音のRMS/Peakを揃える。値は直近試聴、未測定は明示。名前はメーター幅を除く残り幅まで表示し、実測文字幅で省略する。全文はtooltipへ。波形は縦幅いっぱいに描き、帯なしでA/B情報を白文字・文字周囲の暗い縁取りで重ねる。再生済領域はその側の暗い色で矩形塗りし、緑へ変えない。ノブ既定は右端のmonitor音量だけ。既存の個人割当は設定として変更可能。

検証: 入替・取消/失敗・meter（実機/fake別）。

UIは切替世代/再生IDで旧応答を破棄する。pad DOMを維持し、属性・画像は変更時のみ更新する。画像はdecode後に差替え、古いdecode完了は破棄。busyだけでSVGを再生成せず、focusと押下を保持する。

高速比較: 対応engineのplayback.prepared_comparison.v1では、固定A/Bの生成済みfloat WAVを読み込み、同じdevice/session内で240 samples/5msの線形crossfadeを行う。再生操作では音声を生成しない。callbackには準備済みPCMだけを渡し、追加I/O・allocation・lock・plugin処理を行わない。一時停止中は位置を動かさず即座に選択する。選択ack後にApplicationのtarget/revisionとGUIを更新する。stop取消を優先し、別slotのmeterを流用しない。準備済みpairと同じ版なら再ロード不要。版入替はplayback.replace_comparison.v1で非再生PCMを制御threadでロードし、同sessionの240 samples/5ms crossfadeで選択する。callbackにI/O・解放を入れない。未準備なら旧音を維持しエラー、停止して黙って代用しない。
音声cacheはProjects/<id>/temp/mastering-preview。完成版索引は版identityと出力hashを保持し、engine/FX更新後も完成版を再生成せず、旧FXのロードを要求しない。engine fingerprint・音声処理plan（provenanceのrevision/nameは除外）・原音hash・tailで識別し、出力hashを検証して再利用する。全保存版数＋曲数×2（最低8）のcache、PCM合計256MiBまで。GUI作業mix・上限超過は再生を拒否する。未対応engineのみ従来のlive切替となり無音隙間あり。波形APIは準備済み版の処理後音声を優先し、未生成時は原音波形と明示する。GUIはA/B波形を最大2個先読みして切替時に即反映し、準備完了後に再取得する。


cache: 割当・名前で再renderしない。gain/FX/state/source/clip/tail/engine変更は無効化する。同一音声はrevisionを跨いで再利用し、変更側だけrenderする。

事前準備: マスタリングの保存変更後に、全曲の保存版とA/Bを固定revisionで順次準備する。mastering_prepare(project_id)はjob_idを返し、同revisionは統合。job_status/cancelで進捗・失敗・取消を確認できる。保存と音声完成は区別する。AIはjob成功を待って編集完了を報告する。準備も単一音声laneを使い、再生中は待機する。終了時は取消、明示要求で再試行する。出力hashが一致する版は再利用し、破損cacheは再生成する。GUI作業mix・未対応engine・PCM上限はskippedを記録する。再生はcacheを検証し、欠損は音声未生成として拒否する。作品選択で生成しない。回帰: 生成・重複・取消・cache。

マスタリングの主書き出しは「書き出し」。mastering_downloadは押下時のrevision/曲/選択A/Bを固定し、検証済float32 WAVから出力を作る。未準備なら同laneで準備し、失敗時に原音を代用しない。取得済音声のコピーはlane外。アルバム/形式指定は従来の詳細書き出しを維持。

書き出しはpadモードを変えず専用dialog。保存先をOS pickerで許可し、WAV/FLACは16/24bit（WAVのみ32float）、44.1/48/88.2/96kHz、MP3は128/192/256/320kbps CBR・44.1/48kHzを選ぶ。不適合を拒否し、既定はWAV/48kHz/24bit。整数化はTPDF dither、周波数変換は高精度swr。既存PCMを変換しFXを再処理しない。変換は音声lane、コピーはlane外。確定時は再生を位置保持で停止し、paused待機とのdeadlockを避ける。codec/周波数/bit数を検証して保存、失敗時はdialog内へ表示する。

保存名は曲名（なければ作品名）＋拡張子を自動入力・編集可能とする。形式変更で拡張子を追従、OS禁止文字・パス区切りは置換してpickerへ渡す。download専用キーは11px・高さ32px以上、下段はflex/gap 10pxで分離する。

操作中padの点線枠なし。busyでも画像・選択枠・実線focusを維持。

stripクリック/dragは全状態で整数frameへseekし、右端はduration−1へclampする。terminalはpoll停止、seek前/中のstatusは破棄。停止後も位置を保ち次回再生へ渡す。

再生試験のfakeもdescribeで比較対応を明示する。
