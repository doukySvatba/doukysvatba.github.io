# Jiří & Kateřina — svatba 26. června 2027

První návrh přírodní svatební pozvánky. Zelená, krémová, dub, žalud a ilustrovaný rybník. Ilustrace není skutečným místem svatby. Neznámé místo, časy, mapa, kontakty a termín odpovědi jsou označené k doplnění.

- Pozvánka: https://doukysvatba.github.io/
- Administrace: https://doukysvatba.github.io/admin.html
- GitHub Pages publikuje pouze soubory z `_site`.
- Odpovědi jsou v Supabase v odděleném schématu `wedding_private`, tabulce `responses`. Data diplomky se nemění.

## Funkce

- Účast / neúčast, kontaktní osoba, e-mail nebo telefon.
- Až 12 jmenovitě vyplněných hostů: věková skupina, strava, dobrovolné alergie, pití.
- Zájem o nocleh a odvoz, počet aut, osobní potřeby, písnička a vzkaz.
- Na stejném prohlížeči lze odpověď znovu načíst a upravit. V prohlížeči je uložen pouze náhodný klíč odpovědi, nikoliv samotné osobní údaje. Klíč nikomu nesdílejte.
- Heslem chráněná administrace: součty hostů, jídla a nápojových preferencí, zájem o nocleh/odvoz, alergie, vyhledávání, CSV a smazání jednotlivé odpovědi.
- CSV má jeden řádek na hosta (u neúčasti jeden za skupinu). Údaje za skupinu, zejména počet aut, se v řádcích opakují: nesčítejte je bez seskupení podle `response_id`.
- Kalendářní soubor ICS s datem svatby. Automatické e-maily se neposílají.

## Nasazení a změny

Veřejná pozvánka je první návrh; formulář již ukládá skutečné odpovědi. Pro zkoušení používejte smyšlené údaje a smažte je z administrace před ostrým sběrem. Před rozesláním doplňte chybějící informace a odstraňte označení prvního návrhu v `index.html`.

Lokální `.env` obsahuje údaje podle `.env.example` a je ignorovaný Gitem. Připojení k databázi a heslo administrace nesmí být ve veřejném repozitáři ani v Pages konfiguraci.

```text
pip install "psycopg[binary]"
python deploy_database.py
python verify_database.py
python build.py
```

GitHub Actions používá pouze veřejné proměnné `SUPABASE_URL` a `SUPABASE_PUBLISHABLE_KEY`. Push do `main` automaticky publikuje web. Změny SQL se nasazují lokálním skriptem zvlášť. `verify_database.py` své zápisy vždy vrací zpět.

Správcovská relace vyprší po čtyřech hodinách. Veřejnost nemá přímý přístup k tabulkám, SQL funkce kontrolují formulář a přístupové tokeny. Každá rodina/skupina má náhodný identifikátor pro úpravy odpovědi. Změna zařízení nebo vymazání dat prohlížeče tuto vazbu ztratí — změnu pak řeší organizátor.

Volby noclehu a odvozu zjišťují zájem, nejsou rezervací. Ilustrace a návrh programu jsou pracovní, časy ani konkrétní místo nebyly vymyšleny jako potvrzený fakt.

## Photo and story slots

The #nas-pribeh section shows a shared beginning, two separate paths (Kateřina first, Jiří second, three photos each), and a shared reunion. Eight illustrative sample JPEGs live in assets/story/: spolecne-mladi, katerina-1 through katerina-3, jiri-1 through jiri-3, znovu-spolu. Each figure has data-photo-slot matching its filename. Replace with approved personal photos and update alt text, captions, and the sample notice. Photos retain full proportions without forced cropping. build.py explicitly allowlists these eight public assets; never copy private source folders wholesale. The later spolecna-siroka photo placeholder remains available.