import type {
  FusionSolarResponse,
  StationList,
  StationRealKpi,
  StationKpi,
} from "./types";

class FusionSolarClient {
  private baseUrl: string;
  private userName: string;
  private systemCode: string;
  private xsrfToken: string | null = null;
  private lastRequestTime = 0;

  constructor() {
    this.baseUrl =
      process.env.FUSIONSOLAR_API_URL || "https://eu5.fusionsolar.huawei.com";
    this.userName = process.env.FUSIONSOLAR_USERNAME || "";
    this.systemCode = process.env.FUSIONSOLAR_SYSTEM_CODE || "";
  }

  private async rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < 60000 && this.lastRequestTime > 0) {
      await new Promise((resolve) => setTimeout(resolve, 60000 - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  async login(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/thirdData/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userName: this.userName,
        systemCode: this.systemCode,
      }),
    });

    const xsrf = response.headers.get("xsrf-token");
    if (xsrf) {
      this.xsrfToken = xsrf;
    }

    const data = (await response.json()) as FusionSolarResponse;
    if (data.failCode !== 0) {
      throw new Error(`FusionSolar login failed: ${data.message || data.failCode}`);
    }
  }

  private async request<T>(
    endpoint: string,
    body: Record<string, unknown>
  ): Promise<T> {
    if (!this.xsrfToken) {
      await this.login();
    }

    await this.rateLimit();

    const response = await fetch(`${this.baseUrl}/thirdData/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xsrf-token": this.xsrfToken!,
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as FusionSolarResponse<T>;

    // Token expired - re-login and retry
    if (data.failCode === 305) {
      await this.login();
      await this.rateLimit();

      const retryResponse = await fetch(
        `${this.baseUrl}/thirdData/${endpoint}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xsrf-token": this.xsrfToken!,
          },
          body: JSON.stringify(body),
        }
      );

      const retryData = (await retryResponse.json()) as FusionSolarResponse<T>;
      if (!retryData.success && retryData.failCode !== 0) {
        throw new Error(
          `FusionSolar API error: ${retryData.message || retryData.failCode}`
        );
      }
      return (retryData.data ?? retryData.params) as T;
    }

    if (!data.success && data.failCode !== 0) {
      throw new Error(
        `FusionSolar API error: ${data.message || data.failCode}`
      );
    }

    return (data.data ?? data.params) as T;
  }

  async getStationList(): Promise<StationList> {
    return this.request<StationList>("getStationList", {
      pageNo: 1,
      pageSize: 100,
    });
  }

  async getStationRealKpi(
    stationCodes: string[]
  ): Promise<StationRealKpi[]> {
    return this.request<StationRealKpi[]>("getStationRealKpi", {
      stationCodes: stationCodes.join(","),
    });
  }

  async getKpiStationDay(
    stationCodes: string[],
    collectTime: number
  ): Promise<StationKpi[]> {
    return this.request<StationKpi[]>("getKpiStationDay", {
      stationCodes: stationCodes.join(","),
      collectTime,
    });
  }

  async getKpiStationMonth(
    stationCodes: string[],
    collectTime: number
  ): Promise<StationKpi[]> {
    return this.request<StationKpi[]>("getKpiStationMonth", {
      stationCodes: stationCodes.join(","),
      collectTime,
    });
  }

  async getKpiStationYear(
    stationCodes: string[],
    collectTime: number
  ): Promise<StationKpi[]> {
    return this.request<StationKpi[]>("getKpiStationYear", {
      stationCodes: stationCodes.join(","),
      collectTime,
    });
  }
}

// Singleton instance per serverless invocation
let client: FusionSolarClient | null = null;

export function getFusionSolarClient(): FusionSolarClient {
  if (!client) {
    client = new FusionSolarClient();
  }
  return client;
}
