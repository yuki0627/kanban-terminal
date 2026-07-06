import { describe, it, expect } from "vitest";
import { createRouter, createMemoryHistory } from "vue-router";
import { router, routes } from "./index";

describe("router route table", () => {
  it("resolves / as the kanban board", () => {
    expect(router.resolve("/").name).toBe("kanban");
  });

  it("redirects legacy and unknown paths to the board (/)", async () => {
    // Use an isolated memory-history router so navigation (which follows redirects)
    // doesn't touch the shared singleton / jsdom history.
    const mem = createRouter({ history: createMemoryHistory(), routes });
    await mem.push("/kanban");
    expect(mem.currentRoute.value.name).toBe("kanban");
    expect(mem.currentRoute.value.path).toBe("/");
    await mem.push("/this/does/not/exist");
    expect(mem.currentRoute.value.name).toBe("kanban");
    expect(mem.currentRoute.value.path).toBe("/");
  });
});
