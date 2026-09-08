declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FUSIONSOLAR_USERNAME?: string;
    FUSIONSOLAR_PASSWORD?: string;
    FUSIONSOLAR_OWNER?: string;
    SOLAR_SYNC_KEY?: string;
  }
}
