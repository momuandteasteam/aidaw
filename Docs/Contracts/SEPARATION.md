# ステム分離

読む条件: 分離エンジン、分離作品、ステム取得、選択mix出力を変更するとき。
正本範囲: 分離の入出力・来歴・失敗・保存と検証条件。
関連要件: R-015。
Design status: ready

## 作品と処理

schema 3にkind=separationを追加する。composition graphを再利用して音声stemのgain/mute/soloと再生を扱い、separationにsource asset、engine/model識別子、成果物job IDを保存する。通常の作曲作品と明示的に区別する。初期版のstemは全長・frame 0配置、pan=0、FX/sendなし。編集はgain/mute/soloを対象とし、部分clipやFX付きmixへの拡張は別設計とする。新規時は分離結果なし。原音はsource assetとして保持し、モデルへreferenceを代用しない。結果の各stemはderived assetとしてsourceへの来歴を持つ。

project_create(kind=separation) → asset_import → separation_start(project_id,source_asset_id,base_revision,request_id)で開始する。取消はcommit前まで。commit完了後に取消が届いても保存済み結果を成功として返す。処理は非同期job、queued/running/succeeded/failed/cancelledをjob_statusで照会する。音声laneを再生・render・変換と共有する。先に鳴っている再生の停止をGUIから行える。処理中のメタデータ取得・完成成果物downloadは待たせない。

分離完了時に48 kHz stereo WAVへ変換・検証し、一度の履歴commitでstem trackと来歴を保存する。各stemの長さと開始frameを一致させる。base_revision競合時は既存作品を上書きせずjobを失敗とし、生成物はjob内に残す。再実行で既存stem trackを置換することを明示し、以前の版・assetは履歴に残す。request_idは同一入力の再送で同じjobを返し、異なる入力での再利用を拒否する。

原音は30分以下。推論は有限長chunkに分割してメモリを抑え、重なり部分を接続する。変換・推論processは取消可能で、途中の出力を成功扱いしない。破損・NaN/Infinity・不足stem・長さ不一致・未導入engineは明示エラー。推定stemは完全な原音復元や漏れのない分離を保証しない。

## エンジンとライセンス

SeparationPortはモデル識別、入力path、出力directory、AbortSignalから名前付きstem pathを返す。Applicationは個別のPython/TensorFlow構文を知らない。標準はSpleeter 2.4.2の4stems（vocals/drums/bass/other）、16 kHz拡張帯域設定。別モデルに黙って切り替えない。

[作者の論文](https://github.com/deezer/spleeter/blob/master/paper.md)はコードと学習済みモデルをMITと明記する。[公式LICENSE](https://github.com/deezer/spleeter/blob/master/LICENSE)をLibraries/Licensesに保持する。性能は素材・機器依存、最新最高品質とは記載しない。モデル・依存を隔離して導入し、取得元とhashをreceiptに残す。非商用限定・利用条件不明の第三者checkpointを標準へ混在させない。Demucs公開重みは[作者回答](https://github.com/facebookresearch/demucs/issues/327#issuecomment-1134828611)で科学研究用途とされる。リポジトリ・配布物へ同梱せず、セットアップ時に公式配布元から取得する。

adapter/workerはCore/Source/Adapters/node/media、toolはCore/Tools。環境/重み/receiptはPlugins/Engines/<engine>。uv PythonはAIDAW_HOME/Plugins/Engines/python（UV_PYTHON_INSTALL_DIR明示時はその値）へ置き、利用者側uv Python/linkを使わない。取得物はGit除外、Core/Cacheは一時用。setupで両環境を導入。configure-onlyは再構築せず、失敗時は再実行方法を返す。

Demucs 4.0.1とHTDemucsをSpleeterから隔離して導入する。setup-separationは両方を導入し、setup-demucs単独でも追加できる。公式loaderで重み取得・loadを確認し、版・取得元・全checkpoint hash・コードと重みそれぞれの利用条件をinstallation.jsonへ記録する。既存環境の再実行では再取得不要なcheckpointを再利用する。失敗時は成功receiptを残さない。専用launcherはTORCH_HOMEを導入先へ固定する。既定分離エンジンは自動変更しない。検証は実導入・再実行・checkpoint loadとGit除外、両installerの接続を含む。

## 取得・GUI

separation_export(project_id,request_id,revision,kind=stems|mix,format=wav|mp3|flac)は固定版を対象にする。stemsはmute/soloに関わらず全stemのWAVと来歴manifestをZIPにする。mixはsoloが一つでもあればsoloだけを選び、muteを優先して除外し、gainを反映する。選択が空なら拒否する。書出しによって保存mute/soloを変えない。元のstemは非破壊で保持し、clip回避が必要なら共通gainを下げた量をmanifestへ記録する。

GUIファイルメニューで分離作品を作成し、原音を選び分離開始。分離操作ダイアログに進捗・stemごとのmute/solo・ZIP保存・選択mix保存を置く。通常面は左上4×2で上段「停止/先頭・再生/一時停止・書き出し・前のトラック」、下段「ミュート・ソロ・方式・次のトラック」。移動は再生位置を維持。範囲外方向と未分離の操作は無効。mute/soloは既存再生mix操作。書き出しは分離・保存ダイアログを開き、パッドmode/選択を維持する。保存mixはダイアログで編集。stem行は名前とmute/soloを横並びにし、540×700の画面では保存ボタンまで表示する。desktopの保存ダイアログとHTTP artifact機構を使い、任意pathのdownload proxyを作らない。

## 検証

fake portで受付/失敗/取消/retry/競合、ZIP/mix、来歴、履歴/archiveを検証。導入はUV_PYTHON_INSTALL_DIRの既定/明示値、両installer一致、壊れた利用者側linkからの隔離を試験。実engineは短音声の4stem、rate/channel/length/非同一性を確認。技術/聴取を分け、未実行OS/GPUを検証済みとしない。

ミュート/ソロは図記号を使わず選択stem名を主表示: vocals=ボーカル、drums=ドラムス、bass=ベース、other/未知=その他。下に操作名、tooltipに対象名。上下移動で文字・押下状態を更新。72pxでも名前を省略しない。
