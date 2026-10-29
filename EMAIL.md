# Potvrzovací e-maily

Odesílatel: doubkovisvatba@seznam.cz. SMTP přes TLS na portu 465.
Edge Function `wedding-mailer` používá připnutý Nodemailer 10.3.1.
Heslo je pouze v ignorovaném místním `.env` a v Supabase Edge Function Secrets.

Registrace a zařazení potvrzení do fronty proběhnou v jedné databázové transakci.
Cron jednou za minutu spustí pracovní funkci, pouze pokud existuje čekající zpráva.
Každé spuštění zpracuje nejvýše jednu zprávu. SMTP neběží v požadavku registrace.
Změna odpovědi vytvoří nové potvrzení; totožné opakované uložení nikoli.
Staré odpovědi z doby před zapnutím se automaticky nerozesílají.

Vlastní ochranné limity jsou 30 pokusů za hodinu a 100 za 24 hodin (nejde o limity garantované Seznamem).
Další odpověď na stejnou adresu má odstup alespoň 10 minut. Dočasná chyba se opakuje nejvýše pětkrát.
Administrace ukazuje stav a dovoluje opakovat neúspěšné odeslání.
Stav „předáno poštovnímu serveru“ neznamená zaručené doručení do schránky.
Při pádu po přijetí SMTP a před potvrzením databázi může výjimečně dojít k duplicitě.
Obsah e-mailu nezahrnuje alergie, telefon ani další osobní potřeby.

Supabase Free může být při neaktivitě pozastavený. Tato funkce není služba pro udržování projektu aktivního.
Pozastavená databáze nemůže přijímat odpovědi ani odesílat frontu. Placený tarif se nezapíná.

## Nasazení

Závislost Pythonu: psycopg. `.env`: existující databázová konfigurace,
`SMTP_USER`, `SMTP_PASSWORD`, `SUPABASE_ACCESS_TOKEN` (Edge Functions a Edge Function Secrets Read-write).

1. `python verify_email.py` – transakční test, žádné skutečné odeslání.
2. `python deploy_email.py deploy` – SQL, privátní secrets a funkce.
3. `python deploy_email.py probe` – autentizace SMTP přímo ze Supabase.
4. `python deploy_email.py test` – test pouze do schránky odesílatele.
5. `python deploy_email.py enable` – aktivace fronty a cron úlohy.

Ověřte také `python verify_database.py` a `python build.py`.
Po změně hesla znovu spusťte deploy a probe. Přístupový token je potřeba pro nasazování,
jeho expirace sama o sobě nezastaví již nasazenou funkci.
Worker přijímá jen POST s tajným klíčem; veřejný klient nemůže vyvolat libovolný e-mail.
