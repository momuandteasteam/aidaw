# AIDAWの責務と境界

読む条件: 本体の実装責務を決める、または複数component間の変更を設計するとき。
正本範囲: 製品の役割分担とcomponent間の依存。個々の型・操作・保存形式は境界別契約が所有する。
関連要件: R-002, R-011, R-014。

## 製品の役割

AIDAWはVibe Coding DAW。Codex/Claude Codeが具体的な作品編集を行い、GUIと機器はAI応答待ちのない再生・試聴・読込・書き出しを担う。GUIに全データと編集操作を常時並べない。人が操作する内容は [CONTROLS](CONTROLS.md)、作品を変更する順序は [EDITING](../../Workflows/EDITING.md) に従う。

作品正本、試聴選択、実行中audio graph、表示snapshotを別の状態として扱う。画面切替で作品を書き換えず、render結果を新しい編集正本にしない。

## 境界

| 境界 | 責務 | 詳細を読む条件 |
|---|---|---|
| ApplicationPort | 共通operation、入力検証、結果。HTTP/MCP/CLI/desktopの接続先 | APIや選択共有を変える場合は [APPLICATION](../Contracts/APPLICATION.md) |
| Domain | composition/masteringの意味、検証、選択対象のcompile | モデルを変える場合は [DOCUMENTS](../Contracts/DOCUMENTS.md) |
| WorkspacePort | 正本のread/create/change/history/restoreに必要な保存境界 | 保存やZIPを変える場合は [HISTORY](../Contracts/HISTORY.md) |
| EnginePort / EngineDriver | portable planを実行。driverだけがnative表現を知る | audioを変える場合は [ENGINE](../Contracts/ENGINE.md) |
| Control runtime / skin | runtimeが状態とdispatchを所有し、skinが表示する | 表示moduleを変える場合は [SURFACE](../Contracts/SURFACE.md) |
| Plugin/controller package | 独立した実行単位と機器イベント変換 | 拡張を変える場合は [EXTENSIONS](../Contracts/EXTENSIONS.md) |

transportはApplicationPortの翻訳であり、native commandへの透過proxyではない。skinやcontrollerはService/Engine/Node/Electron実装を直接呼ばない。OS dialog、device接続、認証はhost/adapter側が所有する。配置と禁止依存は [DIRECTORIES](DIRECTORIES.md) が正本。

## 実行と状態

applicationは検証済み作品から対象のgraphをcompileし、EnginePortへ渡す。compositionは必要な複数track、masteringは指定曲・版の一つのstereo経路を実行する。modeごとに別のDSP hostや音声device所有者を作らない。

全音声処理は同じaudio laneを通り、一件ずつ実行する。再生sessionもその寿命を通してlaneを保持する。詳細な排他・取消・照会の契約は [ENGINE](../Contracts/ENGINE.md) に置く。

GUIとAIは同じworkspaceの選択共有を読み書きする。共有選択は作品revisionとは別物。選択から作品更新へ至るガードの実装範囲は [APPLICATION](../Contracts/APPLICATION.md) を確認する。

## 交換可能性の確認

別実装は同じportを実装し、同じuse case試験を通す。fakeでの成功、native実音での成功、実機確認を区別する。constructor injectionがあるだけで全処理の分離完了と数えない。

入口は [application-contract](../../Core/Source/Contracts/application-contract.ts)、[workspace](../../Core/Source/Contracts/workspace.ts)、[engine-contracts](../../Core/Source/Contracts/engine-contracts.ts)。Service等に残る具象依存と検証根拠は [VERIFICATION](../Development/VERIFICATION.md) に集約する。
