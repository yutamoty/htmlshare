import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.HTMLSHARE_URL || "https://share.yutamoty.com").replace(/\/+$/, "");
const API_KEY = process.env.HTMLSHARE_API_KEY || "";

const server = new McpServer({
  name: "htmlshare",
  version: "0.2.0",
});

async function callApi(path: string, init: RequestInit = {}) {
  if (!API_KEY) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: "HTMLSHARE_API_KEY is not set." }],
    };
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${API_KEY}`);

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: `Request failed (${res.status}): ${text}` }],
    };
  }

  return {
    content: [{ type: "text" as const, text }],
  };
}

server.tool(
  "upload_html",
  "Upload an HTML string to htmlshare and return a shareable URL.",
  {
    content: z.string().min(1).describe("Full HTML document string to publish"),
    title: z.string().max(200).optional().describe("Optional title metadata"),
    expires_days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe("Expiration in days for public shares (default: 30, max: 90). Ignored when visibility is private."),
    visibility: z
      .enum(["public", "private"])
      .optional()
      .describe('Visibility: "public" (default, expires in <=90d) or "private" (under /private/*, permanent & listed)'),
  },
  async ({ content, title, expires_days, visibility }) => {
    return callApi("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, title, expires_days, visibility }),
    });
  },
);

server.tool(
  "list_html",
  "List uploaded HTML items in htmlshare.",
  {
    visibility: z
      .enum(["public", "private"])
      .optional()
      .describe("Optional filter by visibility"),
  },
  async ({ visibility }) => {
    const query = visibility ? `?visibility=${encodeURIComponent(visibility)}` : "";
    return callApi(`/api/items${query}`, { method: "GET" });
  },
);

server.tool(
  "delete_html",
  "Delete an uploaded HTML item from htmlshare by visibility and UUID.",
  {
    visibility: z.enum(["public", "private"]).describe("Item visibility"),
    id: z.string().uuid().describe("UUID of the item to delete"),
  },
  async ({ visibility, id }) => {
    return callApi(`/api/items/${visibility}/${id}`, { method: "DELETE" });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
