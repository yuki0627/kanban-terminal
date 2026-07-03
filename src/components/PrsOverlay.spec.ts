import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import PrsOverlay from "./PrsOverlay.vue";

// The view is route-driven; stub usePrsView so the overlay is "open" without a router.
vi.mock("../composables/usePrsView", () => ({
  usePrsView: () => ({ isOpen: ref(true), close: vi.fn() }),
}));

type Repo = { repo: string; prs?: unknown[]; error?: string; truncated?: boolean };
function mockPrs(repos: Repo[]) {
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ repos }) })) as unknown as typeof fetch;
}

describe("PrsOverlay", () => {
  it("groups repos and lists their open PRs", async () => {
    mockPrs([
      {
        repo: "octo/hello",
        prs: [
          {
            number: 3,
            title: "fix the bug",
            author: "alice",
            updatedAt: new Date().toISOString(),
            isDraft: false,
            url: "u3",
            review: "APPROVED",
            ci: "passing",
          },
        ],
        truncated: true,
      },
      { repo: "octo/empty", prs: [] },
    ]);
    const w = mount(PrsOverlay);
    await flushPromises();
    expect(w.text()).toContain("octo/hello");
    expect(w.text()).toContain("#3");
    expect(w.text()).toContain("fix the bug");
    expect(w.text()).toContain("approved");
    expect(w.text()).toContain("more open PRs"); // truncation note
    expect(w.text()).toContain("No open PRs"); // octo/empty
  });

  it("shows a per-repo error", async () => {
    mockPrs([{ repo: "octo/x", error: "no access" }]);
    const w = mount(PrsOverlay);
    await flushPromises();
    expect(w.text()).toContain("no access");
  });

  it("hints to configure repos when none are set", async () => {
    mockPrs([]);
    const w = mount(PrsOverlay);
    await flushPromises();
    expect(w.text()).toContain("No repositories configured");
  });
});
