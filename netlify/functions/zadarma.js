export async function handler(event) {
    try {
      // Zadarma verification ping: ?zd_echo=XXXX
      const zdEcho = event.queryStringParameters?.zd_echo;
      if (zdEcho) {
        return {
          statusCode: 200,
          headers: { "Content-Type": "text/plain" },
          body: String(zdEcho),
        };
      }
  
      // Forward POST payload to Latenode webhook
      if (event.httpMethod === "POST") {
        const target = process.env.LATENODE_WEBHOOK_URL;
        if (!target) {
          return { statusCode: 500, body: "Missing LATENODE_WEBHOOK_URL" };
        }
  
        const contentType =
          event.headers["content-type"] || event.headers["Content-Type"] || "application/json";
  
        await fetch(target, {
          method: "POST",
          headers: { "Content-Type": contentType },
          body: event.body || "",
        });
  
        return { statusCode: 200, body: "OK" };
      }
  
      return { statusCode: 200, body: "OK" };
    } catch (e) {
      return { statusCode: 500, body: "ERROR" };
    }
  }
  