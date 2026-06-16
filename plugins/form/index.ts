// Frontend registration for the form plugin.
import type { Component } from "vue";
import View from "./View.vue";

export const REGISTRATION: { toolName: string; viewComponent: Component } = {
  toolName: "presentForm",
  viewComponent: View,
};
