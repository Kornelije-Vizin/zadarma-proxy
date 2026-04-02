export async function handler(event) {
  console.log("=== FUNCTION HIT: zadarma-sms ===");
  console.log("Method:", event.httpMethod);
  console.log("Path:", event.path);
  console.log("Query:", JSON.stringify(event.queryStringParameters || {}, null, 2));
  console.log("Headers:", JSON.stringify(event.headers || {}, null, 2));
  console.log("Raw body:", event.body || "");

  try {
    // 1) Zadarma verification ping
    const zdEcho = event.queryStringParameters?.zd_echo;
    if (zdEcho) {
      console.log("Verification ping received, echoing zd_echo");
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/plain" },
        body: String(zdEcho),
      };
    }

    if (event.httpMethod !== "POST") {
      console.log("Non-POST request received, returning OK");
      return { statusCode: 200, body: "OK" };
    }

    // ENV VAR
    const target = (process.env.LATENODE_INBOUND_SMS_WEBHOOK_URL || "").trim();
    console.log("Has LATENODE_INBOUND_SMS_WEBHOOK_URL:", !!target);
    console.log(
      "Target preview:",
      target ? target.slice(0, 60) + "..." : "MISSING"
    );

    if (!target) {
      console.log("Missing LATENODE_INBOUND_SMS_WEBHOOK_URL");
      return { statusCode: 500, body: "Missing LATENODE_INBOUND_SMS_WEBHOOK_URL" };
    }

    const debugEnv = process.env.NODE_ENV || "";
    const DEBUG = debugEnv.toLowerCase() !== "production";
    console.log("NODE_ENV:", debugEnv);
    console.log("DEBUG:", DEBUG);

    const contentTypeRaw =
      event.headers?.["content-type"] ||
      event.headers?.["Content-Type"] ||
      "application/octet-stream";

    const contentType = String(contentTypeRaw).toLowerCase();
    const rawBody = event.body || "";

    // Parse body
    let parsed = null;
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const usp = new URLSearchParams(rawBody);
      parsed = Object.fromEntries(usp.entries());
    } else if (contentType.includes("application/json")) {
      try {
        parsed = JSON.parse(rawBody);
      } catch (err) {
        console.log("JSON parse failed");
        parsed = null;
      }
    }

    console.log("Parsed body:", JSON.stringify(parsed, null, 2));

    // Extract event type
    const get = (k) => (parsed && typeof parsed === "object" ? parsed[k] : undefined);

    const eventType =
      get("event") ||
      get("event_type") ||
      get("type") ||
      get("notification") ||
      get("sms_event") ||
      get("status") ||
      "";

    console.log("Detected eventType:", eventType);

    // Allow-list
    const allowEnv = (process.env.ALLOW_SMS_EVENTS || "").trim();
    const allowList = (
      allowEnv
        ? allowEnv.split(",").map((s) => s.trim()).filter(Boolean)
        : ["sms", "inbound_sms"]
    ).map((s) => s.toLowerCase());

    const normalizedEventType = String(eventType || "").toLowerCase();

    const shouldForward = !normalizedEventType
      ? DEBUG
      : allowList.includes(normalizedEventType);

    console.log("ALLOW_SMS_EVENTS raw:", allowEnv);
    console.log("Allow list:", JSON.stringify(allowList));
    console.log("Normalized event type:", normalizedEventType);
    console.log("shouldForward:", shouldForward);

    if (!shouldForward) {
      console.log("Event ignored by allow-list");
      return { statusCode: 200, body: "IGNORED" };
    }

    // Forward
    const forwardPayload = {
      source: "zadarma",
      webhookType: "sms",
      receivedAt: new Date().toISOString(),
      contentType: contentTypeRaw,
      eventType: eventType || null,
      headers: {
        "user-agent":
          event.headers?.["user-agent"] ||
          event.headers?.["User-Agent"] ||
          null,
        "x-forwarded-for": event.headers?.["x-forwarded-for"] || null,
      },
      rawBody,
      parsedBody: parsed,
      query: event.queryStringParameters || {},
    };

    console.log("Forward payload:", JSON.stringify(forwardPayload, null, 2));
    console.log("Sending request to Latenode...");

    const resp = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Proxy-Source": "netlify-zadarma-sms-proxy",
      },
      body: JSON.stringify(forwardPayload),
    });

    const latenodeBodyText = await resp.text().catch(() => "");

    console.log("Latenode response status:", resp.status);
    console.log("Latenode response body:", latenodeBodyText);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        {
          ok: true,
          latenodeStatus: resp.status,
          latenodeBodyPreview: String(latenodeBodyText || "").slice(0, 300),
          detectedEventType: eventType || null,
          normalizedEventType: normalizedEventType || null,
          shouldForward,
        },
        null,
        2
      ),
    };
  } catch (e) {
    console.log("ERROR object:", e);
    console.log("ERROR string:", String(e));
    console.log("ERROR message:", e?.message || "no-message");

    return { statusCode: 500, body: "ERROR" };
  }
}