# AIDAW

Vibe Coding DAW。作品編集はAI、即時操作はGUI・機器。
**作業に合う入口だけ読み、追加文書はその入口の条件に従う。Docs全体を一括で読まない。**

| 作業 | 最初に読む |
|---|---|
| 作品の作成・編集・マスタリング | [作品編集](Workflows/EDITING.md) |
| セットアップ・起動 | [セットアップ](Workflows/Development/SETUP.md) |
| 本体の実装・修正 | [実装](Workflows/Development/IMPLEMENTATION.md) |
| GUI・スキン・機器 | [操作系](Workflows/Development/CONTROLS.md) |
| 変更を作者に共有・PR作成 | [還元手順](Workflows/Development/CONTRIBUTE.md) |
| 文書の変更 | [文書規約](Docs/Development/DOCUMENTATION.md) |

**機能追加・バグ修正は文書先行。製品コードを変更する前に[設計確定手順](Workflows/Development/DESIGN_FIRST.md)を完了する。**

配置は Core / Projects / Plugins / Libraries / Workflows / Docs。旧配置へfallbackしない。詳細は作業入口から辿る。
作品の選択確認は作品編集にだけ適用する。対応状況はコードと検証根拠で確認し、未実装を推測で補わない。ユーザーの明示指示を優先する。
