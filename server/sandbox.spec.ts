import { describe, it, expect, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { rewriteLoopbackForDocker, sandboxContainerName, sandboxEnabled, buildDockerRunArgs } from "./sandbox";

describe("rewriteLoopbackForDocker", () => {
  it("rewrites localhost / 127.0.0.1 to host.docker.internal", () => {
    expect(rewriteLoopbackForDocker("http://localhost:34567/api/hook")).toBe("http://host.docker.internal:34567/api/hook");
    expect(rewriteLoopbackForDocker("http://127.0.0.1:34567/api/mcp/x")).toBe("http://host.docker.internal:34567/api/mcp/x");
    expect(rewriteLoopbackForDocker("https://localhost/x")).toBe("https://host.docker.internal/x");
  });
  it("leaves non-loopback hosts untouched", () => {
    expect(rewriteLoopbackForDocker("http://example.com:34567/x")).toBe("http://example.com:34567/x");
    expect(rewriteLoopbackForDocker("http://localhostfoo.com/x")).toBe("http://localhostfoo.com/x"); // lookahead guard
  });
});

describe("sandboxContainerName", () => {
  it("prefixes the session id", () => {
    expect(sandboxContainerName("abc-123")).toBe("mulmoterminal-abc-123");
  });
});

describe("sandboxEnabled", () => {
  const prev = process.env.MULMOTERMINAL_SANDBOX;
  afterEach(() => {
    if (prev === undefined) delete process.env.MULMOTERMINAL_SANDBOX;
    else process.env.MULMOTERMINAL_SANDBOX = prev;
  });
  it("is off by default, on for 1/true", () => {
    delete process.env.MULMOTERMINAL_SANDBOX;
    expect(sandboxEnabled()).toBe(false);
    process.env.MULMOTERMINAL_SANDBOX = "1";
    expect(sandboxEnabled()).toBe(true);
    process.env.MULMOTERMINAL_SANDBOX = "true";
    expect(sandboxEnabled()).toBe(true);
    process.env.MULMOTERMINAL_SANDBOX = "0";
    expect(sandboxEnabled()).toBe(false);
  });
});

describe("buildDockerRunArgs", () => {
  const args = buildDockerRunArgs("sid1", ["--session-id", "sid1", "--mcp-config", "/x.json"], "/Users/me/proj");

  it("runs the sandbox image with claude + its args after the image", () => {
    const img = args.indexOf("mulmoterminal-sandbox");
    expect(img).toBeGreaterThan(0);
    expect(args.slice(img + 1)).toEqual(["claude", "--session-id", "sid1", "--mcp-config", "/x.json"]);
  });
  it("is an --rm -it named container with host-gateway and HOME", () => {
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "-it"]);
    expect(args[args.indexOf("--name") + 1]).toBe("mulmoterminal-sid1");
    expect(args).toContain("host.docker.internal:host-gateway");
    expect(args[args.indexOf("-e") + 1]).toBe("HOME=/home/node");
  });
  it("bind-mounts cwd at its SAME path (transcript encoding parity) + ~/.claude, and -w cwd", () => {
    expect(args).toContain("/Users/me/proj:/Users/me/proj");
    expect(args).toContain(`${path.join(os.homedir(), ".claude")}:/home/node/.claude`);
    expect(args[args.indexOf("-w") + 1]).toBe("/Users/me/proj");
  });
});
