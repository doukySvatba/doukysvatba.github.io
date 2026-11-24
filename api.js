(function(global){
  async function rpc(name,args={}) {
    const c=global.WEDDING_CONFIG;
    if(!c?.url||!c?.key)throw new Error('Ukládání ještě není připojené. Zkuste to prosím později.');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch(c.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:c.key,'Content-Type':'application/json'},body:JSON.stringify(args),signal:controller.signal});
      let data;
      try {data=await response.json();}
      catch(_){throw new Error('Server teď neodpovídá správně. Zkuste spojení znovu; vyplněné údaje zůstávají ve formuláři.');}
      if(!response.ok||data?.error){const error=new Error(data?.error||'Odpověď se nepodařilo uložit. Zkontrolujte údaje a zkuste to znovu.');error.status=response.status;throw error;}
      return data;
    } catch(error) {
      if(controller.signal.aborted)throw new Error('Spojení trvá příliš dlouho. Zkuste to znovu; vyplněné údaje zůstávají ve formuláři.');
      if(error instanceof TypeError)throw new Error('Spojení se nepodařilo. Zkontrolujte internet a zkuste to znovu; vyplněné údaje zůstávají ve formuláři.');
      throw error;
    } finally {clearTimeout(timer);}
  }
  global.weddingApi={rpc};
})(window);
