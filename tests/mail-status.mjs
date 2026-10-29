import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const mail=source.slice(source.indexOf('// A mail-status lookup'));
assert.ok(mail.startsWith('// A mail-status lookup'));
for(const state of ['sent','queued','failed','error','no-email']){
  const note={textContent:''};let saves=0;
  const context={showSuccess:()=>{saves++;},document:{querySelector:()=>note},responseId:'test',
    weddingApi:{rpc:async(_name,args)=>{
      if(args.p_id===null)return {enabled:false};
      if(state==='error')throw Error('network');
      return {status:state};
    }}};
  vm.createContext(context);vm.runInContext(mail,context);
  context.showSuccess({email:state==='no-email'?'':'test@example.com'});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(saves,1);assert.ok(note.textContent);
  if(['error','failed','no-email'].includes(state))assert.match(note.textContent,/uložená/);
}
console.log('PASS: mail failures preserve saved RSVP acknowledgement');
