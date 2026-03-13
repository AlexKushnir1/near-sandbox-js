import { it, expect } from 'vitest';
import * as net from 'net';
import { existsSync } from "fs";
import { Sandbox } from '../src/sandbox/Sandbox.js';
import { GenesisAccount, SandboxConfig } from '../src/sandbox/config.js';
import { join } from 'path';
import got from 'got';
import { KeyPair } from '@near-js/crypto';

it.concurrent('Sandbox.start() returns a valid instance with default config and version', async () => {
    const sandbox = await Sandbox.start({});

    try {
        expect(sandbox).toBeTruthy();
        expect(typeof sandbox.rpcUrl).toBe('string');
        expect(typeof sandbox.homeDir).toBe('string');

        expect(existsSync(join(sandbox.homeDir, 'config.json'))).toBe(true);
        expect(existsSync(join(sandbox.homeDir, 'genesis.json'))).toBe(true);
        expect(existsSync(join(sandbox.homeDir, 'sandbox.json'))).toBe(true);
        expect(existsSync(sandbox.rpcPortLockPath)).toBe(true);
    } finally {
        await expect(sandbox.tearDown()).resolves.not.toThrow();
    }
});

it.concurrent('Sandbox.start() accepts custom config and version', async () => {
    const rpcPort = 3030;
    const newKeyPair = KeyPair.fromRandom("ED25519");
    const customConfig: SandboxConfig = {
        rpcPort: rpcPort,
        additionalGenesis: {
            epoch_length: 100, maxOpenFiles: 100
        },
        additionalAccounts: [
            new GenesisAccount(
                'test-account',
                newKeyPair.getPublicKey().toString(),
                newKeyPair.toString(),
                BigInt(10000000000000),
            ),
        ],
    };
    const sandbox = await Sandbox.start({ config: customConfig, version: '2.9.0' });

    try {
        expect(sandbox).toBeTruthy();
        expect(sandbox.rpcUrl).toBe(`http://127.0.0.1:${rpcPort}`);
    } finally {
        await expect(sandbox.tearDown()).resolves.not.toThrow();
    }
});

it.concurrent('Sandbox throws if provided version is unsupported', async () => {
    const unsupportedVersion = '14.0.0';
    await expect(
        Sandbox.start({ version: unsupportedVersion })
    ).rejects.toThrow(/Failed to download binary. Check Url and version/);
});

it.concurrent('Sandbox.tearDown() cleans up resources and unlocks ports', async () => {
    const server = net.createServer();
    const rpcPort = 3040;
    const sandbox = await Sandbox.start({ config: { rpcPort } });

    try {
        expect(existsSync(sandbox.homeDir)).toBe(true);

        // Sandbox RPC is alive
        const response = await got(`${sandbox.rpcUrl}/status`);
        expect(response.statusCode).toBe(200);

        // Now try to bind to the same port - should fail since sandbox is using it
        await expect(
            new Promise<void>((resolve, reject) => {
                server.once('error', err => {
                    server.close();
                    reject(err);
                });

                server.listen(rpcPort, '127.0.0.1', () => {
                    server.close(() => resolve());
                });
            })
        ).rejects.toThrow(/EADDRINUSE/);
    } finally {
        await expect(sandbox.tearDown()).resolves.not.toThrow();
    }

    await expect(
        new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(rpcPort, () => {
                server.close(() => resolve());
            });
        })
    ).resolves.not.toThrow();

    expect(existsSync(sandbox.homeDir)).toBe(false);
});

it.concurrent('Sandbox.rpcUrl is not reachable after stoppage', async () => {
    const sandbox = await Sandbox.start({});
    const rpcUrl = sandbox.rpcUrl;

    await expect(sandbox.tearDown()).resolves.not.toThrow();
    await expect(
        got(`${rpcUrl}/status`, { throwHttpErrors: false })
    ).rejects.toThrow(/ECONNREFUSED/);
});

it.concurrent('Sandbox throws if provided rpcPort is already in use', async () => {
    const rpcPort = 3050;
    const server = net.createServer();

    // Wait for server to start listening
    await new Promise<void>((resolve) => {
        server.listen(rpcPort, '127.0.0.1', () => resolve());
    });

    try {
        await expect(
            Sandbox.start({ config: { rpcPort } })
        ).rejects.toThrow(/EADDRINUSE/);
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
