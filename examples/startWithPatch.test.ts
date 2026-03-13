import { describe, it, expect, beforeAll } from 'vitest';
import { JsonRpcProvider } from "@near-js/providers";
import { Account } from "@near-js/accounts";
import { KeyPairSigner } from "@near-js/signers";
import { KeyPair } from "@near-js/crypto";
import { Sandbox } from '../src/sandbox/Sandbox.js';
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY } from '../src/sandbox/config.js';
import { readFileSync } from 'fs';

describe('Dumping and restoring sandbox state', () => {
    let dumpedGenesis: Record<string, unknown>;
    let dumpedNodeKey: Record<string, unknown>;
    let dumpedValidatorKey: Record<string, unknown>;

    // This before hook sets up the initial state and dumps it.
    // It will run once for the entire test file.
    beforeAll(async () => {
        const sandbox = await Sandbox.start({});
        try {
            const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
            const rootAccount = new Account(
                DEFAULT_ACCOUNT_ID,
                provider,
                new KeyPairSigner(KeyPair.fromString(DEFAULT_PRIVATE_KEY))
            );
            const wasmContract = readFileSync("node_modules/near-hello/dist/main.wasm");

            const newSecretKey = KeyPair.fromRandom("ED25519");
            await rootAccount.createAccount("alice.sandbox", newSecretKey.getPublicKey(), 10n ** 24n);

            const newAccount = new Account(
                "alice.sandbox",
                provider,
                new KeyPairSigner(newSecretKey)
            );

            const deployResult = await newAccount.deployContract(new Uint8Array(wasmContract));
            // In newer versions of near-sandbox (2.9.0+), the status may be "FINAL" instead of "EXECUTED_OPTIMISTIC"
            expect(deployResult.final_execution_status === "EXECUTED_OPTIMISTIC" || deployResult.final_execution_status === "FINAL")
                .toBeTruthy();
            await new Promise(resolve => setTimeout(resolve, 2000)); // wait for the contract to be deployed

            const response = (await provider.viewContractCode(newAccount.accountId)).code;
            expect(response).toEqual(new Uint8Array(wasmContract));
            await newAccount.callFunction({
                contractId: newAccount.accountId,
                methodName: "setValue",
                args: { value: "HARDCODED_VALUE" },
                gas: BigInt(3000000000000),
                waitUntil: "FINAL",
            });
            const state = await provider.callFunction("alice.sandbox", "getValue", {});
            if (typeof state === "undefined") {
                throw new Error("Expected state to be a string");
            }
            expect(state.toString()).toBe("HARDCODED_VALUE");

            // Dump the final state for use in subsequent tests
            const { genesis, nodeKey, validatorKey } = await sandbox.dump();
            dumpedGenesis = genesis;
            dumpedNodeKey = nodeKey;
            dumpedValidatorKey = validatorKey;
        } finally {
            await expect(sandbox.tearDown()).resolves.not.toThrow();
        }

    });

    it.concurrent('contract returns expected value', async () => {
        const sandbox = await Sandbox.start({
            config: {
                additionalGenesis: dumpedGenesis,
                nodeKey: dumpedNodeKey,
                validatorKey: dumpedValidatorKey,
            },
        });
        try {
            const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });

            const state = await provider.callFunction("alice.sandbox", "getValue", {});
            expect(state?.toString()).toBe("HARDCODED_VALUE");
        } finally {
            await expect(sandbox.tearDown()).resolves.not.toThrow();
        }
    });

    it.concurrent('set contract method and returns expected value', async () => {
        const sandbox = await Sandbox.start({
            config: {
                additionalGenesis: dumpedGenesis,
                nodeKey: dumpedNodeKey,
                validatorKey: dumpedValidatorKey,
            },
        });
        const account = new Account(
            DEFAULT_ACCOUNT_ID,
            new JsonRpcProvider({ url: sandbox.rpcUrl }),
            new KeyPairSigner(KeyPair.fromString(DEFAULT_PRIVATE_KEY))
        );

        await account.callFunction({
            contractId: "alice.sandbox",
            methodName: "setValue",
            args: { value: "New value in a new test" },
            gas: BigInt(3000000000000),
            waitUntil: "FINAL",
        });

        try {
            const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
            const state = await provider.callFunction("alice.sandbox", "getValue", {});
            if (typeof state === "undefined") {
                throw new Error("Expected state to be a string");
            }
            expect(state.toString()).toBe("New value in a new test");
        } finally {
            await expect(sandbox.tearDown()).resolves.not.toThrow();
        }
    });

    it.concurrent('fails if want to create account with existing name', async () => {
        const sandbox = await Sandbox.start({
            config: {
                additionalGenesis: dumpedGenesis,
                nodeKey: dumpedNodeKey,
                validatorKey: dumpedValidatorKey,
            },
        });
        const account = new Account(
            DEFAULT_ACCOUNT_ID,
            new JsonRpcProvider({ url: sandbox.rpcUrl }),
            new KeyPairSigner(KeyPair.fromString(DEFAULT_PRIVATE_KEY))
        );
        try {
            await expect(
                account.createAccount(
                    'alice.sandbox',
                    KeyPair.fromRandom('ED25519').getPublicKey(),
                    10n ** 24n
                )
            ).rejects.toThrow(
                /Can't create a new account alice\.sandbox, because it already exists/
            );
        } finally {
            await expect(sandbox.tearDown()).resolves.not.toThrow();
        }
    });
});
