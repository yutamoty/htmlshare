import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.HTMLSHARE_URL || "https://share.yutamoty.com").replace(/\/+$/, "");
const API_KEY = process.env.HTMLSHARE_API_KEY || "";

const server = new McpServer({
  name: "htmlshare",
  version: "0.1.0",
});

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
    if (!API_KEY) {
      return {
        isError: true,
        content: [{ type: "text", text: "HTMLSHARE_API_KEY is not set." }],
      };
    }

    const res = await fetch(`${BASE_URL}/api/upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ content, title, expires_days, visibility }),
    });

    const text = await res.text();
    if (!res.ok) {
      return {
        isError: true,
        content: [{ type: "text", text: `Upload failed (${res.status}): ${text}` }],
      };
    }

    return {
      content: [{ type: "text", text }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
