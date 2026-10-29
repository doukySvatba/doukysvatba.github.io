"""Deploy the private SMTP worker. Secrets are never printed or included in Pages."""
import json, os, secrets, sys, urllib.request, urllib.error
import psycopg
from psycopg import sql
from build import ROOT, load_env, config

def request(url, data=None, headers=None, method=None):
    req=urllib.request.Request(url,data=data,headers=headers or {},method=method)
    try:
        with urllib.request.urlopen(req,timeout=120) as r:
            raw=r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError('HTTP '+str(e.code)) from None

def main():
    load_env(); public=config()
    ref=public['url'].split('//')[1].split('.')[0]
    base='https://api.supabase.com/v1/projects/'+ref
    auth={'Authorization':'Bearer '+os.environ['SUPABASE_ACCESS_TOKEN']}
    mode=sys.argv[1] if len(sys.argv)>1 else 'deploy'
    key=os.environ.get('WEDDING_WORKER_KEY','')
    if not key and mode in ('deploy','prepare'):
        key=secrets.token_hex(32)
        with (ROOT/'.env').open('a',encoding='utf-8') as f: f.write('\nWEDDING_WORKER_KEY='+key+'\n')
    url=public['url']+'/functions/v1/wedding-mailer'
    if mode in ('deploy','enable'):
        with psycopg.connect(os.environ['DATABASE_URL'],connect_timeout=20) as conn:
            with conn.cursor() as cur:
                if mode=='deploy':
                    cur.execute('CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions')
                    cur.execute('CREATE EXTENSION IF NOT EXISTS pg_cron')
                    cur.execute("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto'")
                    namespace=sql.Identifier(cur.fetchone()[0]).as_string(conn)
                    cur.execute((ROOT/'email.sql').read_text(encoding='utf-8').replace('__CRYPTO__',namespace))
                    cur.execute('INSERT INTO wedding_private.mail_config(singleton,worker_key) VALUES(true,%s) ON CONFLICT(singleton) DO NOTHING',(key or secrets.token_hex(32),))
                cur.execute('SELECT worker_key FROM wedding_private.mail_config WHERE singleton')
                key=cur.fetchone()[0]
                url=public['url']+'/functions/v1/wedding-mailer'
                if mode=='enable':
                    cur.execute('UPDATE wedding_private.mail_config SET enabled=true,worker_url=%s WHERE singleton',(url,))
                    cur.execute("SELECT cron.schedule('wedding-mail-every-minute','* * * * *','select wedding_private.dispatch_mail();')")
                    print('Mail queue enabled; one-minute schedule installed. Existing responses not backfilled.')
                    return

    if mode in ('deploy','prepare'):
        if not key: raise ValueError('Missing WEDDING_WORKER_KEY')
        values={'WEDDING_WORKER_KEY':key,'WEDDING_PUBLIC_KEY':public['key'],
                'WEDDING_SMTP_USER':os.environ['SMTP_USER'],'WEDDING_SMTP_PASSWORD':os.environ['SMTP_PASSWORD']}
        request(base+'/secrets',json.dumps([{'name':k,'value':v} for k,v in values.items()]).encode(),{**auth,'Content-Type':'application/json'},'POST')
        boundary='Wedding'+secrets.token_hex(16)
        metadata=json.dumps({'entrypoint_path':'index.ts','name':'wedding-mailer','verify_jwt':False})
        body=(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{metadata}\r\n'
              f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="index.ts"\r\nContent-Type: application/typescript\r\n\r\n').encode()
        body+=(ROOT/'supabase/functions/wedding-mailer/index.ts').read_bytes()+f'\r\n--{boundary}--\r\n'.encode()
        request(base+'/functions/deploy?slug=wedding-mailer',body,{**auth,'Content-Type':'multipart/form-data; boundary='+boundary},'POST')
        print('Private worker deployed. Mail remains in its previous enabled/disabled state.')
    elif mode in ('probe','test','run'):
        result=request(url,json.dumps({'mode':mode}).encode(),{'Content-Type':'application/json','x-wedding-worker-key':key},'POST')
        print(json.dumps(result))
    else: raise ValueError('Unknown mode')

if __name__=='__main__':
    try: main()
    except Exception as e:
        print('Mail operation failed:',type(e).__name__,str(e) if isinstance(e,RuntimeError) else '(details suppressed to protect credentials)')
        sys.exit(1)
