// Form plugin metadata — shared by the server registry and the MCP broker. See
// plugins/markdown/meta.js for the field meanings.
export const META = {
  toolName: "presentForm",
  apiNamespace: "form",
  apiRoutes: {
    create: { method: "POST", path: "" },
  },
  mcpDispatch: "create",
};
