import nodemailer from "npm:nodemailer@10.3.1";

const env = (key: string) => Deno.env.get(key) || "";
const workerKey = env("WEDDING_WORKER_KEY");
const sender = env("WEDDING_SMTP_USER");
async function rpc(name: string, args: Record<string, unknown>) {
  const response = await fetch(env("SUPABASE_URL") + "/rest/v1/rpc/" + name, {
    method: "POST", headers: {apikey: env("WEDDING_PUBLIC_KEY"), "Content-Type": "application/json"},
    body: JSON.stringify({...args, p_key: workerKey}), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("database_error");
  return response.json();
}
function transport() {
  return nodemailer.createTransport({host: "smtp.seznam.cz", port: 465, secure: true,
    auth: {user: sender, pass: env("WEDDING_SMTP_PASSWORD")},
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true});
}
function message(job: any) {
  if (!/^[^\s<>\r\n@]+@[^\s<>\r\n@]+\.[^\s<>\r\n@]+$/.test(job.recipient)) throw new Error("invalid_recipient");
  const c = job.content;
  const text = ["Ahoj " + String(c.contactName || "") + ",", "",
    c.updated ? "Děkujeme, aktualizaci tvé odpovědi jsme přijali a uložili." : "Děkujeme, tvou odpověď na svatební dotazník jsme přijali a uložili.", "",
    c.attendance === "yes" ? "Počítáme s vámi na naší svatbě 26. 6. 2027!" : "Děkujeme, že jste dali vědět, že se nezúčastníte.",
    c.attendance === "yes" ? "Hosté: " + (c.names || []).join(", ") : "", "",
    "Aktuální informace najdete na https://doukysvatba.github.io/",
    "Pokud potřebujete něco opravit, odpovězte na tento e-mail.", "",
    "Jiří a Kateřina", "",
    "Toto potvrzení vzniklo po vyplnění našeho dotazníku. Pokud jste jej nevyplňovali, dejte nám prosím vědět odpovědí na tento e-mail."].join("\n");
  return {from: {name: "Jiří a Kateřina", address: sender}, to: {address: job.recipient, name: ""},
    replyTo: sender, subject: c.updated ? "Svatba – změnu odpovědi máme uloženou" : "Svatba – potvrzení přijetí odpovědi",
    messageId: `<wedding-${job.id}@seznam.cz>`, text};
}
Deno.serve(async (request) => {
  if (request.method !== "POST" || !workerKey || request.headers.get("x-wedding-worker-key") !== workerKey)
    return Response.json({error: "unauthorized"}, {status: 401});
  try {
    const {mode = "run"} = await request.json();
    if (mode === "probe") {
      const smtp = transport(); try {await smtp.verify();} finally {smtp.close();}
      return Response.json({smtp: "ok"});
    }
    if (mode === "test") {
      const smtp = transport();
      try {await smtp.sendMail(message({id: crypto.randomUUID(), recipient: sender,
        content: {contactName: "Jiří a Kateřino (test odesílání)", attendance: "yes", names: ["Testovací potvrzení"]}}));}
      finally {smtp.close();}
      return Response.json({accepted: true});
    }
    if (mode !== "run") return Response.json({error: "invalid_mode"}, {status: 400});
    let sent = 0;
    // One job per invocation bounds runtime and avoids overlapping SMTP bursts.
    const job = await rpc("wedding_mail_claim", {});
    if (job) {
      const smtp = transport(); let ok = false, retry = true, code = "smtp_error";
      try {await smtp.sendMail(message(job)); ok = true; sent++;}
      catch (e: any) {
        code = e.code === "EAUTH" ? "smtp_auth" : e.message === "invalid_recipient" ? "invalid_recipient" : "smtp_error";
        retry = code !== "invalid_recipient" && !(e.responseCode >= 500 && e.responseCode < 600);
      } finally {smtp.close();}
      await rpc("wedding_mail_finish", {p_id: job.id, p_lease: job.lease, p_sent: ok, p_retry: retry, p_error: code});
    }
    return Response.json({sent});
  } catch (_) {return Response.json({error: "mail_worker_error"}, {status: 502});}
});
