// Cloudinary upload signing. Files are uploaded directly from the client to
// Cloudinary's API (never routed through this server) — this just issues a
// short-lived signature so the client's upload request is authorized.
import { randomUUID } from "crypto";
import { v2 as cloudinary } from "cloudinary";
import { ENV } from "./_core/env";

cloudinary.config({
  cloud_name: ENV.cloudinaryCloudName,
  api_key: ENV.cloudinaryApiKey,
  api_secret: ENV.cloudinaryApiSecret,
  secure: true,
});

export type CloudinaryUploadSignature = {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  publicId: string;
  overwrite: boolean;
  allowedFormats: string;
  signature: string;
};

// Cloudinary has no signed-upload "max bytes" param outside of a dashboard
// upload preset, so this is the code-level abuse guard available to us:
// reject obviously-wrong file types up front instead of letting anything
// through to the video/upload endpoint.
const ALLOWED_VIDEO_FORMATS = "mp4,mov,m4v,webm,3gp,avi";

export function getCloudinaryUploadSignature(folder: string): CloudinaryUploadSignature {
  if (!ENV.cloudinaryCloudName || !ENV.cloudinaryApiKey || !ENV.cloudinaryApiSecret) {
    throw new Error(
      "Cloudinary config missing: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET",
    );
  }

  const timestamp = Math.round(Date.now() / 1000);
  // A per-request random public_id (pinned server-side, not left for the
  // client or Cloudinary to pick) plus overwrite:false means this signature
  // can only ever create exactly one new asset. Without that, a signature
  // is valid for an hour and -- since folder/allowed_formats don't pin an
  // exact target -- could otherwise be replayed to upload many different
  // files before it expires.
  const publicId = randomUUID();
  const overwrite = false;
  // Every param passed to the client's upload request that Cloudinary treats
  // as "to be signed" must appear here too, or the signature won't match.
  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder, public_id: publicId, overwrite, allowed_formats: ALLOWED_VIDEO_FORMATS },
    ENV.cloudinaryApiSecret,
  );

  return {
    cloudName: ENV.cloudinaryCloudName,
    apiKey: ENV.cloudinaryApiKey,
    timestamp,
    folder,
    publicId,
    overwrite,
    allowedFormats: ALLOWED_VIDEO_FORMATS,
    signature,
  };
}

// Elimination videos are submitted to elimination.submit as a bare URL
// string (the file itself never touches this server), so before trusting
// it we confirm it actually points at a video Cloudinary hosts under our
// account, in the exact per-game folder we issued a signature for --
// rather than, say, an arbitrary attacker-controlled HTTPS URL, or another
// game's evidence video.
export function isValidEliminationVideoUrl(videoUrl: string, gameId: number): boolean {
  if (!ENV.cloudinaryCloudName) return false;
  let url: URL;
  try {
    url = new URL(videoUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hostname !== "res.cloudinary.com") return false;

  const expectedPrefix = `/${ENV.cloudinaryCloudName}/video/upload/`;
  if (!url.pathname.startsWith(expectedPrefix)) return false;

  // Cloudinary secure_urls normally include a "v<timestamp>/" version
  // segment before the folder path, but it's not guaranteed, so strip it
  // if present rather than requiring it.
  const afterUpload = url.pathname.slice(expectedPrefix.length).replace(/^v\d+\//, "");
  return afterUpload.startsWith(`eliminations/${gameId}/`);
}
