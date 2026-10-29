import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const restoreSource=app.slice(app.indexOf('let restoreBusy='),app.indexOf('\nattendanceChanged();restore();'));
const button={disabled:false},status={textContent:'',after(){}},retry={hidden:true,addEventListener(){}};
const events={};let fail=true,restored=0;
const context={responseId:'test',form:{addEventListener:(event,fn)=>events[event]=fn,elements:{contactName:{value:'Rozepsané jméno'}}},
  document:{createElement:()=>retry,querySelector:id=>id==='#submit'?button:status},
  weddingApi:{rpc:async()=>{if(fail)throw Error('offline');return {payload:{contactName:'Uložené jméno',guests:[]}};}},
  guestList:{replaceChildren(){restored++;}},addGuest(){},attendanceChanged(){},showSuccess(){}};
vm.createContext(context);vm.runInContext(restoreSource,context);
await context.restore();assert.equal(button.disabled,true);assert.equal(retry.hidden,false);assert.equal(retry.disabled,false);
events.input();fail=false;await context.restore();
assert.equal(button.disabled,false);assert.equal(retry.hidden,true);
assert.equal(context.form.elements.contactName.value,'Rozepsané jméno');assert.equal(restored,0);
assert.match(status.textContent,/aktualizujete/);

const apiSource=await readFile(new URL('../api.js',import.meta.url),'utf8');
let timeoutCallback,cleared=0;
const transport={AbortController,TypeError,WEDDING_CONFIG:{url:'https://example.invalid',key:'test'},
  setTimeout:fn=>{timeoutCallback=fn;return 1;},clearTimeout:()=>cleared++,
  fetch:async()=>({ok:true,status:200,json:async()=>({saved:true})})};
transport.window=transport;vm.createContext(transport);vm.runInContext(apiSource,transport);
assert.equal((await transport.weddingApi.rpc('test')).saved,true);assert.equal(cleared,1);
transport.fetch=async()=>({ok:false,status:521,json:async()=>{throw SyntaxError('HTML');}});
await assert.rejects(transport.weddingApi.rpc('test'),/Server teď neodpovídá/);
transport.fetch=async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))));
const pending=transport.weddingApi.rpc('test');timeoutCallback();
await assert.rejects(pending,/příliš dlouho/);assert.equal(cleared,3);
console.log('PASS: failed resume can retry, typed data survives, submit unlocks, invalid server response and timeout recover');
