const form=document.querySelector('#rsvp-form'),guestList=document.querySelector('#guests');
const storageKey='doukysvatba-response-v1';
let responseId=null,busy=false;
try{responseId=localStorage.getItem(storageKey);}catch(_){}
const options={age:[['adult','Dospělý (18+)'],['child','Dítě / dospívající'],['baby','Miminko']],meal:[['standard','Běžná strava'],['vegetarian','Vegetariánská'],['vegan','Veganská'],['child','Dětská porce'],['none','Bez jídla / vlastní strava']],drinks:[['nonalcoholic','Nealko'],['beer','Pivo'],['wine','Víno'],['spirits','Tvrdý alkohol'],['coffee','Káva']]};
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function addGuest(data={}){
  if(guestList.children.length>=12)return;
  const id=crypto.randomUUID();const card=document.createElement('div');card.className='guest-card';
  const select=(key,values)=>values.map(([value,label])=>`<option value="${value}" ${data[key]===value?'selected':''}>${label}</option>`).join('');
  card.innerHTML=`<div class="guest-top"><h4>Host</h4><button class="remove-guest" type="button">Odebrat</button></div><div class="field"><label for="name-${id}">Jméno a příjmení *</label><input id="name-${id}" data-field="name" maxlength="100" required value="${escapeHTML(data.name)}" placeholder="Jméno hosta"></div><div class="two-columns"><div class="field"><label for="age-${id}">Věková skupina</label><select id="age-${id}" data-field="age">${select('age',options.age)}</select></div><div class="field"><label for="meal-${id}">Jídlo</label><select id="meal-${id}" data-field="meal">${select('meal',options.meal)}</select></div></div><div class="field"><label for="allergies-${id}">Alergie a omezení v jídle <span>(nepovinné)</span></label><input id="allergies-${id}" data-field="allergies" maxlength="500" value="${escapeHTML(data.allergies)}" placeholder="Např. lepek, ořechy, laktóza…"></div><div class="field"><label>Co si rád/a dáte k pití? <span>(nepovinné)</span></label><div class="drinks">${options.drinks.map(([value,label])=>`<label class="check"><input type="checkbox" data-drink="${value}" ${data.drinks?.includes(value)?'checked':''}><span>${label}</span></label>`).join('')}</div></div>`;
  card.querySelector('.remove-guest').addEventListener('click',()=>{card.remove();renumber();});
  const ageSelect=card.querySelector('[data-field="age"]');
  function updateDrinks(){const adult=ageSelect.value==='adult';card.querySelectorAll('[data-drink]').forEach(input=>{if(['beer','wine','spirits'].includes(input.dataset.drink)){input.disabled=!adult;if(!adult)input.checked=false;input.closest('label').hidden=!adult;}});}
  ageSelect.addEventListener('change',updateDrinks);updateDrinks();guestList.append(card);renumber();
}
function renumber(){Array.from(guestList.children).forEach((card,i)=>{card.querySelector('h4').textContent=`Host ${String(i+1).padStart(2,'0')}`;card.querySelector('.remove-guest').hidden=guestList.children.length===1;});document.querySelector('#add-guest').disabled=guestList.children.length>=12;}
function attendanceChanged(){const yes=form.elements.attendance.value==='yes';document.querySelector('#attending-fields').hidden=!yes;document.querySelectorAll('#attending-fields input,#attending-fields select,#attending-fields textarea,#attending-fields button').forEach(el=>el.disabled=!yes);if(yes){if(!guestList.children.length)addGuest({name:form.elements.contactName.value});guestList.querySelectorAll('[data-field="age"]').forEach(el=>el.dispatchEvent(new Event('change')));renumber();}}
form.querySelectorAll('[name="attendance"]').forEach(el=>el.addEventListener('change',attendanceChanged));
document.querySelector('#add-guest').addEventListener('click',()=>addGuest());
function payload(){const f=form.elements;return {attendance:f.attendance.value,contactName:f.contactName.value.trim(),email:f.email.value.trim(),phone:f.phone.value.trim(),guests:f.attendance.value==='yes'?Array.from(guestList.children).map(card=>({name:card.querySelector('[data-field="name"]').value.trim(),age:card.querySelector('[data-field="age"]').value,meal:card.querySelector('[data-field="meal"]').value,allergies:card.querySelector('[data-field="allergies"]').value.trim(),drinks:Array.from(card.querySelectorAll('[data-drink]:checked:not(:disabled)')).map(el=>el.dataset.drink)})):[],accommodation:f.attendance.value==='yes'?f.accommodation.value:'no',transport:f.attendance.value==='yes'?f.transport.value:'unsure',cars:f.attendance.value==='yes'?Number(f.cars.value||0):0,rideHome:f.attendance.value==='yes'?f.rideHome.value:'no',accessibility:f.attendance.value==='yes'?f.accessibility.value.trim():'',song:f.attendance.value==='yes'?f.song.value.trim():'',message:f.message.value.trim()};}
function showSuccess(data){form.hidden=true;const box=document.querySelector('#success');box.hidden=false;document.querySelector('#success-title').textContent=data.attendance==='yes'?'Těšíme se na vás!':'Děkujeme, že jste dali vědět.';document.querySelector('#success-text').textContent=data.attendance==='yes'?`Zapsali jsme vaši skupinku (${data.guests.length} ${data.guests.length===1?'osoba':data.guests.length<5?'osoby':'osob'}). S jídlem a ostatními potřebami budeme při plánování počítat.`:'Mrzí nás, že se neuvidíme, ale i tak vám posíláme velké díky. Jiří a Kateřina';}
form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;const status=document.querySelector('#form-status');status.textContent='';if(!form.reportValidity())return;const data=payload();if(!data.email&&!data.phone){status.textContent='Vyplňte prosím alespoň e-mail nebo telefon.';form.elements.email.focus();return;}if(!data.contactName||data.guests.some(g=>!g.name)){status.textContent='Doplňte prosím jména hostů.';return;}busy=true;const button=document.querySelector('#submit');button.disabled=true;status.textContent='Ukládáme vaši odpověď…';try{if(!responseId){responseId=crypto.randomUUID();try{localStorage.setItem(storageKey,responseId);}catch(_){}}await weddingApi.rpc('wedding_submit',{p_id:responseId,p_payload:data,p_company:form.elements.company.value});showSuccess(data);document.querySelector('#success').focus();status.textContent='';}catch(error){status.textContent=error.message;}finally{busy=false;button.disabled=false;}});
document.querySelector('#edit-response').addEventListener('click',()=>{document.querySelector('#success').hidden=true;form.hidden=false;form.elements.contactName.focus();});
let restoreBusy=false,formTouched=false;
form.addEventListener('input',()=>{formTouched=true;});
form.addEventListener('change',()=>{formTouched=true;});
const retryRestore=document.createElement('button');
retryRestore.type='button';retryRestore.className='button secondary';retryRestore.hidden=true;
retryRestore.textContent='Zkusit spojení znovu';
document.querySelector('#form-status').after(retryRestore);
retryRestore.addEventListener('click',restore);
async function restore(){
  if(!responseId||restoreBusy)return;
  restoreBusy=true;
  const button=document.querySelector('#submit'),status=document.querySelector('#form-status');
  let failed=false;button.disabled=true;retryRestore.disabled=true;
  status.textContent='Ověřujeme předchozí odpověď…';
  try{
    const result=await weddingApi.rpc('wedding_resume',{p_id:responseId});
    status.textContent='';retryRestore.hidden=true;
    if(!result.payload)return;
    if(formTouched){status.textContent='Spojení funguje. Rozepsané údaje jsme ponechali ve formuláři. Odesláním aktualizujete svou předchozí odpověď.';return;}
    const data=result.payload;
    for(const key of ['attendance','contactName','email','phone','accommodation','transport','cars','rideHome','accessibility','song','message'])
      if(form.elements[key])form.elements[key].value=data[key]??'';
    guestList.replaceChildren();data.guests.forEach(addGuest);attendanceChanged();showSuccess(data);
  }catch(error){
    failed=true;retryRestore.hidden=false;
    status.textContent='Předchozí odpověď se nepodařilo ověřit. Klikněte na „Zkusit spojení znovu“. Rozepsané údaje zůstávají ve formuláři.';
  }finally{button.disabled=failed;retryRestore.disabled=false;restoreBusy=false;}
}
attendanceChanged();restore();
function updateCountdown(){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const left=Math.max(0,Math.ceil((Date.UTC(2027,5,26)-Date.parse(today+'T00:00:00Z'))/86400000));document.querySelector('#days').textContent=left;document.querySelector('#days-label').textContent=left===0?'Náš svatební den':left===1?'den do našeho ano':left<5?'dny do našeho ano':'dní do našeho ano';}updateCountdown();
document.querySelector('#calendar').addEventListener('click',()=>{const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//DoukySvatba//CS','BEGIN:VEVENT','UID:jiri-katerina-20270626@doukysvatba.github.io','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''),'DTSTART;VALUE=DATE:20270626','DTEND;VALUE=DATE:20270627','SUMMARY:Svatba Jiřího a Kateřiny','DESCRIPTION:Svatba v přírodě u rybníka. Přesné místo a časy doplníme.','URL:https://doukysvatba.github.io/','END:VEVENT','END:VCALENDAR',''].join('\r\n');const url=URL.createObjectURL(new Blob([text],{type:'text/calendar;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='jiri-a-katerina-26-6-2027.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});


// A mail-status lookup never changes the successful database-save acknowledgement.
const originalShowSuccess=showSuccess;
showSuccess=function(data){
  originalShowSuccess(data);
  const note=document.querySelector('#success .small');
  if(!note)return;
  note.textContent=data.email?'Odpověď je uložená. Zjišťujeme stav potvrzovacího e-mailu…':'Odpověď je uložená. Bez e-mailové adresy vám potvrzení e-mailem nepřijde.';
  if(data.email)weddingApi.rpc('wedding_mail_status',{p_id:responseId}).then(result=>{
    const messages={sent:'Potvrzení jsme předali poštovnímu serveru. Zkontrolujte doručenou poštu, případně spam.',
      queued:'Potvrzení je připravené k odeslání na uvedený e-mail. Může dorazit s prodlevou.',
      sending:'Právě odesíláme potvrzení na uvedený e-mail.',
      retry:'Odpověď je uložená. Odeslání e-mailu se zpozdilo, automaticky jej zkusíme znovu.',
      failed:'Odpověď je uložená, ale potvrzovací e-mail se nepodařilo odeslat. Odpověď nemusíte vyplňovat znovu.'};
    note.textContent=messages[result.status]||'Odpověď je uložená. Pro tuto odpověď zatím není potvrzovací e-mail zařazený k odeslání.';
  }).catch(()=>{note.textContent='Odpověď je uložená. Stav potvrzovacího e-mailu se teď nepodařilo ověřit.';});
};
weddingApi.rpc('wedding_mail_status',{p_id:null}).then(result=>{
  if(result.enabled){const note=document.querySelector('#email-confirmation-note');
    if(note)note.textContent='E-mail je nepovinný. Pokud jej vyplníte, po uložení odpovědi vám pošleme potvrzení o přijetí dotazníku. Bez e-mailu potvrzení nepřijde. Stačí uvést telefon.';}
}).catch(()=>{});
