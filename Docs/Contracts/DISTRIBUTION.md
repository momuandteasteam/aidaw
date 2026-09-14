# ビルド済み配布

読む条件: DECK・Audio Engine・標準VST3の配布を作成・変更するとき。
正本範囲: 配布物の内容、対象OS、整合性と作成手順。

Design status: ready

ソースの改行はGit属性でLFへ統一する。Windowsのcheckout時のCRLF化で文書budgetや設計hashを変えない。

Windows配布のnative本体はMSVC runtimeを静的リンクし、開発用Visual C++ runtime DLLを別途導入しないと起動できない構成を避ける。

Core/Tools/build-distribution.mjsがCore/Build/Releaseへ版・OS・architecture別のZIPを作る。対象はmacOS arm64、Windows 11 x64。macOS x64は別のnativeビルドが必要。標準音源はGMだけ、既存8プラグイン（GMと7エフェクト）を含む。Audio EngineとVST3は対象OS上でコンパイルし、Electronだけ別OS用にパッケージしても完全な配布版とは呼ばない。

配布のDesktopはビルド済みDECK、Nativeはengine executable・標準VST3・FluidR3 GM・ライセンスを持つ。利用者のProjects、設定、catalog実測値、絶対パス入りdesktop-install.json、認証情報を含めない。対象ソースと通知は対応する配布時点のものを保持する。公開前には対応ソースの提供方法、コード署名、公証を別途確認する。署名・公証なしの開発配布物を署名済みと表記しない。

manifestはschema_version=1、製品version、platform/arch、source commit、変更有無、ファイルごとのSHA-256・symlink先を持つ。native形式とarchitectureを検査し、対象不一致や不足はZIP作成前に失敗する。ファイル一覧は固定のbuild出力から作り、homeのPlugins全体をコピーしない。stagingを完成して検証してからZIPを公開し、SHA256SUMSも生成する。生成物はGit管理しない。

作成はnpm build→native configure/build→標準bank確認→DECK packaging→配布検査→ZIP。Windows環境がなければmacOSバイナリを代用せず未完成と明示する。CIは専用Windows配布branchへのpushまたは手動実行で対象OSの同じスクリプトを使い、artifactまで生成する。Git push・外部公開・Release作成は明示依頼がある場合のみ。

検証は配布対象不一致・必要ファイル欠損の拒否、manifest照合、ZIP内容、個人データ混入なし、native scan/renderの確認。配布ZIPの生成は初期setup全体のコンパイル不要化と区別する。現行setupとの接続は別変更であり、この工程で既存ユーザー設定を書き換えない。
