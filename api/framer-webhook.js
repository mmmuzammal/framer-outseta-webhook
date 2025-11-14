import fs from "fs";
import path from "path";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end(); // --- 1. Request Body Parsing aur Secret Check ---

  let body = req.body || {};
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      try {
        const params = new URLSearchParams(body);
        const obj = {};
        for (const [k, v] of params.entries()) obj[k] = v;
        body = obj;
      } catch (e2) {
        body = {};
      }
    }
    console.log("Parsed Request Body:", body);
  }

  const receivedSecret =
    (
      (body && (body.webhook_secret || body.secret)) ||
      req.headers["x-webhook-secret"] ||
      req.headers["x-framer-webhook-secret"] ||
      ""
    )
      ?.toString?.()
      .trim?.() || "";

  if (!receivedSecret || receivedSecret !== process.env.FRAMER_WEBHOOK_SECRET) {
    console.warn("🔒 Invalid webhook secret - rejecting request");
    return res.status(401).json({ error: "invalid webhook secret" });
  } // --- 2. Outseta Credentials aur Data Extraction ---

  const OUTSETA_BASE = "https://venax.outseta.com/api/v1";
  const AUTH = `Outseta ${process.env.OUTSETA_API_KEY}:${process.env.OUTSETA_API_SECRET}`; // 🛑 INPUT FIELDS (Incoming from Framer/Postman) ke naam aapki requirement ke mutabiq hain

  const ansprechpartner = (body.Ansprechpartner || "").toString().trim();
  const email = (body.email || body.Email || "").toString().trim();
  const telefonnummer = (body.Telefonnummer || body.phone || "")
    .toString()
    .trim(); // Naya naam
  const rueckrufzeitraum = (body.Rückrufzeitraum || body.callbackWindow || "")
    .toString()
    .trim(); // Naya naam
  const ihrAnliegen = (body.IhrAnliegen || body.message || "")
    .toString()
    .trim(); // Naya naam

  console.log("📩 Incoming Framer data:", {
    ansprechpartner,
    email,
    telefonnummer,
    rueckrufzeitraum,
    ihrAnliegen,
  }); // --- 3. Utility Function ---

  async function safeFetch(url, options) {
    // ... (safeFetch function code remains the same as before) ...
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
  } // --- 4. Main Logic ---

  try {
    // Basic validation
    if (!ansprechpartner) {
      return res.status(400).json({ error: "Ansprechpartner is required" });
    }
    if (!email && !telefonnummer) {
      return res
        .status(400)
        .json({ error: "Email or Telefonnummer is required" });
    } // 5. 🚀 Create or update Person in Outseta

    const person = await safeFetch(`${OUTSETA_BASE}/crm/people`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: AUTH,
      },
      body: JSON.stringify({
        // STANDARD FIELDS
        Email: email || undefined,
        FirstName: ansprechpartner.split(" ")[0] || undefined,
        LastName: ansprechpartner.split(" ")[1] || undefined, // Phone aur Notes ko bhi standard field mein bhej rahe hain
        PhoneNumber: telefonnummer || undefined,
        Notes: ihrAnliegen || undefined, // 🛑 CUSTOM PROPERTIES (SchemaLessData) // Yahan keys woh hain jo Outseta mein custom field ke naam hain.
        SchemaLessData: {
          Ansprechpartner: ansprechpartner,
          Rückrufzeitraum: rueckrufzeitraum,
          Telefonnummer: telefonnummer || undefined,
          IhrAnliegen: ihrAnliegen || undefined,
        },
      }),
    }); // ✅ Success Response
    return res.status(200).json({ ok: true, person });
  } catch (err) {
    console.error("🔥 Webhook error:", err);
    return res.status(500).json({ error: err.message });
  }
}
