import test from 'node:test';import assert from'node:assert/strict';import{fittedImageRect}from'../public/app.js';
test('portrait photo keeps its full aspect ratio and excludes horizontal letterboxing from drag coordinates',()=>{assert.deepEqual(fittedImageRect({left:0,top:0,width:360,height:300},100,200),{left:105,top:0,width:150,height:300});});
test('landscape photo excludes vertical letterboxing from drag coordinates',()=>{assert.deepEqual(fittedImageRect({left:10,top:20,width:300,height:400},200,100),{left:10,top:145,width:300,height:150});});
test('square image scales up without changing normalized hour coordinates',()=>{assert.deepEqual(fittedImageRect({left:0,top:0,width:300,height:300},64,64),{left:0,top:0,width:300,height:300});});
