# 本体を変更する

読む条件: AIDAW本体・契約・配置を実装変更するとき。

最初に [設計確定手順](DESIGN_FIRST.md) を実行する。設計文書の更新・確定より先に実装を変更しない。

1. 変更する責務を特定する。ファイル追加・配置・保存先を変える場合は [DIRECTORIES](../../Docs/Architecture/DIRECTORIES.md)、境界が不明または複数に跨る場合は [SYSTEM](../../Docs/Architecture/SYSTEM.md) を読む。新しいrootカテゴリを独断で追加せず、既存ユーザーデータを暗黙に移動・破壊しない。
2. 変更対象の契約だけを読む。APIは [APPLICATION](../../Docs/Contracts/APPLICATION.md)、音声は [ENGINE](../../Docs/Contracts/ENGINE.md)、保存は [DOCUMENTS](../../Docs/Contracts/DOCUMENTS.md)、GUIは [CONTROLS](CONTROLS.md)。version、capability、単位、stable ID、エラー、保存状態への影響を記録する。
3. プラグイン遅延・初期化・状態復元・レンダー・転送の修正は共通本体へ実装する。曲別スクリプトだけに回避策を置かない。曲固有値は作品データへ置く。
4. HTTP/MCP/CLI/GUIは共通application契約を使う。音声処理は全体で常に一件、試奏・バッチ・変換も同じlane。接続、状態照会、完成済み成果物取得は音声キューへ入れない。
5. [VERIFICATION](../../Docs/Development/VERIFICATION.md) に従い必要な契約・実音・UI検証を行う。未実装や実機未検証を対応済みと報告しない。

要求との整合を調べるときだけ [REQUIREMENTS](../../Docs/Development/REQUIREMENTS.md)。文書を変更するときだけ [DOCUMENTATION](../../Docs/Development/DOCUMENTATION.md) を読む。
