// A user-added HTTP MCP server the single-view Claude session loads (mirrors the
// server's UserMcpServer in app-config.ts). `id` is the server name (and `mcp__<id>`
// tool prefix); `url` its streamable-HTTP endpoint. In the Docker sandbox the URL's
// loopback host is rewritten to host.docker.internal server-side.
export interface UserMcpServer {
  id: string;
  url: string;
}
