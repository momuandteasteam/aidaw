# 要件の所在

必要なIDから所有文書へ進む。要件の本文は所有文書だけが正本。実装状態・source・試験・未確認事項は [VERIFICATION](VERIFICATION.md) に集約する。ここへ仕様や進捗を複製しない。

| ID | 識別名 | 所有文書 |
| --- | --- | --- |
| R-001 | 固定6rootと責務分離 | [DIRECTORIES](../Architecture/DIRECTORIES.md) |
| R-002 | Vibe Codingの役割分担、AIとGUIの選択共有 | [EDITING](../../Workflows/EDITING.md)、[APPLICATION](../Contracts/APPLICATION.md) |
| R-003 | 曲制作の多トラック、MIDI／audio、FX、send／return／master | [DOCUMENTS](../Contracts/DOCUMENTS.md)、[PRODUCTION](../../Workflows/Composition/PRODUCTION.md) |
| R-004 | アルバム曲別の不変版、単一ステレオ処理、任意世代A/B | [MASTERING](../../Workflows/Mastering/MASTERING.md)、[DOCUMENTS](../Contracts/DOCUMENTS.md) |
| R-005 | 命令単位の差分履歴、再試行、版競合、巻戻し | [HISTORY](../Contracts/HISTORY.md) |
| R-006 | Projects正本と持出し用.aidaw.zip、音声書出し | [HISTORY](../Contracts/HISTORY.md)、[APPLICATION](../Contracts/APPLICATION.md) |
| R-007 | 即時再生中心、コンパクトUI、基本8キーと隣接配置 | [CONTROLS](../Architecture/CONTROLS.md) |
| R-008 | 波形シーク、ノブ、一時値表示、制作ミキサー | [CONTROLS](../Architecture/CONTROLS.md)、[操作規約](../../Workflows/Development/CONTROLS.md) |
| R-009 | 個人用配置と交換可能なskin | [SURFACE](../Contracts/SURFACE.md)、[EXTENSIONS](../Contracts/EXTENSIONS.md) |
| R-010 | Stream Deck／Plus、Ulanzi、Push、Launch Control | [EXTENSIONS](../Contracts/EXTENSIONS.md)、[操作規約](../../Workflows/Development/CONTROLS.md) |
| R-011 | engine／API／保存の交換と疎結合 | [SYSTEM](../Architecture/SYSTEM.md)、[ENGINE](../Contracts/ENGINE.md)、[APPLICATION](../Contracts/APPLICATION.md) |
| R-012 | 標準音源／FXを高速な独立pluginとして導入 | [EXTENSIONS](../Contracts/EXTENSIONS.md)、[SOUNDS](../../Workflows/Composition/SOUNDS.md) |
| R-013 | 契約版交渉と明示的な文書変換 | [APPLICATION](../Contracts/APPLICATION.md)、[DOCUMENTS](../Contracts/DOCUMENTS.md)、[ENGINE](../Contracts/ENGINE.md) |
| R-014 | 音声処理は共有一件、照会・完成物取得は並行 | [SYSTEM](../Architecture/SYSTEM.md)、[ENGINE](../Contracts/ENGINE.md) |
| R-015 | ステム分離作品・原音来歴・全stem ZIP・mute/solo mix出力 | [SEPARATION](../Contracts/SEPARATION.md) |

IDは改名・分割後も再利用しない。既存要件の変更は所有文書へ反映し、IDと参照先を維持する。新しい要件だけ新しいIDを割り当てる。
