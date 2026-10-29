import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
export async function run(){
  const context={};vm.createContext(context);vm.runInContext(await readFile(new URL('../report.js',import.meta.url),'utf8'),context);
  const guest={name:'Eva',age:'adult',meal:'vegetarian',allergies:'Ořechy',drinks:['wine','nonalcoholic']};
  const payload={attendance:'yes',contactName:'Eva',email:'test@example.invalid',phone:'',guests:[guest,{...guest,name:'Dítě',age:'child',meal:'child',allergies:'',drinks:['nonalcoholic']}],accommodation:'yes',transport:'car',cars:1,rideHome:'yes',song:'Song',accessibility:'Kočárek',message:'=malicious'};
  const rows=[{id:'a',payload,created_at:'2026-09-20',updated_at:'2026-09-20'},{id:'b',payload:{...payload,attendance:'no',guests:[],cars:0,song:''},created_at:'2026-09-20',updated_at:'2026-09-20'}];
  const r=context.weddingReport,summary=r.analyze(rows);
  assert.equal(summary.guests.length,2);assert.equal(summary.ages.adult,1);assert.equal(summary.ages.child,1);assert.equal(summary.no,1);
  assert.equal(summary.cars,1);assert.equal(summary.sleepGuests,2);assert.equal(summary.sleepGroups,1);assert.equal(summary.drinks.wine,1);assert.equal(summary.drinks.nonalcoholic,2);
  assert.equal(summary.songs.length,1);assert.equal(summary.meals.vegetarian,1);
  const output=r.exportRows(rows);assert.equal(output.length,3);assert.equal(output[2].ucast,'Ne');assert.equal(output[0].alergie,'Ořechy');
  const csv=r.csv(output);assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes("'=malicious"));assert.ok(csv.includes('pocet_aut_za_skupinu'));
  const calls=[];const transport={AbortController,setTimeout,clearTimeout,WEDDING_CONFIG:{url:'https://example.supabase.co',key:'sb_publishable_test'},fetch:async(url,options)=>{calls.push({url,options});return{ok:true,status:200,json:async()=>({saved:true})};}};transport.window=transport;vm.createContext(transport);vm.runInContext(await readFile(new URL('../api.js',import.meta.url),'utf8'),transport);
  assert.equal((await transport.weddingApi.rpc('wedding_submit',{p_id:'id',p_payload:payload})).saved,true);
  assert.equal(calls[0].options.headers.apikey,'sb_publishable_test');assert.equal(JSON.parse(calls[0].options.body).p_payload.guests.length,2);
  transport.fetch=async()=>({ok:false,status:403,json:async()=>({})});await assert.rejects(transport.weddingApi.rpc('wedding_admin_list'),e=>e.status===403);
  for(const name of ['app.js','admin.js','api.js','report.js'])new vm.Script(await readFile(new URL('../'+name,import.meta.url),'utf8'));
  return 'PASS: guest and meal counts, logistics, preferences, declined invitation export, safe CSV, API transport and JavaScript syntax.';
}
