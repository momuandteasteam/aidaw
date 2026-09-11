# レンダリング不要のプレイヤー

現在のプロジェクト設定をWAVへ書き出さず、AIDAWを動かしているマシンの音声出力へ直接流す。制作と編集はMCP/APIから行い、再生操作に限ってデスクトップGUIも利用できる。

## AIDAW Player

プロジェクト一覧、出力デバイス、再生・一時停止・停止・シークを操作するクロスプラットフォームの小型デスクトップアプリ。下記APIと同じServiceおよび音声グラフを使い、WAVへの事前レンダリングは行わない。

別の曲を選ぶと、再生中の曲を停止してから新しいプロジェクトを読み込む。プロジェクト切り替え中と、再生開始時に音源・エフェクトを初期化している間はプレイヤー操作をロックし、読み込み競合を防ぐ。

```bash
npm run player
```

macOSアプリを作る場合は `npm run player:package:mac`、WindowsアプリはWindows実機で `npm run player:package:win` を使う。

## 操作

- `playback_devices`: サーバーで利用できる出力デバイスを確認する。
- `playback_start`: 現在のproject revisionを固定して再生する。開始frame、末尾tail、出力デバイス、ループ範囲を指定できる。
- `playback_status`: 再生位置、状態、revision、デバイス、処理遅延、XRUN数を読む。
- `playback_pause` / `playback_resume`: プラグインを保持したまま一時停止・再開する。
- `playback_seek`: 48 kHzのframe位置へ移動する。移動位置をまたぐMIDIノートはnote-onを追跡する。
- `playback_stop`: 音声デバイスとプラグインを解放する。

プレイヤーは音源、トラックインサート、pre/post-fader send、FX return、mute/solo、パン、マスターFX、automationを一つのリアルタイムグラフで処理する。並列経路はプラグインが報告した静的遅延で整列する。リアルタイムでは遅延を先読みして除去できないため、処理遅延とデバイス遅延は実際の発音開始に加わる。

## 制作時の流れ

1. `playback_start`で現在のrevisionを聴く。
2. 必要ならpause、seek、loopを使って確認する。
3. `playback_stop`で停止する。
4. `project_apply`で修正し、新しいrevisionを`playback_start`で聴く。
5. 採用後に`render_start`で完成ファイルとステムを書き出す。

再生中のプロジェクト編集は再生グラフへ自動反映しない。どの設定を聴いているか曖昧にしないため、開始時のrevisionを最後まで保持する。

## サーバー利用

音はMCPクライアント側ではなく、AIDAWサーバーの出力デバイスから鳴る。再生はレンダー、試奏、プラグイン検証と同じ単一音声処理キューを占有する。状態照会、停止操作、完成済み成果物の取得は待ち行列に入らない。

現在は48 kHz・ステレオ・固定テンポ専用。音声入力、録音、MIDIキーボード入力、可変テンポ、動的PDC、ネットワークへの音声ストリーミングには対応していない。
