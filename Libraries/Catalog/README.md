# 観測済みプラグイン・メタデータ

reference-plugins.jsonとContributions/*.jsonは公開参照情報です。catalog_reference_searchで検索できます。ローカルで使える証拠ではなく、利用時は形式・版の一致とロードを確認します。

「スキャン結果を作者に共有して」とAIに依頼すると、対象製品の公開パラメーター情報だけを準備し、GitHubのdraft PRで貢献できます。製品名と版は公開されます。送信は明示依頼時だけです。[還元手順](../../Workflows/Development/CONTRIBUTE.md)。

全体探索は `npm --prefix Core run inventory:plugins`。ローカルDBはCore/State/Catalog/state/catalog.sqlite、途中結果は同じCatalogのjobs、出力はoutputsです。DB全体やportable-plugin-catalog.jsonをそのまま公開しないでください。
