"""Meaningful integration checks. All test records and sessions roll back."""
import json
import os
import uuid
from copy import deepcopy
import psycopg
from build import load_env

def sample():
    return {'attendance':'yes','contactName':'Testovací host','email':'test@example.invalid','phone':'',
        'guests':[{'name':'Testovací dospělý','age':'adult','meal':'vegetarian','allergies':'Ořechy','drinks':['wine','nonalcoholic']},
                  {'name':'Testovací dítě','age':'child','meal':'child','allergies':'','drinks':['nonalcoholic']}],
        'accommodation':'yes','transport':'car','cars':1,'rideHome':'yes','accessibility':'Kočárek','song':'Test song','message':'Test'}

def verify():
    load_env()
    with psycopg.connect(os.environ['DATABASE_URL'],connect_timeout=15) as conn:
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT count(*) FROM public.answers');before=cur.fetchone()[0]
                cur.execute('SET LOCAL ROLE anon')
                identity=str(uuid.uuid4());data=sample()
                def submit(payload,company=''):
                    cur.execute('SELECT public.wedding_submit(%s,%s::jsonb,%s)',(identity,json.dumps(payload),company))
                    return cur.fetchone()[0]
                assert submit(data)['saved']
                cur.execute('SELECT public.wedding_resume(%s)',(identity,))
                assert cur.fetchone()[0]['payload']==data
                data['message']='Updated';assert submit(data)['saved']
                cur.execute('SELECT public.wedding_resume(%s)',(identity,))
                assert cur.fetchone()[0]['payload']['message']=='Updated'
                invalid=[]
                for key,value in [('guests',[]),('email','bad'),('cars',-1),('contactName',''),('guests',[{'name':'invalid'}])]:
                    bad=deepcopy(data);bad[key]=value;invalid.append(bad)
                bad=deepcopy(data);bad['guests'][1]['drinks']=['wine'];invalid.append(bad)
                bad=deepcopy(data);bad['guests'][0]['allergies']='x'*501;invalid.append(bad)
                for bad in invalid:
                    cur.execute('SAVEPOINT validation')
                    try:
                        submit(bad);raise AssertionError('Invalid payload accepted')
                    except psycopg.errors.InvalidParameterValue:
                        cur.execute('ROLLBACK TO SAVEPOINT validation')
                cur.execute('SAVEPOINT permissions')
                try:
                    cur.execute('SELECT * FROM wedding_private.responses');raise AssertionError('Anonymous data access allowed')
                except psycopg.errors.InsufficientPrivilege:
                    cur.execute('ROLLBACK TO SAVEPOINT permissions')
                cur.execute("SELECT public.wedding_admin_login('bad-test-password')")
                assert 'error' in cur.fetchone()[0]
                cur.execute('SELECT public.wedding_admin_login(%s)',(os.environ['ADMIN_PASSWORD'],))
                token=cur.fetchone()[0]['token']
                cur.execute('SELECT public.wedding_admin_list(%s)',(token,))
                report=cur.fetchone()[0];assert any(r['id']==identity for r in report['responses'])
                no=deepcopy(data);no['attendance']='no';no['guests']=[];assert submit(no)['saved']
                cur.execute('SELECT public.wedding_admin_delete(%s,%s)',(token,identity));assert cur.fetchone()[0]['deleted']
                cur.execute('SELECT public.wedding_resume(%s)',(identity,));assert cur.fetchone()[0]['payload'] is None
                cur.execute('SELECT public.wedding_admin_logout(%s)',(token,));assert cur.fetchone()[0]['success']
                cur.execute('SAVEPOINT expired')
                try:
                    cur.execute('SELECT public.wedding_admin_list(%s)',(token,));raise AssertionError('Logged-out token accepted')
                except psycopg.errors.InsufficientPrivilege:
                    cur.execute('ROLLBACK TO SAVEPOINT expired')
                cur.execute('RESET ROLE');cur.execute('SELECT count(*) FROM public.answers');assert cur.fetchone()[0]==before
        finally:conn.rollback()
    print('PASS: RSVP create, update, resume, decline, input validation, private data, admin authentication, list, delete, logout. Test data rolled back; diploma untouched.')

if __name__=='__main__':verify()
