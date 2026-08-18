import { describe, expect, it } from "vitest";
import { buildPoolOptions, parseDatabaseUrl } from "./db";

// Fixture credentials only -- not real, and nothing here ever opens a
// socket. This exercises parsing/config logic in isolation, the way
// TiDB's actual "plain mysql2 fails, explicit TLS succeeds" diagnosis
// showed the driver-level config -- not the schema or query logic -- was
// the problem.
const FIXTURE_URL = "mysql://demo_user:s3cret-pass@gateway01.example.com:4000/watergun";

describe("parseDatabaseUrl", () => {
  it("preserves host, port, decoded credentials, and the database name", () => {
    expect(parseDatabaseUrl(FIXTURE_URL)).toEqual({
      host: "gateway01.example.com",
      port: 4000,
      user: "demo_user",
      password: "s3cret-pass",
      database: "watergun",
    });
  });

  it("decodes percent-encoded characters in the username and password", () => {
    // A password containing '@', ':', or '/' must be percent-encoded to
    // appear in a URL at all -- parsing must undo that, not pass the
    // still-encoded literal through to mysql2.
    const encoded = "mysql://demo%40user:p%40ss%2Fw0rd@gateway01.example.com:4000/watergun";
    const config = parseDatabaseUrl(encoded);
    expect(config.user).toBe("demo@user");
    expect(config.password).toBe("p@ss/w0rd");
  });

  it("defaults to port 3306 when the URL omits a port", () => {
    const config = parseDatabaseUrl("mysql://demo_user:s3cret-pass@gateway01.example.com/watergun");
    expect(config.port).toBe(3306);
  });

  it("rejects a URL with no database name rather than silently connecting to none", () => {
    expect(() => parseDatabaseUrl("mysql://demo_user:s3cret-pass@gateway01.example.com:4000/")).toThrow(
      "DATABASE_URL is missing a database name",
    );
  });
});

describe("buildPoolOptions", () => {
  it("configures TLS explicitly, matching the config confirmed to work against TiDB", () => {
    const options = buildPoolOptions(FIXTURE_URL);
    expect(options.ssl).toEqual({ minVersion: "TLSv1.2", rejectUnauthorized: true });
  });

  it("never disables certificate verification, even implicitly", () => {
    // A plain mysql2 connection (no explicit ssl option) is what actually
    // failed against TiDB with ER_UNKNOWN_ERROR/1105 in production
    // diagnosis -- ssl must always be present, and rejectUnauthorized
    // must always be true, regardless of what the URL itself contains.
    const options = buildPoolOptions(FIXTURE_URL);
    expect(options.ssl).toBeTruthy();
    expect((options.ssl as { rejectUnauthorized?: boolean }).rejectUnauthorized).toBe(true);
  });

  it("ignores any ssl-related query parameters on the URL itself", () => {
    // The fix is to configure TLS explicitly in code, not to trust
    // whatever the connection string's own query string says -- so a URL
    // that tries to turn verification off via a query param must not be
    // able to.
    const withQueryParam = `${FIXTURE_URL}?ssl-mode=DISABLED&rejectUnauthorized=false`;
    const options = buildPoolOptions(withQueryParam);
    expect(options.ssl).toEqual({ minVersion: "TLSv1.2", rejectUnauthorized: true });
  });

  it("carries the parsed host/port/user/password/database straight through", () => {
    const options = buildPoolOptions(FIXTURE_URL);
    expect(options.host).toBe("gateway01.example.com");
    expect(options.port).toBe(4000);
    expect(options.user).toBe("demo_user");
    expect(options.password).toBe("s3cret-pass");
    expect(options.database).toBe("watergun");
  });
});
