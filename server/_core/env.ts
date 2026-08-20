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
  // Browser origins allowed to call this API (see server/_core/index.ts).
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  isProduction: process.env.NODE_ENV === "production",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  // Address search backend. Defaults to the public OpenStreetMap Nominatim
  // instance -- see server/geocoding.ts for the usage-policy constraints
  // (throttling, caching, User-Agent) this app follows against it. Only
  // worth overriding if this deployment switches to a different/paid
  // geocoding provider later.
  geocodingBaseUrl: process.env.GEOCODING_BASE_URL || "https://nominatim.openstreetmap.org",
  // Optional contact string (e.g. an email) appended to the outbound
  // User-Agent, as Nominatim's usage policy recommends so they can reach
  // out before blocking a misbehaving client instead of blocking silently.
  geocodingContact: process.env.GEOCODING_CONTACT ?? "",
  // Referer sent with every outbound Nominatim request, per their usage
  // policy. Defaults to this app's actual production site -- never point
  // this at a domain the app doesn't control.
  geocodingReferer: process.env.GEOCODING_REFERER || "https://watergun-assassin.vercel.app/",
};
