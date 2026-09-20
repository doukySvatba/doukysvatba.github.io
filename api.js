(function(global){
  async function rpc(name,args={}) {
    const c=global.WEDDING_CONFIG;
    if(!c?.url||!c?.key)throw new Error('Ukládání ještě není připojené. Zkuste to prosím později.');
    let response;
    try {response=await fetch(c.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:c.key,'Content-Type':'application/json'},body:JSON.stringify(args)});}
    catch(_){throw new Error('Spojení se nepodařilo. Odpověď zatím není potvrzená — zkuste ji prosím odeslat znovu.');}
    const data=await response.json();
    if(!response.ok||data?.error){const error=new Error(data?.error||'Odpověď se nepodařilo uložit. Zkontrolujte údaje a zkuste to znovu.');error.status=response.status;throw error;}
    return data;
  }
  global.weddingApi={rpc};
})(window);
