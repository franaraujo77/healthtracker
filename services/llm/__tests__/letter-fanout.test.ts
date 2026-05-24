import { afterEach, describe, expect, it } from "vitest";

import {
  __resetForTests,
  publishDone,
  publishError,
  publishToken,
  subscribe,
} from "../src/streams/letter-fanout.ts";

describe("letter fanout", () => {
  afterEach(() => __resetForTests());

  it("replays buffered tokens to a late subscriber and then forwards live", () => {
    publishToken("letter-1", "a");
    publishToken("letter-1", "b");
    const received: unknown[] = [];
    const unsubscribe = subscribe("letter-1", (e) => received.push(e));
    publishToken("letter-1", "c");
    publishDone("letter-1");
    unsubscribe();

    expect(received).toEqual([
      { type: "token", content: "a" },
      { type: "token", content: "b" },
      { type: "token", content: "c" },
      { type: "done", letterId: "letter-1" },
    ]);
  });

  it("delivers a terminal error event", () => {
    publishToken("letter-2", "a");
    publishError("letter-2", "LETTER_UNAVAILABLE");
    const received: unknown[] = [];
    subscribe("letter-2", (e) => received.push(e));
    expect(received).toEqual([
      { type: "token", content: "a" },
      { type: "error", code: "LETTER_UNAVAILABLE" },
    ]);
  });

  it("publishToken after done is a no-op (closed buffer)", () => {
    publishToken("letter-3", "a");
    publishDone("letter-3");
    publishToken("letter-3", "should-not-appear");
    const received: unknown[] = [];
    subscribe("letter-3", (e) => received.push(e));
    expect(received).toEqual([
      { type: "token", content: "a" },
      { type: "done", letterId: "letter-3" },
    ]);
  });
});
