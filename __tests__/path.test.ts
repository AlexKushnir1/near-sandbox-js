import { describe, it, beforeAll, expect } from 'vitest';
import { join } from "path";
import got from "got";
import { DEFAULT_NEAR_SANDBOX_VERSION, Sandbox } from "../src/sandbox/Sandbox.js";
import { getDirname } from "../src/binary/binaryUtils.js";
import { TypedError } from '../src/errors.js';

const TEST_BIN_DIR = join(getDirname(import.meta.url), "..", "test_files");
const TEST_BIN_PATH = join(TEST_BIN_DIR, `near-sandbox-${DEFAULT_NEAR_SANDBOX_VERSION}`, "near-sandbox");

describe('Sandbox local binary handling', () => {
  beforeAll(async () => {
    process.env['DIR_TO_DOWNLOAD_BINARY'] = TEST_BIN_DIR;
    const sandbox = await Sandbox.start({});
    try {
      const response = await got(`${sandbox.rpcUrl}/status`);
      expect(response.statusCode).toBe(200);
    } finally {
      await expect(sandbox.tearDown()).resolves.not.toThrow();
    }
  }, 150000);

  it("fails to start sandbox if local binary path does not exist", async () => {
    process.env['NEAR_SANDBOX_BIN_PATH'] = "Not-existing-path";

    const promise = Sandbox.start({});

    await expect(promise).rejects.toBeInstanceOf(TypedError);
    await expect(promise).rejects.toThrow(
      /NEAR_SANDBOX_BIN_PATH does not exist\./
    );

    //restore valid path
    process.env['NEAR_SANDBOX_BIN_PATH'] = TEST_BIN_PATH;
    const sandbox = await Sandbox.start({});
    try {
      const response = await got(`${sandbox.rpcUrl}/status`);
      expect(response.statusCode).toBe(200);
    } finally {
      await expect(sandbox.tearDown()).resolves.not.toThrow();
    }
  });
});
