import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ULTRATHINK_CONFIG_PATH_ENV } from "../../src/config.js";

export async function installTempGlobalUltrathinkConfigPath(prefix = "ultrathink-config-"): Promise<() => void> {
  const previous = process.env[ULTRATHINK_CONFIG_PATH_ENV];
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  process.env[ULTRATHINK_CONFIG_PATH_ENV] = path.join(dir, "ultrathink.json");
  return () => {
    if (previous === undefined) {
      delete process.env[ULTRATHINK_CONFIG_PATH_ENV];
    } else {
      process.env[ULTRATHINK_CONFIG_PATH_ENV] = previous;
    }
  };
}
