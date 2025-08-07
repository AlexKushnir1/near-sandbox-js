import { runWithArgsAndVersion } from "../binary/binaryExecution";
import { SandboxConfig, setSandboxConfig, setSandboxGenesis } from "./config";
import { ChildProcess } from "child_process";
import { getPorts, initConfigsWithVersion, spawnSandbox } from "./sandboxUtils";
import { unlock } from "proper-lockfile";
import { rm } from "fs/promises";
import { SandboxErrors, TypedError } from "../errors";
import { join } from "path";

export const DEFAULT_NEAR_SANDBOX_VERSION = "2.6.5";

interface StartParams {
    config?: SandboxConfig;
    version?: string;
}
/**
 * `Sandbox` provides an isolated, ephemeral NEAR blockchain environment for local testing.
 *
 * Internally, it wraps the execution of the `near-sandbox` binary with configuration options,
 * port locking, and lifecycle management. It ensures proper startup and teardown for reliable testing.
 *
 * @example
 * ```ts
 * import { Sandbox } from './sandbox';
 *
 * const sandbox = await Sandbox.start({
 *   config: {
 *     rpcPort: 3030,
 *     additionalGenesis: { epoch_length: 250 },
 *   }
 * });
 *
 * console.log('Sandbox running at', sandbox.rpcUrl);
 * // Use the sandbox...
 * await sandbox.tearDown(true); // Cleans up temp dir and releases ports
 * ```
 *
 * @property rpcUrl - The URL of the running sandbox's RPC endpoint.(e.g. "http://127.0.0.1:{port}")
 * @property homeDir - The path to the temporary home directory used by the sandbox.
 * This directory contains all the sandbox state, configuration and accounts keys.
 * @property rpcPortLockPath - Path to the lock file that prevents other processes from using the same RPC port until this sandbox is started.
 * @property netPortLockPath - Path to the lock file for the network port.
 */
export class Sandbox {
    public readonly rpcUrl: string;
    public readonly homeDir: string;
    public readonly rpcPortLockPath: string;
    public readonly netPortLockPath: string;
    private childProcess: ChildProcess;

    private constructor(rpcUrl: string, homeDir: string, childProcess: ChildProcess, rpcPortLock: string, netPortLock: string) {
        this.rpcUrl = rpcUrl;
        this.homeDir = homeDir;
        this.rpcPortLockPath = rpcPortLock;
        this.netPortLockPath = netPortLock;
        this.childProcess = childProcess;
    }

    /**
    * Launch a sandbox environment.
    *
    * Downloads the appropriate binary version (if not cached), locks two available ports (RPC & network),
    * generates a temporary home directory, and spawns the `neard-sandbox` binary with runtime args.
    *
    * @param params Configuration options:
    *   - `config` - Optional sandbox configuration like RPC port, additional genesis data, accounts etc.
    *   - `version` - Optional NEAR sandbox binary version.
    *
    * @returns A ready-to-use `Sandbox` instance with `.rpcUrl` and `.homeDir` available.
    *
    * @throws {TypedError} if the sandbox fails to start, ports cannot be locked, or config setup fails.
    */
    static async start(params: StartParams): Promise<Sandbox> {
        const config: SandboxConfig = params.config || {};
        const version: string = params.version || DEFAULT_NEAR_SANDBOX_VERSION;

        const homeDir = await initConfigsWithVersion(version);
        await setSandboxGenesis(homeDir.path, config);
        await setSandboxConfig(homeDir.path, config);
        const { rpcAddr, netAddr, rpcPortLock, netPortLock } = await getPorts(config.rpcPort, config.netPort);
        const { rpcUrl, childProcess } = await spawnSandbox(version, homeDir.path, rpcAddr, netAddr);
        return new Sandbox(rpcUrl, homeDir.path, childProcess, rpcPortLock, netPortLock);
    }

    static async startWithPatch(params: StartParams, pathToPatch: string): Promise<Sandbox> {
        const config: SandboxConfig = params.config || {};
        const version: string = params.version || DEFAULT_NEAR_SANDBOX_VERSION;

        const { rpcAddr, netAddr, rpcPortLock, netPortLock } = await getPorts(config.rpcPort, config.netPort);

        const { rpcUrl, childProcess } = await spawnSandbox(version, pathToPatch, rpcAddr, netAddr);
        return new Sandbox(rpcUrl, pathToPatch, childProcess, rpcPortLock, netPortLock);
    }

    async getState(): Promise<string> {
        await runWithArgsAndVersion("2.6.5", ["--home", this.homeDir, "view-state", "dump-state", "--stream"]);
        return join(this.homeDir, "output");
    }
    /**
     * Destroys the running sandbox environment by:
     * - Killing the child process
     * - Unlocking the previously locked ports
     * - Optionally cleaning up the home directory
     *
     * @param cleanup If true, deletes the sandbox’s temp home directory.
     *
     * @throws {TypedError} if cleanup or shutdown fails partially or completely.
     */
    async tearDown(cleanup: boolean = false): Promise<void> {
        const errors: Error[] = [];
        const success = this.childProcess.kill();

        if (!success) {
            errors.push(new Error("Failed to kill the child process"));
        }

        const unlockResults = await Promise.allSettled([
            unlock(this.rpcPortLockPath),
            unlock(this.netPortLockPath)
        ]);
        unlockResults.forEach(result => {
            if (result.status === 'rejected') {
                errors.push(new Error("Failed to unlock port: " + result.reason));
            }
        });

        if (cleanup) {
            await Promise.race([
                new Promise(resolve => this.childProcess.once('exit', resolve))
            ]);
            await rm(this.homeDir, { recursive: true, force: true }).catch(error => {
                errors.push(new Error(`Failed to remove sandbox home directory: ${error}`));
            });
        }
        if (errors.length > 0) {
            const combined = errors.map(e => `- ${e.message}`).join("\n");
            throw new TypedError(`Sandbox teardown encountered errors`,
                SandboxErrors.TearDownFailed,
                new Error(combined));
        }
    }
}
