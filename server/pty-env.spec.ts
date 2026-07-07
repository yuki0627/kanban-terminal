import { describe, expect, it } from "vitest";

import { ptyEnv } from "./pty-env";

describe("ptyEnv", () => {
  it("sets a UTF-8 LANG when locale variables are absent", () => {
    const result = ptyEnv({ PATH: "/bin" });

    expect(result).toEqual({ PATH: "/bin", LANG: "en_US.UTF-8" });
  });

  it("leaves LANG=UTF-8 environments unchanged", () => {
    const base = { PATH: "/bin", LANG: "ja_JP.UTF-8" };

    expect(ptyEnv(base)).toEqual(base);
  });

  it("leaves LC_CTYPE=UTF-8 environments unchanged when LANG is absent", () => {
    const base = { PATH: "/bin", LC_CTYPE: "en_US.UTF-8" };

    expect(ptyEnv(base)).toEqual(base);
  });

  it("treats lowercase utf8 as UTF-8", () => {
    const base = { PATH: "/bin", LANG: "en_us.utf8" };

    expect(ptyEnv(base)).toEqual(base);
  });

  it("removes non-UTF-8 LC_ALL and sets LANG to UTF-8", () => {
    const result = ptyEnv({ PATH: "/bin", LC_ALL: "C" });

    expect(result).toEqual({ PATH: "/bin", LANG: "en_US.UTF-8" });
  });

  it("does not mutate the base object", () => {
    const base = { PATH: "/bin", LC_ALL: "C", LC_CTYPE: "C" };

    const result = ptyEnv(base);

    expect(base).toEqual({ PATH: "/bin", LC_ALL: "C", LC_CTYPE: "C" });
    expect(result).toEqual({ PATH: "/bin", LANG: "en_US.UTF-8" });
    expect(result).not.toBe(base);
  });
});
