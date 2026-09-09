# プラグイン・インベントリ

## 二つの保存先

完全な実機DBは `AIDAW_HOME/PluginLibrary.aidaw/state/catalog.sqlite` に保存する。ホストから取得したパラメーター現在値、検証履歴、試奏、評価などはこのローカルDBだけに置く。プラグイン登録に必要な絶対パスとdescription XMLは同ディレクトリの `host-catalog.json` に置く。

ソース内の [`catalog/reference-plugins.json`](../catalog/reference-plugins.json) は、AIDAW標準プラグインだけを収録した公開用メタデータ。実機で観測した市販・第三者プラグインの一覧はGit対象外とする。ローカルの可搬カタログには次を収録する。

- plugin ID、名前、メーカー、バージョン、形式、楽器／エフェクト区分
- 公開パラメーターのID、名前、単位、automation可否、step数、選択肢
- 公開programの番号と名前、入出力bus情報
- 走査件数と、パスを除いた失敗情報

プラグイン本体、ライセンス、認証情報、インストール先、description XML、ユーザープリセット、保存状態、パラメーター現在値は含めない。Kontakt等のライブラリ／パッチ索引も実機ローカル情報であり、公開用カタログには含めない。program名はホストAPIだけではfactory/userを確実に区別できないため、実機カタログを第三者へ渡す前に確認する。

## 走査

`npm run inventory:plugins` はmacOSでVST3とAudio Unit、WindowsでVST3の既定検索場所を列挙し、候補ごとに別プロセスでscanとparameter readbackを行う。一つの候補がクラッシュ、タイムアウト、未認証、登録残骸などで失敗しても次へ進む。全体はサーバーの単一音声処理キュー上で実行する。

一括処理は `PluginLibrary.aidaw/jobs/<job-id>` の一つのjobだけを使い、候補ごとの状態を `status.json` に保存する。中断時に `catalog_inventory_resume` またはCLIの `--resume <job-id>` でrunning/pending候補から再開する。失敗済み候補を環境修復後に再試行する場合は、新しいインベントリを開始する。

```sh
npm run inventory:plugins -- --max-seconds 600
npm run inventory:plugins -- --resume <job-id>
```

既定出力は `AIDAW_HOME/PluginLibrary.aidaw/outputs/portable-plugin-catalog.json`。共有用のコピーが必要な場合だけ `--output <path>` を明示する。

## 検索と判断

`catalog_reference_search` は公開用カタログ、または `AIDAW_REFERENCE_CATALOG` で明示したローカルカタログを、名前、メーカー、パラメーター名、program名で検索する。結果は常に `reference_only`。現在のサーバーで利用可能かは `catalog_search`、正確な版のロードと状態復元は `plugin_verify`、音は `sound_probe` / `effect_probe` で確認する。

AUとVST3は同じ製品名でも別plugin IDとして記録する。保存状態を形式間で代用しない。インベントリの成功はparameter readbackまでで、音質、全programの発音、sidechain、automation、遅延、再現性、ライセンス利用可否の証明ではない。

## ローカル検証記録

2026-09-09の走査では、既定場所の264候補を処理した。263候補から265プラグイン形式を検出し、AIDAW標準4件を加えた269件を可搬カタログへ収録した。

- VST3 117件、Audio Unit 152件
- 楽器26件、エフェクト243件
- 公開パラメーター65,354件、program 5,409件
- parameter readback失敗0件
- Audio Unitの登録残骸1候補は `No plugin found`。実体がないためプラグイン件数には含めない

この件数は開発時の受け入れ検証記録であり、実データは公開リポジトリへ収録しない。Windowsや別マシンの利用可能一覧として扱わない。
