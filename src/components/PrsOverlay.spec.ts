import { describe, it, expect, vi } from "vitest";
import { ref } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import PrsOverlay from "./PrsOverlay.vue";

// The view is route-driven; stub usePrsView so the overlay is "open" without a router.
vi.mock("../composables/usePrsView", () => ({
  usePrsView: () => ({ isOpen: ref(true), close: vi.fn() }),
}));

type Repo = { repo: string; prs?: unknown[]; error?: string; truncated?: boolean };
type IssueRepo = { repo: string; issues?: unknown[]; error?: string; truncated?: boolean; url?: string };

// The overlay fetches /api/prs and /api/issues in parallel; route the mock by path.
function mockFetch(prs: Repo[], issues: IssueRepo[] = []) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const repos = url.includes("/api/issues") ? issues : prs;
    return { ok: true, json: async () => ({ repos }) };
  }) as unknown as typeof fetch;
}

describe("PrsOverlay", () => {
  it("groups repos and lists their open PRs", async () => {
    mockFetch([
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

  it("lists open issues below the PRs and links to GitHub when truncated", async () => {
    mockFetch(
      [{ repo: "octo/hello", prs: [] }],
      [
        {
          repo: "octo/hello",
          issues: [{ number: 42, title: "flaky test", author: "bob", updatedAt: new Date().toISOString(), url: "https://github.com/octo/hello/issues/42" }],
          truncated: true,
          url: "https://github.com/octo/hello/issues",
        },
        { repo: "octo/quiet", issues: [] },
      ],
    );
    const w = mount(PrsOverlay);
    await flushPromises();
    expect(w.text()).toContain("Issues");
    expect(w.text()).toContain("#42");
    expect(w.text()).toContain("flaky test");
    expect(w.text()).toContain("No open issues"); // octo/quiet
    const seeAll = w.get("a.prs-link");
    expect(seeAll.attributes("href")).toBe("https://github.com/octo/hello/issues");
    expect(seeAll.text()).toContain("see all open issues");
  });

  it("shows a per-repo error", async () => {
    mockFetch([{ repo: "octo/x", error: "no access" }]);
    const w = mount(PrsOverlay);
    await flushPromises();
    expect(w.text()).toContain("no access");
  });

  it("hints to configure repos when none are set", async () => {
    mockFetch([]);
    const w = mount(PrsOverlay);
    await flushPromises();
    expect(w.text()).toContain("No repositories configured");
  });
});
