# WindowsのAIDAWを別PCから使う

音源・プラグインを持つWindows側で通常セットアップを完了します。同じAIDAW_HOMEを使うstdioサーバーを終了してから、repository rootで実行します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File Core/Tools/setup-remote-windows.ps1 -EnableTailscaleServe
```

Tailscaleは両PCで同じtailnetへ接続しておきます。スクリプトはloopback HTTP、認証トークン、ログオン時の常駐タスクを設定し、認証付きhealth確認を行います。トークンはアクセス制限付き環境ファイルに保存し、標準出力へ表示しません。Windows側Codexも同じHTTPへ接続させ、stdioとの二重起動を避けます。

別保存先は `-DataDir`、ポートは `-Port`。既存設定を変更しないサーバー専用機は `-SkipCodexConfig` を使えます。停止済みPIDのロックが残る場合のみ、所有者を確認して `-RecoverStaleLock` を使います。動作中のロックを削除しません。

Mac側では次を実行します。トークンは安全な経路で別途渡し、対話入力します。

```sh
zsh Core/Tools/configure-remote-macos.sh --url https://WINDOWS-NODE.TAILNET-NAME.ts.net/mcp
```

トークンはmacOS Keychainへ保存されます。チャット、Git、シェル履歴、コマンド引数、config.tomlへ平文で残さないでください。クライアントを再読込し、`system_capabilities` で接続先を確認します。

loopback bindと認証を維持し、Tailscale Serve等のHTTPS経路を使います。平文HTTPをLAN／インターネットへ直接公開しません。この手順はTailscale Funnelによる一般公開を行いません。

処理・パス・音声デバイスはサーバー側です。入力は認証付き `/uploads` へ転送し、返されたasset/pathを使います。成果物は `/files` から取得します。クライアントのローカルパスを渡したり、プラグイン処理をMac側へ逃がしたりしません。音声のネットワークストリーミングは含みません。

音声処理は一件ずつ。状態確認・完成済み成果物取得は処理中も可能です。切断で完了ジョブを失ったと推測せず状態を再取得します。再起動後の音声キューの自動再実行はありません。

HTTPの実装を変更するときだけ [APPLICATION](../Contracts/APPLICATION.md) と [SYSTEM](../Architecture/SYSTEM.md)。最新の検証範囲を確認するときだけ [VERIFICATION](../Development/VERIFICATION.md) を読みます。ローカル試験成功をWindows別PCでの運用確認済みとは扱いません。
