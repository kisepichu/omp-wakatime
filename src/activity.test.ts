import { describe, expect, test } from "bun:test";
import { Throttle, fileActivity } from "./activity.ts";

const cwd = "/work/repo";

describe("fileActivity", () => {
  test("read reports the resolved source path as a non-write", () => {
    const details = { meta: { source: { type: "path", value: "/work/repo/calc.py" } } };
    expect(fileActivity({ toolName: "read", input: { path: "calc.py:1-5" }, details, isError: false }, cwd)).toEqual([
      { file: "/work/repo/calc.py", write: false },
    ]);
  });

  test("read of a non-path source (URL, internal URI) reports nothing", () => {
    const details = { meta: { source: { type: "url", value: "https://example.com" } } };
    expect(fileActivity({ toolName: "read", input: {}, details, isError: false }, cwd)).toEqual([]);
  });

  test("edit counts only changed diff rows as AI line changes", () => {
    const details = {
      path: "/work/repo/calc.py",
      diff: " 1|def add(a, b):\n 2|    return a + b\n-3|old\n+3|\n+4|def sub(a, b):\n+5|    return a - b",
    };
    expect(fileActivity({ toolName: "edit", input: { paths: ["calc.py"] }, details, isError: false }, cwd)).toEqual([
      { file: "/work/repo/calc.py", write: true, aiLineChanges: 4 },
    ]);
  });

  test("multi-file edit reports every file resolved against cwd", () => {
    const input = { paths: ["a.ts", "/abs/b.ts"] };
    expect(fileActivity({ toolName: "edit", input, details: {}, isError: false }, cwd)).toEqual([
      { file: "/work/repo/a.ts", write: true },
      { file: "/abs/b.ts", write: true },
    ]);
  });

  test("write falls back to the input path when details lack resolvedPath", () => {
    expect(fileActivity({ toolName: "write", input: { path: "notes.md" }, details: {}, isError: false }, cwd)).toEqual([
      { file: "/work/repo/notes.md", write: true },
    ]);
  });

  test("failed tool calls report nothing", () => {
    const details = { resolvedPath: "/work/repo/notes.md" };
    expect(fileActivity({ toolName: "write", input: { path: "notes.md" }, details, isError: true }, cwd)).toEqual([]);
  });
});

describe("Throttle", () => {
  test("suppresses repeated non-write heartbeats for the same entity until the interval passes", () => {
    const t = new Throttle(120_000);
    expect(t.shouldSend("/a", false, 0)).toBe(true);
    expect(t.shouldSend("/a", false, 119_999)).toBe(false);
    expect(t.shouldSend("/a", false, 120_000)).toBe(true);
  });

  test("entity changes and writes always send", () => {
    const t = new Throttle(120_000);
    t.shouldSend("/a", false, 0);
    expect(t.shouldSend("/b", false, 1)).toBe(true);
    expect(t.shouldSend("/b", true, 2)).toBe(true);
    expect(t.shouldSend("/b", false, 3)).toBe(false);
  });
});
