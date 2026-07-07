import { describe, it, expect } from "vitest";
import { isClientRoute } from "./spa-fallback";

describe("SPA fallback matcher", () => {
  it("serves the SPA shell for client routes", () => {
    expect(isClientRoute("/")).toBe(true);
    expect(isClientRoute("/kanban")).toBe(true);
    expect(isClientRoute("/some/client/path")).toBe(true);
  });

  it("never shadows the /api prefix", () => {
    expect(isClientRoute("/api/sessions")).toBe(false);
    expect(isClientRoute("/api/this-route-does-not-exist")).toBe(false);
    // The bare /api path is reserved too — it must 404, not serve the SPA shell.
    expect(isClientRoute("/api")).toBe(false);
  });

  it("does not over-reserve paths that merely start with the letters 'api'", () => {
    // /apidocs is a client route — only the /api segment itself is reserved.
    expect(isClientRoute("/apidocs")).toBe(true);
  });
});
