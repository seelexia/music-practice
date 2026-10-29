import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ScorePromptTools from './components/ScorePromptTools.tsx';

test('creation tools expose copy and portable JSON delivery without expanding a prompt by default',()=>{
 const markup=renderToStaticMarkup(createElement(ScorePromptTools,{}));
 assert.match(markup,/复制外部转谱提示词/);
 assert.match(markup,/score\.shengjian\.score\.json/);
 assert.match(markup,/HTML/);
 assert.match(markup,/下载格式规范/);
 assert.match(markup,/下载示例模板/);
 assert.doesNotMatch(markup,/<textarea/);
 assert.doesNotMatch(markup,/导入外部转谱 JSON/);
});

test('song tools offer an explicit import action when navigation is available',()=>{
 const markup=renderToStaticMarkup(createElement(ScorePromptTools,{onOpenImport:()=>{},disabled:true}));
 assert.match(markup,/<button[^>]*disabled[^>]*>[^]*?导入外部转谱 JSON/);
});
