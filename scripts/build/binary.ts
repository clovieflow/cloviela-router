/**
 * Compiles the standalone gateway binary from the AOT build output.
 *
 * Two things here are load-bearing and neither is obvious:
 *
 * 1. **The entry is `dist/main.js`, not `src/main.ts`.** `aot.ts` runs
 *    Elysia's AOT plugin, which rewrites TypeBox imports into statically wired
 *    mirrors in its output. Bundling the raw source instead discards that work,
 *    and Elysia's CommonJS build reaches TypeBox through a lazy
 *    `require("typebox/type")` that the bundler cannot follow — the compiled
 *    binary then dies at startup with `Cannot find module 'typebox/type'`,
 *    because a standalone executable has no node_modules to resolve against.
 *
 * 2. **`NODE_ENV` is set to `production` here, at build time, because Bun bakes
 *    it into the binary.** `bun build --compile` replaces `process.env.NODE_ENV`
 *    with a literal, so the value present when this runs is the value the
 *    binary reports forever after — a runtime `NODE_ENV=production` cannot
 *    change it. What depends on it is the logger: the `pino-pretty` transport
 *    is attached only in development, and that transport spawns a worker thread
 *    loading `real-require`, which a standalone executable does not carry. A
 *    binary built without this line therefore bundles a logger that crashes on
 *    first use. The migrations folder is not part of this decision —
 *    `resolveMigrationsFolder()` resolves `<cwd>/migrations` unconditionally.
 *
 * Usage: `bun run scripts/build/binary.ts [--outfile dist/cloviela-router]`
 */
import { join } from "node:path";

const DEFAULT_OUTFILE = "dist/cloviela-router";

/**
 * Where PGlite ships the runtime assets the embedded backend loads by name.
 * Resolved from the repository root so the build works from any cwd.
 */
const PGLITE_DIST = join(import.meta.dir, "..", "..", "node_modules", "@electric-sql", "pglite", "dist");

/**
 * The artifact path `bun build --compile` actually writes for `outfile`.
 *
 * Bun appends `.exe` when it compiles for Windows, so the extensionless
 * `dist/cloviela-router` handed to it never exists on that platform. This is the one
 * place that knows where the compiled binary lands; `start-production.ts`
 * resolves its target from here instead of re-deriving the name, because a
 * launcher that probed the requested path reported "run bun run build first"
 * immediately after a successful build.
 */
export function compiledBinaryPath(outfile: string = DEFAULT_OUTFILE): string {
  return process.platform === "win32" && !outfile.toLowerCase().endsWith(".exe")
    ? `${outfile}.exe`
    : outfile;
}

/** Reads `--outfile <path>`, falling back to a positional path or the default. */
export function resolveOutfile(argv: readonly string[]): string {
  const flag = argv.indexOf("--outfile");
  if (flag !== -1) {
    const value = argv[flag + 1];
    if (value === undefined || value.length === 0) {
      throw new Error("--outfile requires a path");
    }
    return value;
  }
  return argv.find((arg) => arg.length > 0 && !arg.startsWith("-")) ?? DEFAULT_OUTFILE;
}

export async function buildBinary(
  outfile: string = DEFAULT_OUTFILE,
  buildFn: typeof Bun.build = Bun.build,
): Promise<void> {
  // Baked into the output; see the note above before changing it. Substituted
  // through `define` rather than by assigning `process.env`, because this module
  // is imported by tests in the same process — mutating the environment would
  // flip `NODE_ENV` for every later suite in that process.
  const result = await buildFn({
    entrypoints: ["dist/main.js"],
    minify: true,
    target: "bun",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    compile: {
      outfile,
      // Lite mode runs embedded PGlite, whose WASM and data files are loaded at
      // runtime through `new URL("pglite.data", import.meta.url)` — a path a
      // standalone executable cannot resolve on its own. Without embedding them
      // boot dies with `ENOENT: open '/$bunfs/root/pglite.data'`. Bun preserves
      // each asset's basename, which is exactly the name PGlite asks for, so the
      // files are embedded under their own names rather than a nested path.
      assets: [
        join(PGLITE_DIST, "pglite.data"),
        join(PGLITE_DIST, "pglite.wasm"),
        join(PGLITE_DIST, "initdb.wasm"),
      ],
    },
  });

  if (result.logs.length > 0) {
    for (const log of result.logs) console.error(`[binary] ${log.message}`);
    throw new Error(`binary build emitted ${result.logs.length} diagnostic(s)`);
  }
  await signCompiledBinary(compiledBinaryPath(outfile));
  console.log(`[binary] compiled ${compiledBinaryPath(outfile)}`);
}

/**
 * Re-signs the compiled executable on macOS.
 *
 * `bun build --compile` writes the file in place after the linker has already
 * ad-hoc signed it, which leaves the signature describing bytes that no longer
 * match. macOS then kills the process on first execution with
 * `SIGKILL (Code Signature Invalid)` and no stderr output at all — the binary
 * looks like it exits silently. Re-signing ad-hoc restores a valid signature.
 */
async function signCompiledBinary(path: string): Promise<void> {
  if (process.platform !== "darwin") return;
  const proc = Bun.spawn(["codesign", "--force", "--sign", "-", path], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) {
    throw new Error(`codesign failed for ${path}: ${stderr.trim()}`);
  }
}

if (import.meta.main) {
  await buildBinary(resolveOutfile(process.argv.slice(2))).catch((error: unknown) => {
    console.error("[binary] build failed:", error);
    process.exit(1);
  });
}
