import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");

// Determine the virtual environment Python path
const isWin = process.platform === "win32";
const venvPythonWin = path.join(backendDir, ".venv", "Scripts", "python.exe");
const venvPythonUnix = path.join(backendDir, ".venv", "bin", "python");

let pythonBin = "python";
if (isWin && fs.existsSync(venvPythonWin)) {
  pythonBin = venvPythonWin;
} else if (!isWin && fs.existsSync(venvPythonUnix)) {
  pythonBin = venvPythonUnix;
}

console.log(`[backend] Starting Django with: ${pythonBin}`);

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(pythonBin, ["manage.py", ...args], {
      cwd: backendDir,
      stdio: "inherit",
    });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`manage.py ${args[0]} exited with ${code}`)),
    );
  });
}

// Apply pending migrations before serving. Skipping this is what turns a fresh
// `git pull` into a screen full of 500s: the code queries columns that the
// checked-out migrations have not created yet.
const check = spawn(pythonBin, ["manage.py", "migrate", "--check"], {
  cwd: backendDir,
  stdio: "ignore",
});

check.on("exit", (code) => {
  if (code === 0) return start();
  console.log("[backend] Pending migrations detected, applying...");
  run(["migrate", "--noinput"])
    .then(start)
    .catch((err) => {
      console.error(`[backend] migrate failed: ${err.message}`);
      process.exit(1);
    });
});

check.on("error", () => start());

function start() {
  const child = spawn(pythonBin, ["manage.py", "runserver", "8000"], {
    cwd: backendDir,
    stdio: "inherit",
  });

  // A dev-only convenience: if Django dies, say so and exit non-zero so
  // `concurrently` can report it, rather than hanging on a dead backend that
  // only shows up in the browser as ERR_CONNECTION_REFUSED.
  child.on("exit", (code, signal) => {
    console.error(`[backend] runserver exited (code=${code} signal=${signal})`);
    process.exit(code ?? 1);
  });
}
