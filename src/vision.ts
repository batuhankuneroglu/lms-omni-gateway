import { open } from "node:fs/promises";
import { isAbsolute, win32 } from "node:path";
import type { Model } from "./providers";

/** Prefer explicit API metadata; never infer vision from an unfamiliar model name. */
export function imageCapability(provider: string, id: string, row?: any): Pick<Model, "imageInput" | "capabilitySource"> {
  const modalities = row?.architecture?.input_modalities ?? row?.input_modalities;
  if (Array.isArray(modalities) && modalities.every((value: unknown) => typeof value === "string")) {
    return { imageInput: modalities.includes("image"), capabilitySource: "Models API" };
  }
  if (typeof row?.capabilities?.vision === "boolean") return { imageInput: row.capabilities.vision, capabilitySource: "Models API" };
  // Exact aliases verified in DeepSeek's official pricing and vision docs, 2026-09-24.
  if (provider === "deepseek" && ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro"].includes(id)) {
    return { imageInput: id !== "deepseek-v4-pro", capabilitySource: "DeepSeek docs · 2026-09-24" };
  }
  if (provider === "nvidia" && id === "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning") {
    return { imageInput: true, capabilitySource: "NVIDIA model page · 2026-09-27" };
  }
  return {};
}

export function parseImageCommand(text: string): { path: string; prompt: string } | undefined {
  if (!/^\/image(?:\s|$)/i.test(text.trim())) return;
  const match = text.trim().match(/^\/image\s+(?:"([^"\r\n]+)"|'([^'\r\n]+)'|(\S+))(?:\s+([\s\S]*))?$/i);
  if (!match) throw new Error('Use /image "C:\\path\\photo.png" Your question');
  return { path: match[1] || match[2] || match[3], prompt: match[4]?.trim() || "Describe this image." };
}

export async function imageDataURL(path: string): Promise<string> {
  // Read only the explicit local path. No URLs, network shares, device paths or
  // alternate data streams. File contents determine the MIME type.
  if ((!isAbsolute(path) && !win32.isAbsolute(path)) || /^[\\/]{2}/.test(path)
    || /[\x00-\x1f]/.test(path) || path.slice(2).includes(":")) throw new Error("Choose an absolute local image path.");
  let file;
  try { file = await open(path, "r"); } catch { throw new Error("Unable to open the image. Check its local file path."); }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error("Choose an image file smaller than 20 MB.");
    const bytes = await file.readFile();
    if (bytes.length > 20 * 1024 * 1024) throw new Error("Choose an image file smaller than 20 MB.");
    const hex = bytes.subarray(0, 12).toString("hex");
    const mime = hex.startsWith("89504e470d0a1a0a") ? "image/png"
      : hex.startsWith("ffd8ff") ? "image/jpeg"
      : bytes.subarray(0, 6).toString() === "GIF89a" || bytes.subarray(0, 6).toString() === "GIF87a" ? "image/gif"
      : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : undefined;
    if (!mime) throw new Error("Choose a PNG, JPEG, GIF or WebP image.");
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } finally { await file.close(); }
}
