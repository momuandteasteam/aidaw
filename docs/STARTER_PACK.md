# 標準音源・エフェクト

標準セットアップは、手持ちプラグインのないmacOS / Windowsでも制作を始められるよう、次のVST3をソースからビルドし、サーバーのカタログに登録する。システムのプラグインフォルダにはインストールしない。

| 名前 | 実装・役割 | 初期状態 |
|---|---|---|
| AIDAW GM | TinySoundFont + FluidR3 GM。128 GMプログラムとGMドラム | ピアノ、出力 −6 dB |
| AIDAW EQ | Low shelf / Mid bell / High shelf。低域補強、中低域整理、高域調整 | 全バンド 0 dB |
| AIDAW Limiter | ステレオリンク、5 ms先読み、可変リリース、入力ドライブ | Drive 0 dB、ceiling −1 dBFS |
| AIDAW Reverb | JUCEのFreeverb方式、入力ローカット、ルームサイズ、ダンピング、幅 | Wet 100%、low cut 180 Hz |

## セットアップと配置

通常どおり `node scripts/setup.mjs --client both`（またはOS別setup）で導入する。FluidR3 3.1のアーカイブ約129 MiBをDebian配布元から取得し、固定SHA-256で検証する。抽出するのはGM bank・COPYING・READMEのみ。展開先パスはアーカイブから任意に指定できない。サイズ制限、タイムアウト、不完全ダウンロードの拒否、テンポラリ経由の公開、正しい既存bankのオフライン再利用を行う。失敗時に簡易波形へ置換しない。

- `build/starter-assets/FluidR3_GM.sf2`：約142 MiBの共有音源。作品ごとに複製しない。
- `build/starter-assets/FluidR3-{LICENSE,README}.txt`：音源の必須告知。
- `build/starter-source/tsf.h`：固定コミット・SHA-256検証済みのレンダラー。
- `build/aidaw-starter-{gm,eq,limiter,reverb}_artefacts/Release/VST3/`：生成したVST3。
- `AIDAW_HOME/PluginLibrary.aidaw/state/host-catalog.json`：そのサーバーの登録結果。
- `AIDAW_HOME/Setup.aidaw/jobs/<job>/report.json`：取得・ビルド・検証結果。

サーバーを別の場所へ配置するときは、engineの親ディレクトリ（通常bin）の隣に `starter-assets` を置く。別配置が必要ならサーバープロセスの `AIDAW_SOUNDFONT` に絶対パスを指定できるが、同じbankのハッシュが必須。クライアント側への音源インストールは不要。外部DAWへVST3自体を持ち出すための汎用インストーラーは提供していない。ステムは通常どおり別DAWで使用できる。

## 制作・パラメーター

`catalog_search(query="AIDAW")` → `plugin_inspect` で実際のプラグインID、パラメーターID、GMプログラム名を確認する。プログラム番号はAPIでは **0〜127**（通常のGM一覧の1〜128から1を引く）。パートごとにインスタンスを分け、`program` を設定する。ドラムはMIDI channel 10、または `Drum Kit` を有効化する。256ボイスを上限とし、CC・ピッチベンドはレンダラーが受け取ったMIDIに対応する。現在のプロジェクト演奏モデルはノート中心で、任意CC・ピッチベンドを編集する新しいAPIはこの追加では実装していない。

すべてのパラメーターは既存APIどおり正規化値0〜1。`plugin_inspect` の表示値・選択肢を照合して設定し、保存状態の再読み込み検証を行う。EQ・リミッターはマスターまたはトラックinsert、リバーブはsend busに置く。標準リバーブは最初のサンプルから100% wetで、send returnにdryを混ぜない。insertで使う場合はWetを下げる。returnの音量はミキサーで調整し、独立ステムとして保存する。

手持ち音源・Kontakt等の内部ライブラリも先に確認し、曲調に適したものを選ぶ。音源がない場合、または標準音源を希望する場合には、AIDAW GMを `plugin_first` のまま明示的に選択できる。指定された有料音源の失敗を黙ってGMへ置換する規約ではない。bankの状態には絶対パスを含めず、同じ固定bank・同じプラグインバージョンを各環境でセットアップする。AUとVST3の自動代替は行わない。

## 音質と検証の範囲

リミッターは **サンプルピーク制御**。オーバーサンプリングによるtrue-peak保証はなく、MP3などへ変換した後のピークも別途確認する。5 msはホストに報告され既存PDCで補償される。ドライブを上げれば音圧は上がるが、歪みやダイナミクス損失も増えるため、目標音圧を全曲一律に固定しない。

リバーブの残響は明示した `tail_seconds` まで書き出される。例は4秒以上、長いルーム設定では12秒などに広げて終端を確認する。残響の長さはPDCの対象ではない。EQの急激なオートメーション変更で無音切替を保証するものではなく、通常は緩やかなカーブを使う。

`tests/starter.test.mjs` は商用プラグインなしで、GM名一覧・複数パートの発音・状態再読み込み・独立リバーブステム・EQ周波数特性・limiter ceiling/PDC・リバーブのwet出力と減衰・破損ダウンロード拒否を確認する。自動検証は実音声の測定であり、呼び出し元AIの試聴評価を行ったという意味ではない。Windowsは実機で別途検証し、Macの試験をWindows実証と扱わない。

## ライセンス・取得元

- [TinySoundFont](https://github.com/schellingb/TinySoundFont)：MIT、固定コミット `853a0a171759f1ddba0de1442133a75912bbeffa`。[告知](licenses/TinySoundFont-LICENSE.txt)。第三者リポジトリへのソース投稿は行わない。
- [FluidR3 3.1アーカイブ](https://deb.debian.org/debian/pool/main/f/fluid-soundfont/fluid-soundfont_3.1.orig.tar.gz)：Frank WenによるMIT。[COPYING](licenses/FluidR3-LICENSE.txt)、[README・協力者一覧](licenses/FluidR3-README.txt)。アーカイブSHA-256 `2621acaa1c78e4abdb24bdd163230cc577e61276936d6aa6e3180582142f0343`、GM bank SHA-256 `74594e8f4250680adf590507a306655a299935343583256f3b722c48a1bc1cb0`。
- [JUCE Reverb](https://docs.juce.com/master/classjuce_1_1Reverb.html)：Freeverbの方式を用いたJUCE実装。JUCE 8はAGPLv3 / commercialのデュアルライセンスであり、MITではない。[JUCE告知](licenses/JUCE-LICENSE.md)。
- AIDAW本体と `native/StarterPlugin.cpp` は [AGPL-3.0-only](../LICENSE)。JUCEを含む生成物を再配布・サーバー提供する場合には、そのライセンス条件と対応するソースの提供を維持する。
