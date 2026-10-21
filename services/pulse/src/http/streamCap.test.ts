import { describe, expect, it } from "vitest";
import { createStreamCounter } from "./streamCap.js";

describe("createStreamCounter", () => {
  it("allows up to the cap per key, and refuses the next", () => {
    const c = createStreamCounter(2);
    expect(c.tryAcquire("a")).toBeTypeOf("function");
    expect(c.tryAcquire("a")).toBeTypeOf("function");
    expect(c.tryAcquire("a")).toBeNull();
    expect(c.tryAcquire("b")).toBeTypeOf("function"); // another client is unaffected
  });

  it("a release frees one slot, and a second call of the same release frees nothing more", () => {
    const c = createStreamCounter(2);
    const r1 = c.tryAcquire("a")!;
    c.tryAcquire("a");
    expect(c.tryAcquire("a")).toBeNull();
    r1(); r1(); r1();
    expect(c.tryAcquire("a")).toBeTypeOf("function");
    expect(c.tryAcquire("a")).toBeNull();
  });

  it("deletes a key's entry when its last stream closes, so memory stays bounded", () => {
    const c = createStreamCounter(2);
    const rs = Array.from({ length: 1000 }, (_, i) => c.tryAcquire(`client-${i}`)!);
    expect(c.size()).toBe(1000);
    rs.forEach((r) => r());
    expect(c.size()).toBe(0);
  });
});
