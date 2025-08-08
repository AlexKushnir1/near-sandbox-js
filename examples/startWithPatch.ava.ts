/**    
* This test demonstrates deploying contract on the created account in the sandbox,
* patching the sandbox state and rerun with the patched state.
 */
import test from "ava";
import { Sandbox } from "../src/server/Sandbox";
import { KeyPair } from "@near-js/crypto";
import { JsonRpcProvider } from "@near-js/providers";
import { readFileSync, existsSync } from "fs";
import { Account } from "@near-js/accounts";
import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY } from "../src/server/config";
import { KeyPairSigner } from "@near-js/signers";
import { join } from "path";

test('runing sandbox after patching state with deployed contract', async t => {
    let sandbox: Sandbox = await Sandbox.start({ config: { rpcPort: 3035 } });
    try {
        const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
        const rootAccount = new Account(
            DEFAULT_ACCOUNT_ID,
            provider,
            new KeyPairSigner(KeyPair.fromString(DEFAULT_PRIVATE_KEY))
        );
        const data = readFileSync("node_modules/near-hello/dist/main.wasm");

        const newSecretKey = KeyPair.fromRandom("ED25519");
        await rootAccount.createAccount("alice.sandbox", newSecretKey.getPublicKey(), BigInt(10e24));
        const newAccount = new Account(
            "alice.sandbox",
            provider,
            new KeyPairSigner(newSecretKey)
        );

        await new Promise(resolve => setTimeout(resolve, 3000)); // wait for the account to be created

        const result = await newAccount.deployContract(new Uint8Array(data));
        t.is(result.final_execution_status, "EXECUTED_OPTIMISTIC");
        await new Promise(resolve => setTimeout(resolve, 3000)); // wait for the contract to be deployed

        const response = (await provider.viewContractCode(newAccount.accountId)).code;
        t.deepEqual(response, new Uint8Array(data));
        await newAccount.callFunction({
            contractId: newAccount.accountId,
            methodName: "setValue",
            args: { value: "HARDCODED_VALUE" },
            gas: BigInt(3000000000000),
        });
        const state = await newAccount.viewFunction({
            contractId: newAccount.accountId,
            methodName: "getValue",
        });
        t.is("HARDCODED_VALUE", state);

        const pathToPatch = await sandbox.getState();
        await new Promise(resolve => setTimeout(resolve, 5000)); // wait for the process to finish
        await sandbox.tearDown();
        await new Promise(resolve => setTimeout(resolve, 5000)); // wait for the process to finish

        t.is(existsSync(join(pathToPatch, 'genesis.json')), true, "Genesis file should exist");
        t.is(existsSync(join(pathToPatch, "records.json")), true, "Records file should exist");
        const [genesisRaw, recordsRaw] = await Promise.all([
            readFileSync(join(pathToPatch, 'genesis.json'), 'utf-8'),
            readFileSync(join(pathToPatch, 'records.json'), 'utf-8')
        ]);

        const genesis = JSON.parse(genesisRaw);
        const records = JSON.parse(recordsRaw);
        // Ensure records field exists in genesis
        if (!Array.isArray(genesis.records)) {
            genesis.records = [];
        }

        // Append new records
        genesis.records.push(...records);
        console.log("Concatenated Genesis:", genesis);
        sandbox = await Sandbox.start({
            config: {
                rpcPort: 3035,
                additionalGenesis: genesis,
            },
        });

        const state2 = await provider.callFunction(newAccount.accountId, "getValue", {});
        t.is("HARDCODED_VALUE", state2);

    } catch (err) {
        console.error("Error during sandbox operations:", err);
        t.fail("Sandbox operations failed");
    }
    finally {
        await sandbox.tearDown();
    }

});