"use strict";

/**
 * The only module in this tool that touches child_process.
 *
 * Keeping that a single chokepoint is the point: every command the tool runs
 * gets the same argv handling, the same error text, and the same timeout
 * behaviour, and there is exactly one file to audit when any of that is wrong.
 * Borrowed from syWatcher's src/core/commandRunner.js, minus the Ubuntu/sudo
 * parts this tool has no use for.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Layered onto process.env for every command.
 *
 * CI=1 is what stops npm from rendering progress bars and spinners into a
 * non-TTY pipe, where they arrive as megabytes of escape codes rather than
 * readable output.
 */
const NON_INTERACTIVE_ENV = {
  ...process.env,
  CI: "1",
};

// Commands are given as (command, argvArray) and spawned without a shell, so a
// path containing spaces or a filename containing ';' is data, not syntax.
// Every caller here passes user-supplied file paths, so that is load-bearing.
//
// Windows forces exactly one exception, below.
const WINDOWS_BATCH = /\.(cmd|bat)$/i;

/**
 * The filenames to probe on PATH for a given command, in priority order.
 *
 * On Windows a bare name must ONLY be probed with a PATHEXT extension, never
 * as-is. npm ships two files side by side: `npm` (a shell script for Git Bash)
 * and `npm.cmd` (the Windows shim). The extensionless one exists, and
 * fs.access(X_OK) accepts it because Windows has no execute bit -- so probing
 * the bare name first resolves npm to a shell script CreateProcess cannot
 * launch, and the spawn dies with ENOENT.
 *
 * A command that already carries an extension is probed exactly as given, so
 * "chrome.exe" is never mangled into "chrome.exe.EXE".
 *
 * Pure and platform-parameterised so it can be tested from any host.
 */
function executableCandidates(command, platform = process.platform, pathext = process.env.PATHEXT) {
  if (platform !== "win32") return [command];
  if (path.win32.extname(command)) return [command];
  return (pathext || ".COM;.EXE;.CMD;.BAT")
    .split(";")
    .filter(Boolean)
    .map((ext) => command + ext);
}

/**
 * Quotes a single argument for cmd.exe.
 *
 * Only used on the Windows batch path. cmd.exe escapes an embedded double
 * quote by doubling it, not with a backslash.
 */
function quoteForCmd(value) {
  const s = String(value);
  if (/^[A-Za-z0-9_\-.:\\/=+@]+$/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * The one place a shell is allowed, and only on Windows.
 *
 * Since Node 18.20.2 / 20.12.2 (CVE-2024-27980) spawn() refuses to execute a
 * .cmd or .bat directly and throws EINVAL unless shell:true. On Windows npm IS
 * npm.cmd, so this is the ordinary path there rather than an edge case --
 * without this, `md2pdf setup` cannot install anything on Windows at all.
 *
 * shell:true means node hands cmd.exe a single string and does no quoting of
 * its own, so the command and every argument are quoted here instead. The
 * default nodejs install path contains a space ("C:\Program Files\nodejs"),
 * which is precisely what would break if they were not.
 */
function prepareForPlatform(command, args) {
  if (process.platform === "win32" && WINDOWS_BATCH.test(command)) {
    return {
      command: quoteForCmd(command),
      args: args.map(quoteForCmd),
      shell: true,
    };
  }
  return { command, args, shell: false };
}

class CommandRunner {
  constructor(opts = {}) {
    this.env = opts.env ?? NON_INTERACTIVE_ENV;
    // 0 disables. A hung child otherwise hangs the whole tool with no output.
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 0;
  }

  /** Runs a command, streaming its output through. Resolves only on exit 0. */
  run(command, args = [], options = {}) {
    return this._spawn(command, args, options);
  }

  /** Runs a command and resolves with its stdout. */
  output(command, args = [], options = {}) {
    return this._spawnOutput(command, args, options);
  }

  /**
   * Resolves a command to an absolute path by walking PATH directly.
   *
   * Deliberately not `spawn("which")`: that would need a subprocess to answer a
   * question the filesystem can answer, and on Windows there is no `which` at
   * all. Returns null rather than throwing so callers can produce their own
   * message about what was actually being looked for.
   */
  which(command) {
    if (!command) return null;
    if (command.includes(path.sep) || command.includes("/")) {
      return this._isExecutable(command) ? path.resolve(command) : null;
    }

    const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
      for (const name of executableCandidates(command)) {
        const candidate = path.join(dir, name);
        if (this._isExecutable(candidate)) return candidate;
      }
    }
    return null;
  }

  /**
   * Picks the first usable binary from an explicit candidate list.
   *
   * An env override always wins and is validated rather than trusted, so a
   * typo'd override fails here with the path in the message instead of much
   * later as a confusing spawn ENOENT.
   */
  resolveBinary({ envVar, candidates = [], commands = [], label = "binary" }) {
    if (envVar && process.env[envVar]) {
      const override = process.env[envVar];
      if (!this._isExecutable(override)) {
        throw new Error(
          `${envVar} is set to "${override}", which is not an executable file.`
        );
      }
      return path.resolve(override);
    }
    for (const candidate of candidates) {
      if (this._isExecutable(candidate)) return candidate;
    }
    for (const command of commands) {
      const found = this.which(command);
      if (found) return found;
    }
    const hint = envVar
      ? process.platform === "win32"
        ? ` Set it explicitly, e.g.  set ${envVar}=C:\\path\\to\\chrome.exe`
        : ` Set it explicitly, e.g.  export ${envVar}=/path/to/${label}`
      : "";
    throw new Error(`Could not find ${label} on this machine.${hint}`);
  }

  _isExecutable(p) {
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) return false;
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  _spawn(command, args, options = {}) {
    const { timeoutMs = this.defaultTimeoutMs, ...spawnOptions } = options;
    const p = prepareForPlatform(command, args);
    return new Promise((resolve, reject) => {
      const child = spawn(p.command, p.args, {
        stdio: ["ignore", "inherit", "inherit"],
        env: this.env,
        ...spawnOptions,
        ...(p.shell ? { shell: true } : {}),
      });
      this._wire(child, command, args, timeoutMs, reject, () => resolve());
    });
  }

  /**
   * Runs a command and resolves with its stdout.
   *
   * `options.input` is written to stdin. Anything sensitive belongs there and
   * never in args: argv is readable by every user on the machine via `ps`.
   */
  _spawnOutput(command, args, options = {}) {
    const {
      input,
      timeoutMs = this.defaultTimeoutMs,
      ...spawnOptions
    } = options;

    const p = prepareForPlatform(command, args);
    return new Promise((resolve, reject) => {
      const child = spawn(p.command, p.args, {
        env: this.env,
        ...spawnOptions,
        ...(p.shell ? { shell: true } : {}),
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });

      if (input !== undefined) {
        // A command that exits before reading all of stdin raises EPIPE here.
        // That is not the failure worth reporting -- the exit code is.
        child.stdin.on("error", () => undefined);
        child.stdin.end(input);
      }

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));

      this._wire(child, command, args, timeoutMs, reject, () => resolve(stdout), () => stderr);
    });
  }

  /**
   * Shared exit/error/timeout handling.
   *
   * The timeout kills this child by its own handle. Never pkill/-f from here:
   * a pattern wide enough to match the child also matches the shell that
   * launched it, and killing your own process tree is a debugging afternoon.
   */
  _wire(child, command, args, timeoutMs, reject, onSuccess, getStderr = () => "") {
    let timer = null;
    let timedOut = false;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        // Escalate only if SIGTERM was ignored; the close handler clears this.
        setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      }, timeoutMs);
    }

    // Fires when the binary cannot be executed at all (ENOENT, EACCES). That is
    // a different failure from "ran and exited non-zero" and deserves its own
    // message -- conflating them sends you looking for a bug in a tool that
    // never started.
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`Failed to start "${command}": ${err.message}`));
    });

    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        return reject(
          new Error(`Command "${command} ${args.join(" ")}" timed out after ${timeoutMs}ms`)
        );
      }
      if (code === 0) return onSuccess();
      const stderr = getStderr();
      reject(
        new Error(
          `Command "${command} ${args.join(" ")}" exited with ` +
            `${signal ? `signal ${signal}` : `code ${code}`}` +
            `${stderr ? `: ${stderr.trim()}` : ""}`
        )
      );
    });
  }
}

/** Ergonomic surface over the runner; the rest of the tool talks to this. */
class CommandFacade {
  constructor(runner) {
    this.runner = runner;
  }

  runCommand(command, args = [], options = {}) {
    return this.runner.run(command, args, options);
  }

  runCommandOutput(command, args = [], options = {}) {
    return this.runner.output(command, args, options);
  }

  which(command) {
    return this.runner.which(command);
  }

  resolveBinary(spec) {
    return this.runner.resolveBinary(spec);
  }

  /**
   * Installs npm dependencies into a directory, and only when they are missing.
   *
   * `probe` is a file that exists once the install succeeded, so a half-finished
   * previous run does not read as "already installed". Re-running is a no-op,
   * which is what makes this safe to call on every invocation.
   */
  async ensureNodeDeps(dir, probe, { npm = "npm" } = {}) {
    if (fs.existsSync(probe)) return false;
    const npmBin = this.runner.which(npm);
    if (!npmBin) {
      throw new Error(
        `npm is required to install dependencies but was not found on PATH.`
      );
    }
    await this.runner.run(
      npmBin,
      ["install", "--no-audit", "--no-fund", "--loglevel=error"],
      { cwd: dir, timeoutMs: 300000 }
    );
    if (!fs.existsSync(probe)) {
      throw new Error(
        `npm install finished but ${probe} is still missing; dependencies are not usable.`
      );
    }
    return true;
  }
}

const cli = new CommandFacade(new CommandRunner());

module.exports = {
  CommandRunner,
  CommandFacade,
  cli,
  NON_INTERACTIVE_ENV,
  prepareForPlatform,
  quoteForCmd,
  executableCandidates,
};
