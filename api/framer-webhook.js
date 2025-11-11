// Serverless webhook for Framer -> Outseta
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const body = req.body || {};

  if (body.webhook_secret !== process.env.FRAMER_WEBHOOK_SECRET)
    return res.status(401).json({ error: "invalid webhook secret" });

  const OUTSETA_BASE = "https://api.outseta.com/api/v1";
  const AUTH = `Outseta ${process.env.OUTSETA_API_KEY}:${process.env.OUTSETA_API_SECRET}`;

  const email = body.email || body.Email;
  const firstName = body.firstName || body.FirstName || "";
  const lastName = body.lastName || body.LastName || "";
  const plan = body.plan || ""; 
  const term = body.term || "Monthly";
  const newsletter = body.newsletterOptIn === "true" || body.newsletter === "on";

  try {
    // Create/Update Person
    const personResp = await fetch(`${OUTSETA_BASE}/people`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: AUTH },
      body: JSON.stringify({ Email: email, FirstName: firstName, LastName: lastName })
    });
    const person = await personResp.json();

    // Newsletter
    if (newsletter) {
      await fetch(`${OUTSETA_BASE}/marketing/lists/${process.env.NEWSLETTER_LIST_UID}/subscribers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify({ Email: email, FirstName: firstName, LastName: lastName })
      });
    }

    // Pricing Plans
    if (plan === "base" || plan === "premium") {
      const accResp = await fetch(`${OUTSETA_BASE}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify({ Name: `${firstName} ${lastName}`, PrimaryContactUid: person.Uid })
      });
      const account = await accResp.json();

      const planUid = plan === "base" ? process.env.BASE_PLAN_UID : process.env.PREMIUM_PLAN_UID;

      const subResp = await fetch(`${OUTSETA_BASE}/billing/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify({ AccountUid: account.Uid, PlanUid: planUid, BillingFrequency: term })
      });
      const subscription = await subResp.json();
      return res.status(200).json({ ok: true, person, account, subscription });
    }

    // Other forms: contact, job, addon
    if (body.formType) {
      await fetch(`${OUTSETA_BASE}/support/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify({ Title: `New ${body.formType} from ${email}`, Body: body.message || "Form submission", PersonUid: person.Uid })
      });
    }

    return res.status(200).json({ ok: true, person });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: "server error" });
  }
}
