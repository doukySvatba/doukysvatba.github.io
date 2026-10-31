"""Build the public Pages artifact without database credentials or SQL."""
import base64
import json
import os
import shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parent

def load_env():
    path=ROOT/'.env'
    if path.exists():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                key,value=line.split('=',1)
                os.environ.setdefault(key.strip(),value.strip().strip('\"\''))

def config():
    url=os.environ.get('SUPABASE_URL','').rstrip('/')
    key=os.environ.get('SUPABASE_PUBLISHABLE_KEY') or os.environ.get('SUPABASE_ANON_KEY','')
    if not url.startswith('https://') or not key: raise ValueError('Public Supabase configuration is missing')
    if not key.startswith('sb_publishable_'):
        payload=key.split('.')[1]
        if json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4))).get('role')!='anon':
            raise ValueError('A secret key must never be published')
    return {'url':url,'key':key}

def build():
    load_env()
    public_config=config()
    destination=(ROOT/'_site').resolve()
    if destination.parent!=ROOT.resolve() or destination.name!='_site': raise ValueError('Invalid destination')
    if destination.exists(): shutil.rmtree(destination)
    destination.mkdir()
    for name in ('index.html','style.css','api.js','app.js','admin.html','admin.css','admin.js','report.js'):
        shutil.copyfile(ROOT/name,destination/name)
    if (ROOT/'og.png').exists(): shutil.copyfile(ROOT/'og.png',destination/'og.png')
    # Only these approved public sample photos are included in deployment.
    story_assets = ('spolecne-mladi','katerina-1','katerina-2','katerina-3','jiri-1','jiri-2','jiri-3','znovu-spolu')
    (destination/'assets'/'story').mkdir(parents=True)
    for name in story_assets:
        shutil.copyfile(ROOT/'assets'/'story'/f'{name}.jpg', destination/'assets'/'story'/f'{name}.jpg')
    (destination/'config.js').write_text('window.WEDDING_CONFIG = '+json.dumps(public_config)+';\n',encoding='utf-8')
    (destination/'.nojekyll').touch()
    print('Built public Pages files. No private configuration included.')

if __name__=='__main__': build()
