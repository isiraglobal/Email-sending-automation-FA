/**
 * ============================================================================
 * CLOUDFLARE WORKER — EMAIL OPEN TRACKING + WEBHOOKS
 * 
 * Database: D1 emailsendingopenrate
 * Binding: database
 * 
 * Endpoints:
 *   GET  /pixel?id=LEAD_ID&e=EMAIL&t=TIMESTAMP
 *     → Logs open, returns 1x1 transparent GIF
 *   GET  /api/opens?lead_id=LEAD_ID&key=SECRET_KEY
 *     → Returns all opens for a lead (admin only)
 *   GET  /api/opens/all?key=SECRET_KEY
 *     → Returns all opens (admin only)
 *   POST /api/cleanup?key=SECRET_KEY
 *     → Deletes opens older than 90 days
 *   POST /api/webhook?key=SECRET_KEY
 *     → Receives open events and forwards to configured webhook URL
 * ============================================================================
 */

const SECRET_KEY = "fa_open_track_2026_xK9mPqR";

// 1x1 transparent GIF (base64)
const PIXEL_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
  0x00, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x21, 0xF9, 0x04, 0x01, 0x0A,
  0x00, 0x01, 0x00, 0x2C, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3B
]);

// CORS headers for all responses
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    try {
      // PIXEL ENDPOINT — log open and return GIF
      if (path === "/pixel" && request.method === "GET") {
        return handlePixel(request, url, env);
      }

      // API ENDPOINTS — admin queries
      if (path === "/api/opens" && request.method === "GET") {
        return handleApiOpens(request, url, env);
      }

      if (path === "/api/opens/all" && request.method === "GET") {
        return handleApiOpensAll(request, url, env);
      }

      if (path === "/api/cleanup" && request.method === "POST") {
        return handleCleanup(request, url, env);
      }

      // WEBHOOK ENDPOINT — accepts open events and forwards
      if (path === "/api/webhook" && request.method === "POST") {
        return handleWebhook(request, url, env);
      }

      // HEALTH CHECK — verify D1 binding is working
      if (path === "/health" && request.method === "GET") {
        const db = env.database;
        if (!db) {
          return new Response(JSON.stringify({
            status: "UNHEALTHY",
            d1_bound: false,
            fix: "Go to Cloudflare Dashboard → Workers → emailsendingopenrate → Settings → Bindings → Add D1 Database with variable name 'database'"
          }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
          });
        }
        try {
          const result = await db.prepare("SELECT COUNT(*) as count FROM email_opens").all();
          return new Response(JSON.stringify({
            status: "HEALTHY",
            d1_bound: true,
            total_opens: result.results[0].count
          }), {
            status: 200,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
          });
        } catch (e) {
          return new Response(JSON.stringify({
            status: "D1_BOUND_BUT_TABLE_MISSING",
            d1_bound: true,
            error: e.message,
            fix: "Table 'email_opens' does not exist. Run the CREATE TABLE SQL in D1 console."
          }), {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS }
          });
        }
      }

      // Default response
      return new Response(JSON.stringify({ error: "Unknown endpoint" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });

    } catch (error) {
      console.error("Worker error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }
  }
};

/**
 * GET /pixel?id=LEAD_ID&e=EMAIL&t=TIMESTAMP
 * Logs the open event and returns a 1x1 transparent GIF
 */
async function handlePixel(request, url, env) {
  const leadId = url.searchParams.get("id");
  const email = url.searchParams.get("e");
  const timestamp = url.searchParams.get("t");

  if (!leadId || !email) {
    return new Response("Missing parameters", { status: 400, headers: CORS_HEADERS });
  }

  try {
    const userAgent = request.headers.get("user-agent") || "";
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const country = request.headers.get("cf-ipcountry") || "unknown";
    const openedAt = timestamp || new Date().toISOString();

    // Insert into D1 database
    const db = env.database;
    if (!db) {
      console.error("D1 database binding 'database' is not configured");
    } else {
      const stmt = db.prepare(
        `INSERT INTO email_opens (lead_id, opened_at, user_agent, ip, country)
         VALUES (?, ?, ?, ?, ?)`
      );
      await stmt.bind(leadId, openedAt, userAgent, ip, country).run();
    }

    console.log(`Open logged: lead_id=${leadId}, email=${email}, ip=${ip}, country=${country}`);

  } catch (error) {
    console.error("Error logging open:", error);
    // Still return GIF even if logging fails (don't break email)
  }

  // Return 1x1 transparent GIF with cache prevention
  return new Response(PIXEL_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      ...CORS_HEADERS
    }
  });
}

/**
 * GET /api/opens?lead_id=LEAD_ID&key=SECRET_KEY
 * Returns all opens for a specific lead (admin only)
 */
async function handleApiOpens(request, url, env) {
  const key = url.searchParams.get("key");
  const leadId = url.searchParams.get("lead_id");

  if (key !== SECRET_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  if (!leadId) {
    return new Response(JSON.stringify({ error: "Missing lead_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  try {
    const db = env.database;
    if (!db) {
      return new Response(JSON.stringify({ error: "D1 database binding not configured. Go to Cloudflare Dashboard → Workers → Settings → Bindings → Add D1 Database with variable name 'database'" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    const stmt = db.prepare(
      `SELECT id, lead_id, opened_at, user_agent, ip, country 
       FROM email_opens 
       WHERE lead_id = ? 
       ORDER BY opened_at DESC`
    );

    const result = await stmt.bind(leadId).all();

    return new Response(JSON.stringify({
      lead_id: leadId,
      open_count: result.results.length,
      opens: result.results
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }
}

/**
 * GET /api/opens/all?key=SECRET_KEY
 * Returns all opens across all leads (admin only)
 */
async function handleApiOpensAll(request, url, env) {
  const key = url.searchParams.get("key");

  if (key !== SECRET_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  try {
    const db = env.database;
    if (!db) {
      return new Response(JSON.stringify({ error: "D1 database binding not configured. Go to Cloudflare Dashboard → Workers → Settings → Bindings → Add D1 Database with variable name 'database'" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    const stmt = db.prepare(
      `SELECT id, lead_id, opened_at, user_agent, ip, country 
       FROM email_opens 
       ORDER BY opened_at DESC 
       LIMIT 10000`
    );

    const result = await stmt.all();

    // Group by lead_id
    const grouped = {};
    result.results.forEach(open => {
      if (!grouped[open.lead_id]) {
        grouped[open.lead_id] = [];
      }
      grouped[open.lead_id].push(open);
    });

    return new Response(JSON.stringify({
      total_opens: result.results.length,
      unique_leads: Object.keys(grouped).length,
      opens_by_lead: grouped
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }
}

/**
 * POST /api/cleanup?key=SECRET_KEY
 * Deletes opens older than 90 days
 */
async function handleCleanup(request, url, env) {
  const key = url.searchParams.get("key");

  if (key !== SECRET_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  try {
    const db = env.database;
    if (!db) {
      return new Response(JSON.stringify({ error: "D1 database binding not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    const stmt = db.prepare(
      `DELETE FROM email_opens WHERE opened_at < ?`
    );

    const result = await stmt.bind(ninetyDaysAgo).run();

    return new Response(JSON.stringify({
      deleted: result.meta.changes,
      before_date: ninetyDaysAgo
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }
}

/**
 * POST /api/webhook?key=SECRET_KEY
 * Receives external webhook calls and logs them
 * Use this for third-party integrations (e.g., Zapier, Make, Pipedream)
 * 
 * Body (JSON):
 * {
 *   "event": "open" | "reply" | "bounce",
 *   "lead_id": "lead-42",
 *   "email": "user@example.com",
 *   "data": { ... }
 * }
 */
async function handleWebhook(request, url, env) {
  const key = url.searchParams.get("key");

  if (key !== SECRET_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 403,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  try {
    const body = await request.json();
    const { event, lead_id, email, data } = body;

    if (!event || !lead_id) {
      return new Response(JSON.stringify({ error: "Missing event or lead_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    console.log(`Webhook received: event=${event}, lead_id=${lead_id}, email=${email}`);

    // Store webhook event in D1 for audit trail
    try {
      const db = env.database;
      if (db) {
        const stmt = db.prepare(
          `INSERT INTO email_opens (lead_id, opened_at, user_agent, ip, country)
           VALUES (?, ?, ?, ?, ?)`
        );

        const now = new Date().toISOString();
        await stmt.bind(
          lead_id + "-webhook-" + event,
          now,
          "webhook/" + event,
          "webhook",
          "webhook"
        ).run();
      } else {
        console.error("D1 database binding not configured — webhook event not stored");
      }
    } catch (dbError) {
      console.error("Failed to log webhook event:", dbError);
    }

    return new Response(JSON.stringify({
      received: true,
      event: event,
      lead_id: lead_id
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }
}
