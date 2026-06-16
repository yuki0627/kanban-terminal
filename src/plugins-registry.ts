// Frontend plugin registry. Globs every plugin's index.ts, filters by the same
// configuration data the server uses (plugins/plugins.json), and exposes
// getPlugin(toolName) so the GUI panel can look up a toolResult's viewComponent.
// Mirrors MulmoClaude's src/tools/index.ts getPlugin().
import type { Component } from "vue";
import config from "../plugins/plugins.json";

interface Registration {
  toolName: string;
  viewComponent: Component;
}

// Eagerly import all plugin registrations. Keyed by module path, e.g.
// "../plugins/markdown/index.ts".
const modules = import.meta.glob<{ REGISTRATION: Registration }>("../plugins/*/index.ts", {
  eager: true,
});

const enabled = new Set((config as { enabled: string[] }).enabled);
const registry: Record<string, Registration> = {};

for (const [modulePath, mod] of Object.entries(modules)) {
  // ".../plugins/<name>/index.ts" -> "<name>"
  const name = modulePath.split("/").slice(-2)[0];
  if (!enabled.has(name)) continue;
  registry[mod.REGISTRATION.toolName] = mod.REGISTRATION;
}

export function getPlugin(toolName: string): Registration | undefined {
  return registry[toolName];
}
