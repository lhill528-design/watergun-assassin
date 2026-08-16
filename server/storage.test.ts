import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v2 as cloudinary } from "cloudinary";

const TEST_CLOUD_NAME = "test-cloud";
const TEST_API_KEY = "test-key";
const TEST_API_SECRET = "test-secret";

describe("storage: elimination video validation & upload signing", () => {
  let getCloudinaryUploadSignature: typeof import("./storage").getCloudinaryUploadSignature;
  let isValidEliminationVideoUrl: typeof import("./storage").isValidEliminationVideoUrl;
  const originalEnv = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };

  beforeAll(async () => {
    // env.ts reads process.env at module-load time, so these must be set
    // before storage.ts is first imported.
    process.env.CLOUDINARY_CLOUD_NAME = TEST_CLOUD_NAME;
    process.env.CLOUDINARY_API_KEY = TEST_API_KEY;
    process.env.CLOUDINARY_API_SECRET = TEST_API_SECRET;
    const mod = await import("./storage");
    getCloudinaryUploadSignature = mod.getCloudinaryUploadSignature;
    isValidEliminationVideoUrl = mod.isValidEliminationVideoUrl;
  });

  afterAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = originalEnv.CLOUDINARY_CLOUD_NAME;
    process.env.CLOUDINARY_API_KEY = originalEnv.CLOUDINARY_API_KEY;
    process.env.CLOUDINARY_API_SECRET = originalEnv.CLOUDINARY_API_SECRET;
  });

  describe("isValidEliminationVideoUrl", () => {
    it("accepts a real Cloudinary video URL in the matching game's folder", () => {
      expect(
        isValidEliminationVideoUrl(
          "https://res.cloudinary.com/test-cloud/video/upload/v1699999999/eliminations/42/abc123.mp4",
          42,
        ),
      ).toBe(true);
    });

    it("accepts a URL without the version segment too", () => {
      expect(
        isValidEliminationVideoUrl(
          "https://res.cloudinary.com/test-cloud/video/upload/eliminations/42/abc123.mp4",
          42,
        ),
      ).toBe(true);
    });

    it("rejects a non-HTTPS URL", () => {
      expect(
        isValidEliminationVideoUrl(
          "http://res.cloudinary.com/test-cloud/video/upload/eliminations/42/abc123.mp4",
          42,
        ),
      ).toBe(false);
    });

    it("rejects a URL not hosted on Cloudinary", () => {
      expect(
        isValidEliminationVideoUrl(
          "https://evil.example.com/test-cloud/video/upload/eliminations/42/abc123.mp4",
          42,
        ),
      ).toBe(false);
    });

    it("rejects a different Cloudinary account's cloud name", () => {
      expect(
        isValidEliminationVideoUrl(
          "https://res.cloudinary.com/someone-elses-cloud/video/upload/eliminations/42/abc123.mp4",
          42,
        ),
      ).toBe(false);
    });

    it("rejects a video uploaded under a different game's folder", () => {
      expect(
        isValidEliminationVideoUrl(
          "https://res.cloudinary.com/test-cloud/video/upload/v1699999999/eliminations/7/abc123.mp4",
          42,
        ),
      ).toBe(false);
    });

    it("rejects a non-video resource type", () => {
      expect(
        isValidEliminationVideoUrl(
          "https://res.cloudinary.com/test-cloud/image/upload/v1699999999/eliminations/42/abc123.jpg",
          42,
        ),
      ).toBe(false);
    });

    it("rejects a malformed URL", () => {
      expect(isValidEliminationVideoUrl("not-a-url", 42)).toBe(false);
    });
  });

  describe("getCloudinaryUploadSignature", () => {
    it("issues a fresh random public_id and overwrite:false on every call", () => {
      const a = getCloudinaryUploadSignature("eliminations/42");
      const b = getCloudinaryUploadSignature("eliminations/42");
      expect(a.publicId).toBeTruthy();
      expect(a.publicId).not.toEqual(b.publicId);
      expect(a.overwrite).toBe(false);
      expect(b.overwrite).toBe(false);
    });

    it("signs exactly the params the client is expected to submit", () => {
      const sig = getCloudinaryUploadSignature("eliminations/42");
      const expectedSignature = cloudinary.utils.api_sign_request(
        {
          timestamp: sig.timestamp,
          folder: sig.folder,
          public_id: sig.publicId,
          overwrite: sig.overwrite,
          allowed_formats: sig.allowedFormats,
        },
        TEST_API_SECRET,
      );
      expect(sig.signature).toBe(expectedSignature);
    });

    it("produces a signature that no longer matches if the public_id is swapped", () => {
      const sig = getCloudinaryUploadSignature("eliminations/42");
      const tamperedSignature = cloudinary.utils.api_sign_request(
        {
          timestamp: sig.timestamp,
          folder: sig.folder,
          public_id: "attacker-chosen-id",
          overwrite: sig.overwrite,
          allowed_formats: sig.allowedFormats,
        },
        TEST_API_SECRET,
      );
      expect(sig.signature).not.toBe(tamperedSignature);
    });
  });
});
