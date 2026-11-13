import { isNative, nativeSave } from "./native";

/**
 * Offers data as a download. The link must be in the document for Firefox, and the blob URL must
 * live until the browser has started the download (freed after a minute, not right after click()).
 */
export function saveFile(data: BlobPart, name: string, type = "application/octet-stream") {
  if (isNative()) {  // desktop app: the native "save as" dialog writes the file
    new Blob([data]).arrayBuffer().then((b) => nativeSave(new Uint8Array(b), name)).catch((e) => alert(`Speichern fehlgeschlagen: ${e}`));
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
