/**    
* This test demonstrates providing a custom configuration to the sandbox,
* including additional accounts and genesis parameters.
* Be careful to ensure that additional properties in your own configurations are correct.
 */
import { describe, it, expect } from 'vitest';
import { Sandbox } from "../src/sandbox/Sandbox.js";
import { SandboxConfig } from "../src/sandbox/config.js";
import { KeyPair } from "@near-js/crypto";
import { NEAR } from "@near-js/tokens";
import { JsonRpcProvider } from "@near-js/providers";

describe('Sandbox with custom configuration', () => {
    it('provide custom config with additional account', async () => {
        const newKeyPair = KeyPair.fromRandom("ED25519");
        const config: SandboxConfig = {
            rpcPort: 3031,
            additionalGenesis: { epoch_length: 100 },
            additionalAccounts: [
                {
                    accountId: "alice.near",
                    publicKey: newKeyPair.getPublicKey().toString(),
                    privateKey: newKeyPair.toString(),
                    balance: NEAR.toUnits(1000000)
                },
            ],
        };
        const sandbox = await Sandbox.start({ config });
        try {
            const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
            const accountInfo = await provider.viewAccount("alice.near");

            expect(accountInfo.amount).toBe(NEAR.toUnits(1000000));
        } finally {
            await expect(sandbox.tearDown()).resolves.not.toThrow();
        }
    });
});
