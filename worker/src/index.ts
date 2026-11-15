import { Hono, type Context } from "hono";
import { renderPrivateListUi, renderUploadUi, type PrivateItem } from "./ui";

type Bindings = {
  BUCKET: R2Bucket;
  API_KEY: string;
  BASE_URL: string;
};

type Visibility = "public" | "private";

const MAX_CONTENT_BYTES = 5 * 1024 * 1024;
const DEFAULT_EXPIRES_DAYS = 30;
const MAX_EXPIRES_DAYS = 90;
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const app = new Hono<{ Bindings: Bindings }>();

/** 定数時間に近い形で Bearer トークンを検証する */
function verifyToken(expected: string, actual: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(expected);
  const b = encoder.encode(actual);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function renderNotFound(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>404 Not Found - htmlshare</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: grid;
      place-items: center;
      min-height: 80vh;
      margin: 0;
      color: #374151;
    }
    .box { text-align: center; padding: 24px; }
    h1 { margin: 0 0 8px; font-size: 1.5rem; }
    p { margin: 0; color: #6b7280; }
  </style>
</head>
<body>
  <div class="box">
    <h1>404 Not Found</h1>
    <p>このページは存在しないか、有効期限が切れています。</p>
  </div>
</body>
</html>`;
}

async function serveHtml(
  c: Context<{ Bindings: Bindings }>,
  id: string,
  visibility: Visibility,
): Promise<Response> {
  if (!UUID_V4_RE.test(id)) {
    return c.html(renderNotFound(), 404, {
      "X-Robots-Tag": "noindex, nofollow",
    });
  }

  const key = `${visibility}/${id}`;
  const object = await c.env.BUCKET.get(key);
  if (!object) {
    return c.html(renderNotFound(), 404, {
      "X-Robots-Tag": "noindex, nofollow",
    });
  }

  if (visibility === "public") {
    const expiresAtRaw = object.customMetadata?.expires_at;
    if (expiresAtRaw) {
      const expiresAtMs = Date.parse(expiresAtRaw);
      if (!Number.isNaN(expiresAtMs) && Date.now() > expiresAtMs) {
        await c.env.BUCKET.delete(key);
        return c.html(renderNotFound(), 404, {
          "X-Robots-Tag": "noindex, nofollow",
        });
      }
    }
  }

  const headers = new Headers();
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set(
    "Cache-Control",
    visibility === "private" ? "private, no-store" : "private, max-age=300",
  );

  return new Response(object.body, {
    status: 200,
    headers,
  });
}

app.get("/", (c) => {
  return c.html(renderNotFound(), 404, {
    "X-Robots-Tag": "noindex, nofollow",
  });
});

app.get("/private/upload", (c) => {
  return c.html(renderUploadUi(), 200, {
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "private, no-store",
  });
});

app.get("/robots.txt", (c) => {
  return c.text("User-agent: *\nDisallow: /\n");
});

app.get("/favicon.ico", (c) => c.body(null, 204));

app.post("/api/upload", async (c) => {
  const configuredKey = c.env.API_KEY;
  if (!configuredKey) {
    return c.json({ error: "Server API_KEY is not configured" }, 500);
  }

  const authHeader = c.req.header("Authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !verifyToken(configuredKey, match[1].trim())) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: {
    content?: unknown;
    title?: unknown;
    expires_days?: unknown;
    visibility?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (typeof body.content !== "string" || body.content.trim().length === 0) {
    return c.json({ error: "content must be a non-empty string" }, 400);
  }

  const contentBytes = new TextEncoder().encode(body.content).byteLength;
  if (contentBytes > MAX_CONTENT_BYTES) {
    return c.json(
      { error: `content exceeds maximum size of ${MAX_CONTENT_BYTES} bytes` },
      413,
    );
  }

  let visibility: Visibility = "public";
  if (body.visibility !== undefined) {
    if (body.visibility !== "public" && body.visibility !== "private") {
      return c.json(
        { error: 'visibility must be "public" or "private"' },
        400,
      );
    }
    visibility = body.visibility;
  }

  let expiresAtIso: string | null = null;
  if (visibility === "public") {
    let expiresDays = DEFAULT_EXPIRES_DAYS;
    if (body.expires_days !== undefined) {
      if (
        typeof body.expires_days !== "number" ||
        !Number.isInteger(body.expires_days) ||
        body.expires_days < 1 ||
        body.expires_days > MAX_EXPIRES_DAYS
      ) {
        return c.json(
          { error: `expires_days must be an integer between 1 and ${MAX_EXPIRES_DAYS}` },
          400,
        );
      }
      expiresDays = body.expires_days;
    }
    expiresAtIso = new Date(
      Date.now() + expiresDays * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  const title =
    typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";

  const id = crypto.randomUUID();
  const key = `${visibility}/${id}`;
  const nowIso = new Date().toISOString();

  const customMetadata: Record<string, string> = {
    title,
    visibility,
    created_at: nowIso,
  };
  if (expiresAtIso) {
    customMetadata.expires_at = expiresAtIso;
  }

  await c.env.BUCKET.put(key, body.content, {
    httpMetadata: {
      contentType: "text/html; charset=utf-8",
    },
    customMetadata,
  });

  const baseUrl = (c.env.BASE_URL || new URL(c.req.url).origin).replace(/\/+$/, "");
  const path = visibility === "private" ? `/private/${id}` : `/${id}`;
  return c.json(
    {
      id,
      visibility,
      url: `${baseUrl}${path}`,
      expires_at: expiresAtIso,
    },
    201,
  );
});

app.get("/private", async (c) => {
  const items: PrivateItem[] = [];
  let cursor: string | undefined;

  do {
    const listed = await c.env.BUCKET.list({
      prefix: "private/",
      include: ["customMetadata"],
      cursor,
    });

    for (const obj of listed.objects) {
      const id = obj.key.slice("private/".length);
      if (!UUID_V4_RE.test(id)) continue;
      items.push({
        id,
        title: obj.customMetadata?.title || "",
        createdAt: obj.customMetadata?.created_at || obj.uploaded.toISOString(),
        size: obj.size,
      });
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return c.html(renderPrivateListUi(items), 200, {
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "private, no-store",
  });
});

app.get("/private/:id", (c) => serveHtml(c, c.req.param("id"), "private"));

app.delete("/private/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID_V4_RE.test(id)) {
    return c.json({ error: "Invalid ID" }, 400);
  }
  await c.env.BUCKET.delete(`private/${id}`);
  return c.json({ deleted: id });
});

app.get("/:id", (c) => serveHtml(c, c.req.param("id"), "public"));

export default app;
