// Frontend registration for the markdown plugin. The frontend registry
// (src/plugins-registry.ts) globs every plugin's index.ts and maps toolName ->
// viewComponent, mirroring MulmoClaude's REGISTRATION export.
import type { Component } from "vue";
import View from "./View.vue";

export const REGISTRATION: { toolName: string; viewComponent: Component } = {
  toolName: "presentDocument",
  viewComponent: View,
};
