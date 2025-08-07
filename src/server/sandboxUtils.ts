import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as net from "net";
import { join } from "path";
import { tmpdir } from "os";
import { lock } from 'proper-lockfile';
import { SandboxErrors, TcpAndLockErrors, TypedError } from "../errors";
import got from "got";
import { initConfigsToTmpWithVersion, runWithArgsAndVersion } from "../binary/binaryExecution";
import { dir, DirectoryResult } from "tmp-promise";
import { ChildProcess } from "child_process";


const DEFAULT_RPC_HOST = '127.0.0.1';

function rpcSocket(port: number): string {
    return `${DEFAULT_RPC_HOST}:${port}`;
}

export async function acquireOrLockPort(port?: number): Promise<{ port: number; lockFilePath: string }> {
    return port
        ? tryAcquireSpecificPort(port)
        : acquireUnusedPort();
}

async function tryAcquireSpecificPort(port: number): Promise<{ port: number; lockFilePath: string }> {
    const checkedPort = await resolveAvailablePort({ port, host: DEFAULT_RPC_HOST });

    if (checkedPort !== port) {
        throw new TypedError(`Port ${port} is not available`, TcpAndLockErrors.PortNotAvailable);
    }

    const lockFilePath = await createLockFileForPort(port);

    try {
        await lock(lockFilePath);
        return { port, lockFilePath };
    } catch {
        throw new TypedError(`Failed to lock port ${port}. It may already be in use.`, TcpAndLockErrors.LockFailed);
    }
}

async function acquireUnusedPort(): Promise<{ port: number; lockFilePath: string }> {
    const errors: string[] = [];
    const MAX_ATTEMPTS = 10;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
        try {
            const port = await resolveAvailablePort({ port: 0, host: DEFAULT_RPC_HOST });
            const lockFilePath = await createLockFileForPort(port);
            await lock(lockFilePath);
            return { port, lockFilePath };
        } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    throw new TypedError(
        `Failed to acquire an unused port after ${MAX_ATTEMPTS} attempts`,
        TcpAndLockErrors.PortAcquisitionFailed,
        new Error(errors.map((msg, i) => `Attempt ${i + 1}: ${msg}`).join("\n"))
    );
}

// options takes the port and host, if port is 0 os will find an available port
async function resolveAvailablePort(options: net.ListenOptions): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', (err) => reject(err));

        server.listen(options, () => {
            const addr = server.address();

            if (typeof addr === 'object' && addr !== null && typeof addr.port === 'number') {
                const { port } = addr;
                server.close(() => resolve(port));
            } else {
                server.close();
                reject(new TypedError('Could not determine assigned port.', TcpAndLockErrors.PortAcquisitionFailed));
            }
        });
    });
}

async function createLockFileForPort(port: number): Promise<string> {
    const lockFilePath = join(tmpdir(), `near-sandbox-port-${port}.lock`);

    if (!existsSync(lockFilePath)) {
        await fs.writeFile(lockFilePath, '');
    }

    return lockFilePath;
}

export async function waitUntilReady(rpcUrl: string) {
    const timeoutSecs = parseInt(process.env["NEAR_RPC_TIMEOUT_SECS"] || '10');
    const attempts = timeoutSecs * 2;
    let lastError: unknown = null;
    for (let i = 0; i < attempts; i++) {
        try {
            const response = await got(`${rpcUrl}/status`, { throwHttpErrors: false });
            if (response.statusCode >= 200 && response.statusCode < 300) {
                return;
            }
        } catch (error) {
            lastError = error;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new TypedError("Sandbox failed to become ready within the timeout period.",
        SandboxErrors.RunFailed,
        lastError instanceof Error ? lastError : new Error(String(lastError))
    );
}

export async function getPorts(providedRpcPort?: number, providedNetPort?: number): Promise<{
    rpcAddr: string;
    netAddr: string;
    rpcPortLock: string;
    netPortLock: string;
}> {
    const { port: rpcPort, lockFilePath: rpcPortLock } = await acquireOrLockPort(providedRpcPort);
    const { port: netPort, lockFilePath: netPortLock } = await acquireOrLockPort(providedNetPort);

    return {
        rpcAddr: rpcSocket(rpcPort),
        netAddr: rpcSocket(netPort),
        rpcPortLock,
        netPortLock,
    };
}

export async function initConfigsWithVersion(version: string): Promise<DirectoryResult> {
    const tmpDir = await dir({ unsafeCleanup: true });
    await initConfigsToTmpWithVersion(version, tmpDir);
    return tmpDir;
}

export async function spawnSandbox(
    version: string,
    homeDir: string,
    rpcAddr: string,
    netAddr: string,
): Promise<{ rpcUrl: string, childProcess: ChildProcess }> {
    const options = ["--home", homeDir, "run", "--rpc-addr", rpcAddr, "--network-addr", netAddr];
    const childProcess = await runWithArgsAndVersion(version, options);
    const rpcUrl = `http://${rpcAddr}`;
    await waitUntilReady(rpcUrl);
    return { rpcUrl, childProcess };
}
