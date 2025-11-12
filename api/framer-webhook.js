export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const body = req.body || {};
  if (body.webhook_secret !== process.env.FRAMER_WEBHOOK_SECRET)
    return res.status(401).json({ error: "invalid webhook secret" });

  const OUTSETA_BASE = "https://venax.outseta.com/api/v1";
  const AUTH = `Outseta ${process.env.OUTSETA_API_KEY}:${process.env.OUTSETA_API_SECRET}`;

  const email = body.email || body.Email;
  const firstName = body.firstName || body.FirstName || "";
  const lastName = body.lastName || body.LastName || "";
  const plan = body.plan || "";
  const term = body.term || "Monthly";
  const newsletter = body.newsletterOptIn === "true" || body.newsletter === "on";

  async function safeFetch(url, options) {
    const resp = await fetch(url, options);
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!resp.ok) {
      console.error("Outseta error", resp.status, json);
      throw new Error(`Outseta API error: ${resp.status}`);
    }
    return json;
  }

  try {
    // Create/Update Person
    const person = await safeFetch(`${OUTSETA_BASE}/people`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: AUTH },
      body: JSON.stringify({ Email: email, FirstName: firstName, LastName: lastName })
    });

    // Newsletter
    if (newsletter) {
      await safeFetch(`${OUTSETA_BASE}/marketing/lists/${process.env.NEWSLETTER_LIST_UID}/subscribers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify({ Email: email, FirstName: firstName, LastName: lastName })
      });
    }

    // Pricing Plans
    if (plan === "base" || plan === "premium") {
      const account = await safeFetch(`${OUTSETA_BASE}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify({ Name: `${firstName} ${lastName}` })
      });

      const planUid = plan === "base" ? process.env.BASE_PLAN_UID : process.env.PREMIUM_PLAN_UID;

      const subscription = await safeFetch(`${OUTSETA_BASE}/billing/subscriptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: AUTH },
        body: JSON.stringify({ AccountUid: account.Uid, PlanUid: planUid, BillingFrequency: term })
      });

      return res.status(200).json({ ok: true, person, account, subscription });
    }

    return res.status(200).json({ ok: true, person });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
}
