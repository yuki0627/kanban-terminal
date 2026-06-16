// Stdio MCP broker for the full GUI chat protocol. Replaces the hard-coded
// present-markdown.js spike server. It registers one MCP tool per enabled plugin
// (from server/plugins-registry.js, driven by plugins/plugins.json) and acts as a
// thin HTTP bridge — exactly MulmoClaude's broker shape (server/agent/mcp-server.ts):
//
//   tool call  ->  POST /api/<namespace>            (the plugin's own REST route)
//              ->  envelope { data, message, instructions, title? }
//              ->  POST /api/agent/toolResult        (store + publish on the session channel)
//                  ...only when `data` is set (data gates rendering)
//              ->  return message+instructions text to claude
//
// The form round-trip is NOT a blocking call: the user's answer comes back by
// being typed into the PTY (see the GUI panel / form view), so every tool returns
// immediately.
//
// Context reaches this subprocess via env (set when the server builds the
// mcp-config), mirroring MulmoClaude's MULMOCLAUDE_CHAT_SESSION_ID:
//   MULMOTERMINAL_SESSION_ID  - the session whose GUI panel should render this
//   MULMOTERMINAL_PORT        - the mulmoterminal HTTP port to POST to
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { plugins } from "../plugins-registry.js";

const SESSION_ID = process.env.MULMOTERMINAL_SESSION_ID;
const PORT = process.env.MULMOTERMINAL_PORT || "3456";
const BASE_URL = `http://localhost:${PORT}`;

const server = new McpServer({ name: "mulmoterminal-gui", version: "0.0.0" });

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res;
}

for (const plugin of plugins) {
  const { meta, definition } = plugin;
  server.registerTool(
    meta.toolName,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
    },
    async (args) => {
      // 1. Dispatch to the plugin's REST route.
      const route = meta.apiRoutes[meta.mcpDispatch];
      const dispatchUrl = `${BASE_URL}/api/${meta.apiNamespace}${route.path}`;
      const envelope = await (await postJson(dispatchUrl, args)).json();

      // 2. Publish a toolResult to the GUI — only when there is data to render.
      if (envelope.data !== undefined) {
        await postJson(`${BASE_URL}/api/agent/toolResult`, {
          sessionId: SESSION_ID,
          toolName: meta.toolName,
          uuid: randomUUID(),
          title: envelope.title,
          data: envelope.data,
          jsonData: envelope.jsonData ?? envelope.data,
          message: envelope.message,
        });
      }

      // 3. Return the narration to claude.
      const parts = [envelope.message, envelope.instructions].filter(Boolean);
      return { content: [{ type: "text", text: parts.length ? parts.join("\n") : "Done" }] };
    }
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
