"""Install isolated wedding functions without modifying diploma data."""
import os
import psycopg
from psycopg import sql
from build import ROOT,load_env,config

def deploy():
    load_env();config()
    password=os.environ['ADMIN_PASSWORD']
    if not password or len(password.encode())>72: raise ValueError('Admin password must be 1 to 72 bytes')
    with psycopg.connect(os.environ['DATABASE_URL'],connect_timeout=15) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto'")
            row=cur.fetchone()
            if not row:
                cur.execute('CREATE SCHEMA IF NOT EXISTS extensions')
                cur.execute('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions')
                namespace='extensions'
            else: namespace=row[0]
            crypto=sql.Identifier(namespace)
            cur.execute((ROOT/'supabase.sql').read_text(encoding='utf-8').replace('__CRYPTO__',crypto.as_string(conn)))
            cur.execute(sql.SQL('INSERT INTO wedding_private.settings(singleton,admin_hash) VALUES(true,{c}.crypt(%s,{c}.gen_salt(\'bf\',10))) ON CONFLICT(singleton) DO UPDATE SET admin_hash=excluded.admin_hash').format(c=crypto),(password,))
            cur.execute("SELECT to_regclass('wedding_private.mail_config')")
            if cur.fetchone()[0]:
                cur.execute((ROOT/'email.sql').read_text(encoding='utf-8').replace('__CRYPTO__',crypto.as_string(conn)))
            cur.execute('SELECT public.wedding_status()')
            assert cur.fetchone()[0]['ready']
    print('Wedding database ready. Diploma tables unchanged.')

if __name__=='__main__': deploy()
