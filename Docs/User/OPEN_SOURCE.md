# ソースの利用と貢献

AIDAWのライセンスは `AGPL-3.0-only`。正確な条件は [LICENSE](../../LICENSE)、同梱物の表示は [NOTICE](../../NOTICE) を参照してください。第三者の音源・素材は、それぞれのライセンスに従います。

公開対象は本体ソース、契約、テスト、導入ツール、配布可能な参照情報です。個別作品の原音・書き出し・アートワーク、商用プラグインや音源ライブラリ、保存プリセット、認証情報、端末設定、実機カタログをコミットしないでください。

開発はCore、作品はProjects、導入物はPlugins、共有素材はLibraries、作業手順はWorkflows、説明はDocsに分けます。配置の正本は [DIRECTORIES](../Architecture/DIRECTORIES.md) です。

```sh
npm ci --prefix Core
npm --prefix Core run configure:native
npm --prefix Core run build:native
npm --prefix Core run check:public
npm --prefix Core test
```

変更の目的とユーザーに見える振る舞い、検証したOS・architectureを記録してください。商用製品なしで再現できる回帰試験を優先し、特定製品・実デバイスが必要な試験をスキップした場合は区別します。依頼されていないpush・公開は行いません。

実装時だけ [IMPLEMENTATION](../../Workflows/Development/IMPLEMENTATION.md)、文書編集時だけ [DOCUMENTATION](../Development/DOCUMENTATION.md)、検証時だけ [VERIFICATION](../Development/VERIFICATION.md) を読んでください。

## ステム分離

Spleeter 2.4.2と公式4stemsモデルはMIT。学習済み重みも含む根拠・導入方式は[分離契約](../Contracts/SEPARATION.md)、原文は[Spleeter LICENSE](../../Libraries/Licenses/Spleeter-LICENSE.txt)。TensorFlow環境とモデルは取得して導入し、本repoのsourceにbinaryを含めない。
