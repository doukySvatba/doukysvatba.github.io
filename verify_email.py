"""Transactional mail queue checks; no messages sent and no test records retained."""
import os, json, uuid
import psycopg
from psycopg import sql
from build import ROOT,load_env
from verify_database import sample

def verify():
    load_env()
    with psycopg.connect(os.environ['DATABASE_URL'],connect_timeout=20) as conn:
        try:
            with conn.cursor() as c:
                c.execute("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto'")
                namespace=sql.Identifier(c.fetchone()[0]).as_string(conn)
                c.execute((ROOT/'email.sql').read_text(encoding='utf-8').replace('__CRYPTO__',namespace))
                key=uuid.uuid4().hex
                c.execute('INSERT INTO wedding_private.mail_config(singleton,enabled,worker_key) VALUES(true,true,%s) ON CONFLICT(singleton) DO UPDATE SET enabled=true,worker_key=excluded.worker_key',(key,))
                # Isolate transaction from real queued messages; rollback restores them.
                c.execute('DELETE FROM wedding_private.mail_queue')
                c.execute('DELETE FROM wedding_private.mail_attempts')
                identity=str(uuid.uuid4());data=sample()
                def submit():
                    c.execute('SELECT public.wedding_submit(%s,%s::jsonb)',(identity,json.dumps(data)))
                    assert c.fetchone()[0]['saved']
                c.execute('SET LOCAL ROLE anon');submit();submit()
                c.execute('SELECT public.wedding_mail_status(%s)',(identity,));assert c.fetchone()[0]['status']=='queued'
                c.execute('SAVEPOINT wrong_key')
                try:
                    c.execute("SELECT public.wedding_mail_claim('wrong')");raise AssertionError('Worker auth bypass')
                except psycopg.errors.InsufficientPrivilege:c.execute('ROLLBACK TO SAVEPOINT wrong_key')
                c.execute('SELECT public.wedding_mail_claim(%s)',(key,));job=c.fetchone()[0];assert job['recipient']==data['email']
                c.execute('SELECT public.wedding_mail_claim(%s)',(key,));assert c.fetchone()[0] is None
                c.execute('SELECT public.wedding_mail_finish(%s,%s,%s,true)',(key,job['id'],str(uuid.uuid4())));assert not c.fetchone()[0]['updated']
                c.execute('SELECT public.wedding_mail_finish(%s,%s,%s,false,true)',(key,job['id'],job['lease']));assert c.fetchone()[0]['updated']
                c.execute('SELECT public.wedding_mail_status(%s)',(identity,));assert c.fetchone()[0]['status']=='retry'
                data['message']='changed';submit()
                c.execute('RESET ROLE')
                c.execute("SELECT count(*) FROM wedding_private.mail_queue WHERE response_id=%s AND status='cancelled'",(identity,));assert c.fetchone()[0]==1
                c.execute('SELECT count(*) FROM wedding_private.mail_attempts');assert c.fetchone()[0]==1
                c.execute('UPDATE wedding_private.mail_config SET daily_cap=1')
                c.execute('SELECT public.wedding_mail_claim(%s)',(key,));assert c.fetchone()[0] is None
                c.execute("UPDATE wedding_private.mail_queue SET last_attempt=now()-interval '11 minutes'")
                c.execute('UPDATE wedding_private.mail_config SET daily_cap=100')
                c.execute('SELECT public.wedding_mail_claim(%s)',(key,));job=c.fetchone()[0];assert job
                c.execute('SELECT public.wedding_mail_finish(%s,%s,%s,true)',(key,job['id'],job['lease']));assert c.fetchone()[0]['updated']
                c.execute('SELECT public.wedding_mail_status(%s)',(identity,));assert c.fetchone()[0]['status']=='sent'
                data['email']='';data['phone']='123456789';submit()
                c.execute('SELECT public.wedding_mail_status(%s)',(identity,));assert c.fetchone()[0]['status']=='no_email'
        finally:conn.rollback()
    print('PASS: queue deduplication, worker authorization, lease exclusivity, retry, stale cancellation, attempt accounting, optional email. All rolled back.')

if __name__=='__main__': verify()
