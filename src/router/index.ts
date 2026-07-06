// App-wide navigation router. The singleton is exported so composables can push
// routes without component context. `routes` is exported for unit tests.
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { defineComponent } from "vue";

const Stub = defineComponent({ name: "RouteStub", render: () => null });

export const routes: RouteRecordRaw[] = [
  { path: "/", name: "kanban", component: Stub },
  { path: "/kanban", redirect: "/" },
  // Unknown URLs land on the board.
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({ history: createWebHistory(), routes });
