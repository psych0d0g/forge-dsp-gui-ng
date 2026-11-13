import { describe, expect, it, vi } from "vitest";
import { saveFile } from "../../src/lib/saveFile";

describe("saveFile", () => {
  it("clicks a link that is in the document and keeps the blob URL alive", () => {
    const revoked: string[] = [];
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => { revoked.push(u); });
    let inDoc = false, name = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      inDoc = document.body.contains(this);
      name = this.download;
    });
    vi.useFakeTimers();
    saveFile(new Uint8Array([1, 2, 3]), "forge-flash.bin");
    expect(inDoc).toBe(true);                 // Firefox ignores click() on a detached link
    expect(name).toBe("forge-flash.bin");
    expect(revoked).toEqual([]);              // not freed before the download started
    vi.advanceTimersByTime(60_000);
    expect(revoked.length).toBe(1);
    expect(document.querySelectorAll("a").length).toBe(0);
    vi.useRealTimers();
    click.mockRestore();
    revoke.mockRestore();
  });
});
