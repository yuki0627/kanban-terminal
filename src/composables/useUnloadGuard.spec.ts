import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useUnloadGuard, reportActiveTerminals } from "./useUnloadGuard";

// Mount a bare host so the composable's onMounted/onUnmounted run (and the
// beforeunload listener is registered/removed) on a real lifecycle.
const Host = defineComponent({
  setup() {
    useUnloadGuard();
    return () => null;
  },
});

const fireBeforeUnload = (): boolean => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

describe("useUnloadGuard", () => {
  let wrapper: ReturnType<typeof mount> | null = null;
  beforeEach(() => reportActiveTerminals(0));
  // Unmount between tests so no host's listener lingers and skews the next case.
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  it("does not block the unload when no terminal is live", () => {
    wrapper = mount(Host);
    expect(fireBeforeUnload()).toBe(false);
  });

  it("blocks the unload while a terminal is live", () => {
    wrapper = mount(Host);
    reportActiveTerminals(2);
    expect(fireBeforeUnload()).toBe(true);
  });

  it("stops blocking again once the count drops to zero", () => {
    wrapper = mount(Host);
    reportActiveTerminals(1);
    expect(fireBeforeUnload()).toBe(true);
    reportActiveTerminals(0);
    expect(fireBeforeUnload()).toBe(false);
  });

  it("removes the listener on unmount (no lingering guard)", () => {
    wrapper = mount(Host);
    reportActiveTerminals(3);
    wrapper.unmount();
    wrapper = null;
    expect(fireBeforeUnload()).toBe(false);
  });
});
