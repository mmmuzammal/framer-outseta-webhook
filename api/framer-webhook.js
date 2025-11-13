export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const body = req.body || {};
  if (body.webhook_secret !== process.env.FRAMER_WEBHOOK_SECRET)
    return res.status(401).json({ error: "invalid webhook secret" });

  // Outseta Base URL and Auth
  const OUTSETA_BASE = "https://venax.outseta.com/api/v1";
  // ✅ Use Outseta token-style auth (not Basic)
  const AUTH = `Outseta ${process.env.OUTSETA_API_KEY}:${process.env.OUTSETA_API_SECRET}`;

  // Extract form data from Framer
  const email = body.email || body.Email;
  const firstName = body.firstName || body.FirstName || "";
  const lastName = body.lastName || body.LastName || "";
  const plan = body.plan || "";
  const term = body.term || "Monthly";
  const newsletter =
    body.newsletterOptIn === "true" || body.newsletter === "on";

  console.log("📩 Incoming Framer data:", {
    email,
    firstName,
    lastName,
    plan,
    term,
    newsletter,
  });

  // Safe fetch wrapper
  async function safeFetch(url, options) {
    const resp = await fetch(url, options);
    const text = await resp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    console.log("📡 Outseta API Response:", resp.status, json);

    if (!resp.ok) {
      console.error("❌ Outseta error", resp.status, json);
      throw new Error(`Outseta API error: ${resp.status}`);
    }

    return json;
  }

  try {
    // 1️⃣ Create or update Person
    const person = await safeFetch(`${OUTSETA_BASE}/crm/people`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: AUTH,
      },
      body: JSON.stringify({
        Email: email,
        FirstName: firstName,
        LastName: lastName,
      }),
    });

    // 2️⃣ Subscribe to newsletter (if opted in)
    if (newsletter) {
      await safeFetch(
        `${OUTSETA_BASE}/email/lists/${process.env.NEWSLETTER_LIST_UID}/subscriptions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: AUTH,
          },
          body: JSON.stringify({
            Email: email,
            FirstName: firstName,
            LastName: lastName,
          }),
        }
      );
    }

    // 3️⃣ Create subscription if plan selected
    if (plan === "base" || plan === "premium") {
      const account = await safeFetch(`${OUTSETA_BASE}/crm/accounts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: AUTH,
        },
        body: JSON.stringify({
          Name: `${firstName} ${lastName}`,
        }),
      });

      const planUid =
        plan === "base"
          ? process.env.BASE_PLAN_UID
          : process.env.PREMIUM_PLAN_UID;

      const subscription = await safeFetch(
        `${OUTSETA_BASE}/billing/subscriptions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: AUTH,
          },
          body: JSON.stringify({
            AccountUid: account.Uid,
            PlanUid: planUid,
            BillingFrequency: term,
          }),
        }
      );

      return res
        .status(200)
        .json({ ok: true, person, account, subscription });
    }

    // ✅ Default success if no plan selected
    return res.status(200).json({ ok: true, person });
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
}
