import { Hono, type Context } from "hono";
import { getAppleTouchIconPng, getFaviconPng } from "./favicon";
import { renderPrivateListUi, renderUploadUi, type ShareListItem } from "./ui";

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

/** SHA-256 ダイジェストと timingSafeEqual で定数時間比較を行う（トークン長も漏洩しない） */
async function verifyToken(expected: string, actual: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [aHash, bHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
  ]);
  return crypto.subtle.timingSafeEqual(aHash, bHash);
}

async function authorizeApi(
  c: Context<{ Bindings: Bindings }>,
): Promise<Response | null> {
  const configuredKey = c.env.API_KEY;
  if (!configuredKey) {
    return c.json({ error: "Server API_KEY is not configured" }, 500);
  }
  const authHeader = c.req.header("Authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !(await verifyToken(configuredKey, match[1].trim()))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
}

function verifyPrivateUiRequest(
  c: Context<{ Bindings: Bindings }>,
): Response | null {
  if (c.req.header("X-Htmlshare-Ui") !== "1") {
    return c.json({ error: "Missing X-Htmlshare-Ui header" }, 403);
  }
  return null;
}

function getBaseUrl(c: Context<{ Bindings: Bindings }>): string {
  return (c.env.BASE_URL || new URL(c.req.url).origin).replace(/\/+$/, "");
}

function renderNotFound(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
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

async function listBucketItems(
  bucket: R2Bucket,
  visibility: Visibility,
  baseUrl: string,
) {
  const prefix = `${visibility}/`;
  const results: Array<{
    id: string;
    visibility: Visibility;
    title: string;
    url: string;
    created_at: string;
    expires_at: string | null;
    size: number;
  }> = [];

  let cursor: string | undefined;
  do {
    const listed = await bucket.list({
      prefix,
      include: ["customMetadata"],
      cursor,
    });

    for (const obj of listed.objects) {
      const id = obj.key.slice(prefix.length);
      if (!UUID_V4_RE.test(id)) continue;
      const expiresAt = obj.customMetadata?.expires_at || null;
      if (visibility === "public" && expiresAt) {
        const ms = Date.parse(expiresAt);
        if (!Number.isNaN(ms) && Date.now() > ms) continue;
      }
      results.push({
        id,
        visibility,
        title: obj.customMetadata?.title || "",
        url: `${baseUrl}${visibility === "private" ? `/private/${id}` : `/${id}`}`,
        created_at: obj.customMetadata?.created_at || obj.uploaded.toISOString(),
        expires_at: expiresAt,
        size: obj.size,
      });
    }

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return results;
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
    visibility === "private" ? "private, no-store" : "private, no-cache",
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

function servePngIcon(bytes: Uint8Array): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

app.get("/favicon.ico", () => servePngIcon(getFaviconPng()));
app.get("/favicon.png", () => servePngIcon(getFaviconPng()));
app.get("/apple-touch-icon.png", () => servePngIcon(getAppleTouchIconPng()));

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (raw, dec) => {
      const code = Number(dec);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
    })
    .replace(/&#x([0-9a-f]+);/gi, (raw, hex) => {
      const code = parseInt(hex, 16);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
    });
}

function extractHtmlTitle(html: string): string {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return decodeBasicEntities(match[1]).replace(/\s+/g, " ").trim().slice(0, 200);
}

async function handleUpload(c: Context<{ Bindings: Bindings }>): Promise<Response> {
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

  const explicitTitle =
    typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const title = explicitTitle || extractHtmlTitle(body.content);

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

  const baseUrl = getBaseUrl(c);
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
}

app.post("/private/upload", async (c) => {
  const uiError = verifyPrivateUiRequest(c);
  if (uiError) return uiError;
  return handleUpload(c);
});

app.post("/api/upload", async (c) => {
  const authError = await authorizeApi(c);
  if (authError) return authError;
  return handleUpload(c);
});

app.get("/api/items", async (c) => {
  const authError = await authorizeApi(c);
  if (authError) return authError;

  const filter = c.req.query("visibility");
  if (filter !== undefined && filter !== "public" && filter !== "private") {
    return c.json({ error: 'visibility must be "public" or "private"' }, 400);
  }

  const baseUrl = getBaseUrl(c);
  const targets: Visibility[] = filter ? [filter] : ["private", "public"];
  const lists = await Promise.all(
    targets.map((v) => listBucketItems(c.env.BUCKET, v, baseUrl)),
  );
  const items = lists
    .flat()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return c.json({ items });
});

app.delete("/api/items/:visibility/:id", async (c) => {
  const authError = await authorizeApi(c);
  if (authError) return authError;

  const visibility = c.req.param("visibility");
  const id = c.req.param("id");
  if (visibility !== "public" && visibility !== "private") {
    return c.json({ error: 'visibility must be "public" or "private"' }, 400);
  }
  if (!UUID_V4_RE.test(id)) {
    return c.json({ error: "Invalid ID" }, 400);
  }

  await c.env.BUCKET.delete(`${visibility}/${id}`);
  return c.json({ deleted: `${visibility}/${id}` });
});

app.get("/private", async (c) => {
  const baseUrl = getBaseUrl(c);
  const [privateListed, publicListed] = await Promise.all([
    listBucketItems(c.env.BUCKET, "private", baseUrl),
    listBucketItems(c.env.BUCKET, "public", baseUrl),
  ]);

  const toUiItems = (
    items: Awaited<ReturnType<typeof listBucketItems>>,
  ): ShareListItem[] =>
    items
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .map((item) => ({
        id: item.id,
        visibility: item.visibility,
        title: item.title,
        url: item.url,
        createdAt: item.created_at,
        expiresAt: item.expires_at,
        size: item.size,
      }));

  return c.html(
    renderPrivateListUi(toUiItems(privateListed), toUiItems(publicListed)),
    200,
    {
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store",
    },
  );
});

app.delete("/private/items/:visibility/:id", async (c) => {
  const uiError = verifyPrivateUiRequest(c);
  if (uiError) return uiError;

  const visibility = c.req.param("visibility");
  const id = c.req.param("id");
  if (visibility !== "public" && visibility !== "private") {
    return c.json({ error: 'visibility must be "public" or "private"' }, 400);
  }
  if (!UUID_V4_RE.test(id)) {
    return c.json({ error: "Invalid ID" }, 400);
  }
  await c.env.BUCKET.delete(`${visibility}/${id}`);
  return c.json({ deleted: `${visibility}/${id}` });
});

app.get("/private/:id", (c) => serveHtml(c, c.req.param("id"), "private"));

app.get("/:id", (c) => serveHtml(c, c.req.param("id"), "public"));

export default app;
