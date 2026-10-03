import { spawn } from "node:child_process";
import { join } from "node:path";

const powershell = () => join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
function desktopEnvironment() {
  const allowed = new Set(["HOMEDRIVE", "HOMEPATH", "PATH", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERDOMAIN", "USERNAME", "USERPROFILE", "WINDIR", "APPDATA", "LOCALAPPDATA", "COMSPEC", "HOME", "LANG"]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
}

/** Opens a picker only on an explicit /image command; it does not upload a file. */
export async function chooseImage(signal?: AbortSignal): Promise<string | undefined> {
  if (process.platform !== "win32") throw new Error('Use /image followed by the quoted absolute path of an existing image.');
  if (signal?.aborted) return;
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$picker=New-Object System.Windows.Forms.OpenFileDialog",
    "$picker.Title='Choose an image for LM Studio'",
    "$picker.Filter='Images (*.png;*.jpg;*.jpeg;*.webp;*.gif)|*.png;*.jpg;*.jpeg;*.webp;*.gif'",
    "$picker.CheckFileExists=$true",
    "$owner=New-Object System.Windows.Forms.Form",
    "$owner.TopMost=$true; $owner.ShowInTaskbar=$false; $owner.Opacity=0",
    "$owner.Show(); $owner.Activate()",
    "try { if ($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($picker.FileName))) } } finally { $picker.Dispose(); $owner.Dispose() }",
  ].join("; ");
  return new Promise((resolve, reject) => {
    const child = spawn(powershell(), ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-Command", script], {
      env: desktopEnvironment(), windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    const cancel = () => { child.kill(); resolve(undefined); };
    const timer = setTimeout(cancel, 5 * 60_000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    signal?.addEventListener("abort", cancel, { once: true });
    child.stdout?.on("data", chunk => { output += chunk.toString(); if (output.length > 20_000) cancel(); });
    child.once("error", () => { cleanup(); reject(new Error("The image picker could not open.")); });
    child.once("exit", code => {
      cleanup();
      if (signal?.aborted) { resolve(undefined); return; }
      if (code !== 0) { reject(new Error("The image picker could not open. Use the full path of an existing image.")); return; }
      resolve(output.trim() ? Buffer.from(output.trim(), "base64").toString("utf8") : undefined);
    });
  });
}
