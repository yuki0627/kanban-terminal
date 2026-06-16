// Stdio MCP server for the GUI chat protocol spike.
//
// Exposes the GUI-protocol tools:
//   presentDocument({ markdown })  - Phase I, one-way: render markdown.
//   presentForm({ title, fields }) - Phase II, round-trip: render a form and
//                                    block until the user submits, returning
//                                    the answer to claude so the turn continues.
//
// When claude calls a tool we POST the payload to mulmoterminal's /api/gui
// route; the server publishes it on the "gui" pub/sub channel and the Vue GUI
// panel renders it. This is the transport-agnostic "data channel" the spike is
// validating end-to-end under an interactive PTY (see docs/gui-protocol-spike.md).
//
// Context reaches this subprocess via env (set when the server builds the
// mcp-config), mirroring MulmoClaude's MULMOCLAUDE_CHAT_SESSION_ID:
//   MULMOTERMINAL_SESSION_ID  - the session whose GUI panel should render this
//   MULMOTERMINAL_PORT        - the mulmoterminal HTTP port to POST to
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const SESSION_ID = process.env.MULMOTERMINAL_SESSION_ID;
const PORT = process.env.MULMOTERMINAL_PORT || "3456";
const BASE_URL = `http://localhost:${PORT}`;
const GUI_URL = `${BASE_URL}/api/gui`;

// Overall time we wait for a form answer before giving up and telling claude the
// user didn't respond. The server holds each long-poll open for a shorter window
// (see /api/gui/answer); we just keep re-polling until this deadline.
const FORM_TIMEOUT_MS = 10 * 60 * 1000;

const server = new McpServer({ name: "mulmoterminal-gui", version: "0.0.0" });

server.registerTool(
  "presentDocument",
  {
    title: "Present Document",
    description:
      "Render markdown in the user's GUI panel (right side), beside the terminal. " +
      "Use this to show formatted content — tables, lists, headings, code — that is " +
      "easier to read rendered than as plain terminal text.",
    inputSchema: { markdown: z.string().describe("The markdown to render in the GUI panel.") },
  },
  async ({ markdown }) => {
    const res = await fetch(GUI_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        type: "presentDocument",
        data: { markdown },
      }),
    });
    if (!res.ok) {
      throw new Error(`/api/gui responded ${res.status}`);
    }
    return { content: [{ type: "text", text: "Rendered markdown in the GUI panel." }] };
  }
);

// One field of a presentForm. `name` keys the answer; `type` picks the control.
const fieldSchema = z.object({
  name: z.string().describe("Key this field's value appears under in the answer."),
  label: z.string().optional().describe("Human-readable label (defaults to name)."),
  type: z
    .enum(["text", "textarea", "number", "select"])
    .optional()
    .describe("Control type (default: text)."),
  options: z.array(z.string()).optional().describe("Choices for a 'select' field."),
  placeholder: z.string().optional(),
  required: z.boolean().optional(),
});

// Long-poll the server until the user submits the form (or we hit the deadline).
// The server holds each request open briefly and returns 204 when nothing has
// arrived yet, so this loop paces itself without busy-waiting.
async function awaitAnswer(requestId) {
  const deadline = Date.now() + FORM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${GUI_URL}/answer/${requestId}`);
    if (res.status === 200) return (await res.json()).answer;
    if (res.status === 404) return null; // form no longer pending (e.g. server restarted)
    // 204 => no answer yet; poll again.
  }
  return undefined; // timed out
}

server.registerTool(
  "presentForm",
  {
    title: "Present Form",
    description:
      "Ask the user for structured input via a form in the GUI panel, instead of " +
      "free-text in the terminal. BLOCKS until the user submits, then returns their " +
      "answers as a JSON object keyed by each field's name. Use this when you need " +
      "specific values (choices, parameters, confirmations) to continue.",
    inputSchema: {
      title: z.string().optional().describe("Heading shown above the form."),
      fields: z.array(fieldSchema).min(1).describe("The fields to collect."),
      submitLabel: z.string().optional().describe("Label for the submit button."),
    },
  },
  async ({ title, fields, submitLabel }) => {
    const requestId = randomUUID();
    const res = await fetch(GUI_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: SESSION_ID,
        type: "presentForm",
        data: { requestId, schema: { title, fields, submitLabel } },
      }),
    });
    if (!res.ok) {
      throw new Error(`/api/gui responded ${res.status}`);
    }

    const answer = await awaitAnswer(requestId);
    if (answer === undefined) {
      return { content: [{ type: "text", text: "The user did not submit the form (timed out)." }] };
    }
    if (answer === null) {
      return { content: [{ type: "text", text: "The form is no longer available." }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(answer) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
