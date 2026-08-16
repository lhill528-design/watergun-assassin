export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  clerkSecretKey: process.env.CLERK_SECRET_KEY ?? "",
  ownerClerkId: process.env.OWNER_CLERK_ID ?? "",
  // Origins/app IDs allowed in a session token's `azp` claim, so a token
  // minted for a different application on the same Clerk instance can't be
  // replayed against this API. See https://clerk.com/docs/references/backend/authenticate-request
  clerkAuthorizedParties: (process.env.CLERK_AUTHORIZED_PARTIES ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean),
  isProduction: process.env.NODE_ENV === "production",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
};
