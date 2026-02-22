export async function handler(event) {
  try {
    // 1) Zadarma verification ping: ?zd_echo=XXXX
    const zdEcho = event.queryStringParameters?.zd_echo;
    if (zdEcho) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "text/plain" },
        body: String(zdEcho),
      };
    }

    // Only POST matters
    if (event.httpMethod !== "POST") {
      return { statusCode: 200, body: "OK" };
    }

    const target = (process.env.LATENODE_WEBHOOK_URL || "").trim();
    if (!target) {
      return { statusCode: 500, body: "Missing LATENODE_WEBHOOK_URL" };
    }

    const DEBUG =
      String(process.env.DEBUG || "").toLowerCase() === "true" ||
      process.env.DEBUG === "1";

    const contentTypeRaw =
      event.headers?.["content-type"] ||
      event.headers?.["Content-Type"] ||
      "application/octet-stream";

    const contentType = String(contentTypeRaw).toLowerCase();
    const rawBody = event.body || "";

    // 2) Parse body (Zadarma often sends application/x-www-form-urlencoded)
    let parsed = null;
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const usp = new URLSearchParams(rawBody);
      parsed = Object.fromEntries(usp.entries());
    } else if (contentType.includes("application/json")) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = null;
      }
    }

    // 3) Extract event type from multiple possible keys
    const get = (k) => (parsed && typeof parsed === "object" ? parsed[k] : undefined);

    const eventType =
      get("event") ||
      get("event_type") ||
      get("type") ||
      get("notification") ||
      get("call_event") ||
      get("pbx_event") ||
      get("status") ||
      "";

    // 4) Allow-list filtering to reduce spam
    const allowEnv = (process.env.ALLOW_EVENTS || "").trim();
    const allowList = (allowEnv
      ? allowEnv.split(",").map((s) => s.trim()).filter(Boolean)
      : ["notify_start", "notify_end", "notify_answer", "call_start", "call_end", "missed_call", "inbound_sms"]
    ).map((s) => s.toLowerCase());

    const normalizedEventType = String(eventType || "").toLowerCase();

    // If we can't detect type, we still forward during debug; otherwise drop unknowns.
    const shouldForward = !normalizedEventType ? DEBUG : allowList.includes(normalizedEventType);

    if (DEBUG) {
      console.log("=== ZADARMA WEBHOOK HIT ===");
      console.log("CT:", contentTypeRaw);
      console.log("EVENT_TYPE_RAW:", eventType);
      console.log("ALLOW_LIST:", allowList);
      console.log("FORWARD?:", shouldForward);
      console.log("BODY_RAW:", rawBody);
      console.log("BODY_PARSED:", parsed);
    }

    if (!shouldForward) {
      // Drop noise but still return 200 so Zadarma won't retry
      return { statusCode: 200, body: "IGNORED" };
    }

    // 5) Forward to Latenode (force JSON)
    const forwardPayload = {
      source: "zadarma",
      receivedAt: new Date().toISOString(),
      contentType: contentTypeRaw,
      eventType: eventType || null,
      headers: {
        "user-agent": event.headers?.["user-agent"] || event.headers?.["User-Agent"] || null,
        "x-forwarded-for": event.headers?.["x-forwarded-for"] || null,
      },
      rawBody,
      parsedBody: parsed,
      query: event.queryStringParameters || {},
    };

    // Ensure fetch exists (Netlify Node 18/20 has it, but this is a safe fallback)
    const doFetch = typeof fetch === "function" ? fetch : null;
    if (!doFetch) {
      return { statusCode: 500, body: "fetch() not available in this runtime. Set Node to 18/20." };
    }

    const resp = await doFetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Proxy-Source": "netlify-zadarma-proxy",
      },
      body: JSON.stringify(forwardPayload),
    });

    const latenodeBodyText = await resp.text().catch(() => "");

    if (DEBUG) {
      // Return diagnostics to the caller so you can see it in PowerShell immediately
      const maskedTarget = target.length > 40 ? target.slice(0, 35) + "..." : target;

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            ok: true,
            forwardedTo: maskedTarget,
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
    }

    // Normal mode
    return { statusCode: 200, body: "OK" };
  } catch (e) {
    console.log("ERROR:", String(e));
    return { statusCode: 500, body: "ERROR" };
  }
}
