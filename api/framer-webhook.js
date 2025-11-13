import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Debug: log headers and parsed body to Vercel logs to inspect Framer requests
  console.log("🔎 req.headers:", req.headers);
  console.log("🔎 req.body (parsed):", req.body);

  // Support various ways Framer might send the secret: in body (webhook_secret | secret), headers, or query
  let body = req.body || {};

  // If body is a raw string (e.g., urlencoded) try to parse it so we can read webhook_secret
  if (typeof body === "string") {
    try {
      // Try JSON first
      body = JSON.parse(body);
    } catch (e) {
      // Fallback: try URLSearchParams for form-encoded bodies
      try {
        const params = new URLSearchParams(body);
        const obj = {};
        for (const [k, v] of params.entries()) obj[k] = v;
        body = obj;
      } catch (e2) {
        // leave body as string if parsing fails
      }
    }
  }

  const receivedSecret = (
    (body && (body.webhook_secret || body.secret)) ||
    req.headers["x-webhook-secret"] ||
    req.headers["x-framer-webhook-secret"] ||
    req.headers["webhook-secret"] ||
    req.query?.webhook_secret ||
    req.query?.secret ||
    ""
  )?.toString?.().trim?.() || "";

  console.log("🔐 Received secret present:", !!receivedSecret, "value:", receivedSecret ? "(hidden)" : "(none)");

  if (receivedSecret !== process.env.FRAMER_WEBHOOK_SECRET) {
    console.warn("🔒 Invalid webhook secret - rejecting request");
    return res.status(401).json({ error: "invalid webhook secret" });
  }

  // Outseta Base URL and Auth
  const OUTSETA_BASE = "https://venax.outseta.com/api/v1";
  const AUTH = `Outseta ${process.env.OUTSETA_API_KEY}:${process.env.OUTSETA_API_SECRET}`;

  // Frontend fields (German labels accepted)
  const contactPerson = ( body.Ansprechpartner || "").toString().trim();
  const email = (body.email || body.Email || "").toString().trim();
  const phone = ( body.phone || body.phoneNumber || body.telephone || body.Telefonnummer || "").toString().trim();
  const callbackWindow = (body.callbackWindow || body.rueckrufzeitraum || body.Rueckrufzeitraum || "").toString().trim();
  const message = (body.message || body.notes || body.IhrAnliegen || body.IhrAnliegenText || "").toString().trim();

  console.log("📩 Incoming Framer data:", {
    contactPerson,
    email,
    phone,
    callbackWindow,
    message,
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
    // Basic validation: require contact person and at least email or phone
    if (!contactPerson) {
      return res.status(400).json({ error: "contactPerson is required" });
    }
    if (!email && !phone) {
      return res.status(400).json({ error: "email or phone is required" });
    }

    // Persist submission locally
    try {
      const dataDir = path.join(process.cwd(), "data");
      fs.mkdirSync(dataDir, { recursive: true });
      const file = path.join(dataDir, "submissions.jsonl");
      const submission = {
        timestamp: new Date().toISOString(),
        contactPerson,
        email: email || null,
        phone: phone || null,
        callbackWindow: callbackWindow || null,
        message: message || null,
        rawBody: body,
      };
      fs.appendFileSync(file, JSON.stringify(submission) + "\n", "utf8");
      console.log("💾 Saved submission to:", file);
    } catch (err) {
      console.error("⚠️ Failed to persist submission:", err);
    }

    // 1️⃣ Create or update Person in Outseta
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
    // ✅ Default success
    return res.status(200).json({ ok: true, person });
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
}
