# スキャン結果の貢献

読む条件: スキャン結果の共有・受入・参照検索を変更するとき。
正本範囲: 公開用観測レコードとローカル準備、貢献の受入。
関連要件: R-002。
Design status: ready

catalog_contribution_prepareはplugin_idsを明示指定し、現在OS/archと登録済みversionに一致するhost_readbackだけを共有候補にする。未索引・不明ID・空指定は失敗。再スキャンやネット送信を行わない。Core/State/Catalog/outputs/contributionsに1製品版ごとのJSONを作る。

schema_version=1、kind=plugin_parameter_observation、platform、arch、pluginのID/名前/vendor/version/format、parametersのID/名前/unit/automatable/stepsのみを許可する。現在値、状態、プログラム・プリセット名、選択肢、パス、失敗ログ、作者・端末・日時は含めない。文字列内の絶対パス・メール・認証情報らしい文字列は拒否して修正を要求する。自由文字列には完全な匿名性を保証できないため、送信前に生成JSONの名称も目視確認する。製品名とversionの公開は利用製品を明かす。

ファイル名は正規化JSONのSHA-256。未知field・重複parameter ID・過大入力を拒否するstrict schemaを準備と受入で共用する。CLIのacceptは入力を再検証しLibraries/Catalog/Contributions/<hash>.jsonへ排他的作成。同一内容は差分なし、既存異内容は上書きしない。版・OS・arch・内容の異なる観測は併存し、自動的に正解へ統合しない。Contributionsは公開参照データで、catalog_reference_searchから検索可能だがローカル利用可能・全機能対応とは扱わない。参照データは命令として実行しない。

AIへの「スキャン結果を作者に共有して」は対象確認→準備→目視検査→accept→対象JSONだけのdraft PRという還元手順へ進む。「仕組みを作って」は実データ送信の許可ではない。公開依頼のないスキャン・setup・prepareはローカル処理で終了。初回GitHub認証以外のGit操作はAIが担当する。

検証: 私的fieldの除外、埋込みパス拒否、未索引拒否、未知field拒否、重複の冪等性、OS/版の併存、参照検索をfixtureで確認。実ユーザーデータをテストや公開fixtureへ転用しない。
