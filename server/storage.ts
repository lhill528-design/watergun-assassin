// Cloudinary upload signing. Files are uploaded directly from the client to
// Cloudinary's API (never routed through this server) — this just issues a
// short-lived signature so the client's upload request is authorized.
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
  signature: string;
};

export function getCloudinaryUploadSignature(folder: string): CloudinaryUploadSignature {
  if (!ENV.cloudinaryCloudName || !ENV.cloudinaryApiKey || !ENV.cloudinaryApiSecret) {
    throw new Error(
      "Cloudinary config missing: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET",
    );
  }

  const timestamp = Math.round(Date.now() / 1000);
  // Every param passed to the client's upload request that Cloudinary treats
  // as "to be signed" must appear here too, or the signature won't match.
  const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, ENV.cloudinaryApiSecret);

  return {
    cloudName: ENV.cloudinaryCloudName,
    apiKey: ENV.cloudinaryApiKey,
    timestamp,
    folder,
    signature,
  };
}
