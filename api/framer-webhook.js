import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // ------------------------------------------------------
  // 1️⃣ SAFE BODY PARSING
  // ------------------------------------------------------
  let body = req.body || {};

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      try {
        const params = new URLSearchParams(body);
        const obj = {};
        for (const [k, v] of params.entries()) obj[k] = v;
        body = obj;
      } catch {
        body = {};
      }
    }
  }

  // ------------------------------------------------------
  // 2️⃣ SECRET EXTRACTION (robust + case-insensitive)
  // ------------------------------------------------------
  // Check if this is a Framer webhook (they have specific headers)
  const isFramerWebhook = req.headers['user-agent']?.includes('framer') || 
                         req.headers['framer-webhook-submission-id'];

  const receivedSecret =
    (
      body.webhook_secret ||
      body.secret ||
      body.Secret ||
      body.WebhookSecret ||
      req.headers["x-webhook-secret"] ||
      req.headers["x-framer-webhook-secret"] ||
      ""
    )
      ?.toString?.()
      .trim?.() || "";

  const expectedSecret = (process.env.FRAMER_WEBHOOK_SECRET || "").trim();

  console.log("🔐 DEBUG SECRETS:", {
    receivedSecret,
    expectedSecret,
    isFramerWebhook,
    userAgent: req.headers['user-agent'],
    headers: req.headers,
    rawBody: body,
  });

  // Skip secret validation for Framer webhooks (they don't support custom secrets)
  if (!isFramerWebhook && (!receivedSecret || receivedSecret !== expectedSecret)) {
    console.warn("🔒 Invalid webhook secret - rejecting request");
    return res.status(401).json({ error: "invalid webhook secret" });
  }

  // Framer webhooks are allowed without secret validation since they don't support it
  if (isFramerWebhook) {
    console.log("✅ Framer webhook detected - skipping secret validation");
  }

  // ------------------------------------------------------
  // 3️⃣ OUTSETA CONFIG
  // ------------------------------------------------------
  const OUTSETA_BASE = "https://venax.outseta.com/api/v1";
  const AUTH = `Outseta ${process.env.OUTSETA_API_KEY}:${process.env.OUTSETA_API_SECRET}`;

  // ------------------------------------------------------
  // 4️⃣ MAP FRONTEND FIELDS
  // ------------------------------------------------------
  const contactPerson = (
    body.Ansprechperson || 
    body.Ansprechpartner || 
    body.contactPerson || 
    ""
  ).trim();
  const email = (body.email || body.Email || "").trim();
  const phone = (
    body.phone ||
    body.phoneNumber ||
    body.telephone ||
    body.Telefonnummer ||
    ""
  ).trim();
  const callbackWindow = (
    body.callbackWindow ||
    body.rueckrufzeitraum ||
    body.Rueckrufzeitraum ||
    body['Rückrufzeitraum'] ||
    ""
  ).trim();
  const message = (
    body.message ||
    body.notes ||
    body.IhrAnliegen ||
    body.IhrAnliegenText ||
    body['Ihr Anliegen (optional)'] ||
    ""
  ).trim();

  console.log("📩 Incoming Framer data:", {
    contactPerson,
    email,
    phone,
    callbackWindow,
    message,
  });

  // ------------------------------------------------------
  // 5️⃣ SAFE FETCH HELPERS
  // ------------------------------------------------------
  async function safeFetch(url, options) {
    const resp = await fetch(url, options);
    const txt = await resp.text();

    let json;
    try {
      json = JSON.parse(txt);
    } catch {
      json = { raw: txt };
    }

    console.log("📡 Outseta API Response:", resp.status, json);

    if (!resp.ok) throw new Error(`Outseta API error: ${resp.status}`);

    return json;
  }

  try {
    // ------------------------------------------------------
    // 6️⃣ VALIDATION
    // ------------------------------------------------------
    if (!contactPerson) {
      return res.status(400).json({ error: "contactPerson is required" });
    }
    if (!email && !phone) {
      return res.status(400).json({ error: "email or phone is required" });
    }

    // ------------------------------------------------------
    // 7️⃣ PERSIST LOCALLY (non-blocking)
    // ------------------------------------------------------
    try {
      const dataDir = path.join(process.cwd(), "data");
      await fs.promises.mkdir(dataDir, { recursive: true });

      const file = path.join(dataDir, "submissions.jsonl");
      const record = {
        timestamp: new Date().toISOString(),
        contactPerson,
        email: email || null,
        phone: phone || null,
        callbackWindow: callbackWindow || null,
        message: message || null,
        rawBody: body,
      };
      await fs.promises.appendFile(file, JSON.stringify(record) + "\n");
    } catch (err) {
      console.error("⚠️ Failed to persist submission:", err);
    }

    // ------------------------------------------------------
    // 8️⃣ CREATE PERSON IN OUTSETA
    // ------------------------------------------------------
    const person = await safeFetch(`${OUTSETA_BASE}/crm/people`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: AUTH,
      },
      body: JSON.stringify({
        Email: email || undefined,
        FirstName: contactPerson,
        PhoneNumber: phone || undefined,
        Notes: message || undefined,
      }),
    });

    // ------------------------------------------------------
    // 9️⃣ SUCCESS RESPONSE
    // ------------------------------------------------------
    return res.status(200).json({ ok: true, person });

  } catch (err) {
    console.error("🔥 Webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
}
