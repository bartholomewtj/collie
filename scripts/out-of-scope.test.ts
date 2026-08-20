import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// Drives adws/adw_modules/quality.py's parse_out_of_scope / scope_breaches via
// the unittest file that imports those functions. A reimplementation here would
// not prove the gate.

const ROOT = join(import.meta.dir, "..");

describe("out-of-scope gate (#69)", () => {
  test("quality.py parser and matcher (real module)", () => {
    const proc = Bun.spawnSync(
      ["uv", "run", "python", "-m", "unittest", "adw_modules.test_out_of_scope", "-v"],
      {
        cwd: ROOT,
        env: { ...process.env, PYTHONPATH: join(ROOT, "adws"), PYTHONUTF8: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(proc.exitCode, out).toBe(0);
  });
});
