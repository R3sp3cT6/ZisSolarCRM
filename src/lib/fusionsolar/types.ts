export interface FusionSolarResponse<T = unknown> {
  success: boolean;
  failCode: number;
  params?: T;
  message?: string;
  data?: T;
}

export interface Station {
  stationCode: string;
  stationName: string;
  stationAddr: string;
  capacity: number;
  contactPerson: string;
  contactMethod: string;
  gridConnectionDate: string;
  installedCapacity: number;
}

export interface StationList {
  total: number;
  list: Station[];
}

export interface StationRealKpi {
  stationCode: string;
  dataItemMap: {
    day_power?: number;
    month_power?: number;
    total_power?: number;
    day_income?: number;
    total_income?: number;
    real_health_state?: number;
  };
}

export interface StationKpi {
  stationCode: string;
  dataItemMap: {
    inverter_power?: number;
    power_profit?: number;
    installed_capacity?: number;
    perpower_ratio?: number;
    ongrid_power?: number;
    use_power?: number;
    reduction_total_co2?: number;
  };
}
