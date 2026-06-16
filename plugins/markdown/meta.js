// Markdown / document plugin — metadata shared by the server registry and the
// MCP broker (both import this plain-JS module). Mirrors MulmoClaude's
// src/plugins/markdown/meta.ts: a `toolName` (the MCP tool claude calls), an
// `apiNamespace` (the REST mount point), the `apiRoutes` it exposes, and which
// route the MCP broker dispatches to (`mcpDispatch`).
export const META = {
  toolName: "presentDocument",
  apiNamespace: "markdown",
  apiRoutes: {
    create: { method: "POST", path: "" },
  },
  mcpDispatch: "create",
};
