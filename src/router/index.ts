// App-wide navigation router. The singleton is exported so composables can push
// routes without component context. `routes` is exported for unit tests.
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { defineComponent } from "vue";

const Stub = defineComponent({ name: "RouteStub", render: () => null });

export const routes: RouteRecordRaw[] = [
  { path: "/", name: "chat", component: Stub },
  { path: "/terminals", name: "terminals", component: Stub },
  // Kanban board: sessions as cards in lanes, auto-moved by agent activity.
  { path: "/kanban", name: "kanban", component: Stub },
  // Full-screen file explorer + editor, rooted at a project dir (?cwd=). Opened from a
  // terminal header's Files button.
  { path: "/files", name: "files", component: Stub },
  // Unknown URLs land on chat.
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({ history: createWebHistory(), routes });
