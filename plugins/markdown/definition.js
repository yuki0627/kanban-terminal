// MCP tool definition for presentDocument. The broker registers this with the
// MCP SDK (inputSchema is a zod raw shape, as McpServer.registerTool expects).
import { z } from "zod";

export const DEFINITION = {
  title: "Present Document",
  description:
    "Render a markdown document in the user's GUI panel (right side), beside the " +
    "terminal. Use this to show formatted content — tables, lists, headings, code — " +
    "that is easier to read rendered than as plain terminal text.",
  inputSchema: {
    title: z.string().optional().describe("Optional heading for the document."),
    markdown: z.string().describe("The markdown content to render in the GUI panel."),
  },
};
