import { describe, expect, it } from "vitest";
import { savePresentation } from "./SaveStatus";

const base = { local: "saved" as const, cloud: "saved", account: true, role: "owner", tabReadOnly: false, pendingImages: 0, recovery: false };
describe("truthful save presentation", () => {
  it("distinguishes device/account and never hides pending images behind cloud acknowledgement", () => {
    expect(savePresentation({ ...base, account: false }).label).toBe("Saved on this device");
    expect(savePresentation(base).label).toBe("Saved to account");
    expect(savePresentation({ ...base, pendingImages: 1 }).label).toBe("1 image waiting to upload");
    expect(savePresentation({ ...base, local: "saving" }).label).toBe("Saving on this device…");
  });
  it("prioritizes durability, access, tab and conflict over uploads", () => {
    expect(savePresentation({ ...base, local: "error", cloud: "error", pendingImages: 2 }).label).toBe("Your changes haven’t been saved");
    expect(savePresentation({ ...base, local: "error", pendingImages: 2 }).label).toBe("Couldn’t save on this device");
    expect(savePresentation({ ...base, cloud: "conflict", pendingImages: 2 }).label).toBe("This board changed elsewhere");
    expect(savePresentation({ ...base, role: "none", pendingImages: 2 }).label).toBe("Access removed");
    expect(savePresentation({ ...base, tabReadOnly: true, local: "error" }).label).toBe("Editing in another tab");
    expect(savePresentation({ ...base, tabReadOnly: true, local: "error", localError: "Could not open IndexedDB" }).label).toBe("Couldn’t save on this device");
  });
  it("claims a device fallback only after confirmation", () => {
    expect(savePresentation({ ...base, cloud: "error" }).label).toContain("saved on this device");
    expect(savePresentation({ ...base, cloud: "error", local: "saving" }).label).not.toContain("saved on this device");
  });
});
