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

const child = spawn(pythonBin, ["manage.py", "runserver", "8000"], {
  cwd: backendDir,
  stdio: "inherit",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
