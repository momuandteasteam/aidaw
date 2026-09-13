import test from 'node:test';import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
test('text toolbar and file menu route every entry through the app and support keyboard navigation',async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const {stdout}=await promisify(execFile)(require('electron'),[fileURLToPath(new URL('./top-bar-browser.cjs',import.meta.url))],{env,timeout:20000});
 const data=JSON.parse(stdout.split('\n').find(l=>l.startsWith('TOP_BAR_RESULT ')).slice(15));
 assert.deepEqual(data.toolbarNames,['ファイル','設定']);
 assert.deepEqual(data.labels,['新規プロジェクト…','プロジェクトを開く…','プロジェクト一覧…','ステム分離・ダウンロード…','プロジェクトをインポート…','プロジェクトをエクスポート…','音声を書き出す…']);
 for(const key of ['parameterNamesFit','squareCover','unavailable','escaped','assignment','settings','listOpened','refreshed','selected','outputRestored','createDialog','audioExport','withinWindow'])assert.equal(data[key],true,key);
 assert.equal(data.arrowTarget,'openWorkspace');assert.equal(data.error,'');
 for(const name of ['project_save','saveOutput','chooseProjectFolder','chooseFile'])assert.ok(data.calls.some(c=>c.name===name),name);
 assert.ok(data.buttons.every(b=>b.height>=32&&b.font==='11px'));
});
