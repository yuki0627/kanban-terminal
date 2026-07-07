import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import path from "node:path";

// Native picker dialogs whose stdout is the selection's absolute path(s),
// newline-separated. Browsers can't hand the terminal a real filesystem path,
// but the local server can ask the OS. Fixed command + literal argv (the prompt
// is a constant) — no shell, no input interpolation.
const PICK_PROMPT = "Select file(s)";
const PICK_DIR_PROMPT = "Select project folder";

export function pickFileCommand(platform: NodeJS.Platform): { cmd: string; args: string[] } {
  if (platform === "darwin")
    return {
      cmd: "osascript",
      args: [
        "-e",
        `set chosen to choose file with prompt "${PICK_PROMPT}" with multiple selections allowed`,
        "-e",
        "set text item delimiters to linefeed",
        "-e",
        "set out to {}",
        "-e",
        "repeat with f in chosen",
        "-e",
        "set end of out to POSIX path of f",
        "-e",
        "end repeat",
        "-e",
        "return out as text",
      ],
    };
  if (platform === "win32")
    return {
      cmd: "powershell",
      args: [
        "-NoProfile",
        "-STA",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect = $true; if ($d.ShowDialog() -eq 'OK') { $d.FileNames -join \"`n\" }",
      ],
    };
  return { cmd: "zenity", args: ["--file-selection", "--multiple", "--separator=\n", `--title=${PICK_PROMPT}`] };
}

export function pickDirectoryCommand(platform: NodeJS.Platform): { cmd: string; args: string[] } {
  if (platform === "darwin")
    return {
      cmd: "osascript",
      args: ["-e", `POSIX path of (choose folder with prompt "${PICK_DIR_PROMPT}")`],
    };
  if (platform === "win32")
    return {
      cmd: "powershell",
      args: [
        "-NoProfile",
        "-STA",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }",
      ],
    };
  return { cmd: "zenity", args: ["--file-selection", "--directory", `--title=${PICK_DIR_PROMPT}`] };
}

export function parsePickerOutput(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && path.isAbsolute(line));
}

interface PickFileOptions {
  isAllowedOrigin: (origin?: string) => boolean;
}

// POST /api/pick-file — open the OS file dialog and return the chosen absolute
// path(s). A user cancel yields empty stdout, so the response is { paths: [] }.
// Same-origin guarded like the other local-action routes.
export function mountPickFileRoute(app: Express, { isAllowedOrigin }: PickFileOptions) {
  app.post("/api/pick-file", (req: Request, res) => {
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });
    const { cmd, args } = pickFileCommand(process.platform);
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.on("error", (e) => {
      if (!res.headersSent) res.status(500).json({ error: `file dialog unavailable: ${e.message}` });
    });
    child.on("close", () => {
      if (!res.headersSent) res.json({ paths: parsePickerOutput(Buffer.concat(out).toString()) });
    });
  });
}

export function mountPickDirectoryRoute(app: Express, { isAllowedOrigin }: PickFileOptions) {
  app.post("/api/pick-directory", (req: Request, res) => {
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });
    const { cmd, args } = pickDirectoryCommand(process.platform);
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.on("error", (e) => {
      if (!res.headersSent) res.status(500).json({ error: `directory dialog unavailable: ${e.message}` });
    });
    child.on("close", () => {
      if (!res.headersSent) res.json({ paths: parsePickerOutput(Buffer.concat(out).toString()).slice(0, 1) });
    });
  });
}
