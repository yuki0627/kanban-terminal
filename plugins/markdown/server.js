// Server-side handlers for the markdown plugin's REST routes. The registry
// mounts these under /api/<apiNamespace> (see meta.js); the MCP broker POSTs the
// tool args here and forwards the returned envelope to the toolResult store.
//
// An envelope is { data, message, instructions, title? }. `data` is the payload
// the GUI view renders; its presence gates rendering (the broker only publishes a
// toolResult when `data` is set). `message`/`instructions` are returned to claude.
export const handlers = {
  create(args) {
    const { title, markdown } = args || {};
    if (typeof markdown !== "string") {
      throw new Error("`markdown` is required and must be a string.");
    }
    const data = { markdown, title };
    return {
      title,
      data,
      jsonData: data,
      message: "Rendered the document in the GUI panel.",
    };
  },
};
