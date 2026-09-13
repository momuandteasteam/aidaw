# 観測済みプラグイン・メタデータ

`reference-plugins.json` は、AIDAW標準プラグインの識別情報、公開パラメーター、プログラム、バスを保存する公開用カタログです。プラグイン本体、サンプル、認証情報、インストール先、現在値、保存状態は含みません。

このファイルに載っていても、ビルド成功や音質、全機能の互換性を保証しません。`plugin_id`・形式・バージョンが一致する候補を探すための既知メタデータとして使い、利用時にはそのサーバーで再スキャン・状態復元・試奏を行います。

MCP/APIの `catalog_reference_search` で名前、メーカー、公開パラメーター名、プログラム名を検索できます。結果は `reference_only` であり、現在接続中のサーバーで利用できるものは `catalog_search` で別に確認します。

実機カタログの更新はビルド後に次を実行します。macOSではVST3とAudio Unit、WindowsではVST3を走査します。途中結果は単一jobへ保存され、次回または同じ実行内で再開されます。

```sh
npm run inventory:plugins
```

出力は既定で `AIDAW_HOME/PluginLibrary.aidaw/outputs/portable-plugin-catalog.json` に保存され、Gitには入りません。共有する場合は、インストール製品名・バージョン・program名が利用環境を推測できる情報であることを確認し、明示的な `--output` を指定します。公開参照カタログを差し替えて検索する場合は `AIDAW_REFERENCE_CATALOG` にファイルを指定できます。

完全なローカルDBは `AIDAW_HOME/PluginLibrary.aidaw/state/catalog.sqlite`、失敗を含むチェックポイントは `AIDAW_HOME/PluginLibrary.aidaw/jobs/<job-id>/` にあります。

詳細なデータ境界、再開方法、現在の収録件数は [プラグイン・インベントリ](../docs/PLUGIN_INVENTORY.md) を参照してください。
