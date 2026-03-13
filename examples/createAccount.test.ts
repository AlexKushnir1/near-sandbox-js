/**
 * This test demonstrates basic behavior of near-sandbox-js, 
 * starting a sandbox with a custom version.
 * This allows it to interact with returned rpcUrl and imports default account.
 * Also shows how to create a new account and send tokens to it.
 */
import { describe, it, expect } from 'vitest';
import { Sandbox } from '../src/sandbox/Sandbox.js';
import { KeyPair } from '@near-js/crypto';
import { JsonRpcProvider } from '@near-js/providers';
import { Account } from '@near-js/accounts';
import { KeyPairSigner } from '@near-js/signers';
import { DEFAULT_ACCOUNT_ID, DEFAULT_BALANCE, DEFAULT_PRIVATE_KEY } from '../src/sandbox/config.js';
import { NEAR } from '@near-js/tokens';

describe('Sandbox account operations', () => {
  it('create a new account and send tokens', async () => {
    const sandbox = await Sandbox.start({ config: { rpcPort: 3032 } });
    try {
      const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
      const keyPair = KeyPair.fromString(DEFAULT_PRIVATE_KEY);
      expect(sandbox.rpcUrl).toBe('http://127.0.0.1:3032');

      const account = new Account(
        DEFAULT_ACCOUNT_ID,
        provider,
        new KeyPairSigner(keyPair)
      );
      const accountInfo = await account.getState();
      expect(accountInfo.balance.total).toBe(DEFAULT_BALANCE);

      const newKeyPair = KeyPair.fromRandom("ED25519");
      await account.createAccount(`dontcare.${DEFAULT_ACCOUNT_ID}`, newKeyPair.getPublicKey());

      const newAccount = new Account(
        "dontcare." + DEFAULT_ACCOUNT_ID,
        new JsonRpcProvider({ url: sandbox.rpcUrl }),
        new KeyPairSigner(newKeyPair)
      );
      await account.transfer({ receiverId: newAccount.accountId, amount: NEAR.toUnits(100) });

      expect((await newAccount.getState()).balance.total).toBe(NEAR.toUnits(100));
    } finally {
      // critical for Vitest: always release resources
      await expect(sandbox.tearDown()).resolves.not.toThrow();
    }

  });
});
