
export interface Station {
  name: string;
  crs: string;
}

export interface LocationDetail {
  realtimeActivated: boolean;
  crs: string;
  description: string;
  gbttBookedArrival?: string;
  gbttBookedDeparture?: string;
  realtimeArrival?: string;
  realtimeDeparture?: string;
  realtimeArrivalActual?: boolean;
  realtimeDepartureActual?: boolean;
  displayAs?: string;
  platform?: string;
  platformConfirmed?: boolean;
  // Fallback destination often found here in some RTT versions
  destination?: any;
  origin?: any;
}

export interface Service {
  locationDetail: LocationDetail;
  serviceUid: string;
  runDate: string;
  trainIdentity: string;
  runningIdentity?: string;
  atocCode?: string;
  atocName?: string;
  serviceType?: string;
  isPassenger?: boolean;
  origin?: any;
  destination?: any;
  // Enriched field for UI
  callingPoints?: string[];
}

export interface ServiceDetail {
  serviceUid: string;
  runDate: string;
  trainIdentity: string;
  atocName: string;
  locations: LocationDetail[];
  origin: LocationDetail[];
  destination: LocationDetail[];
}

export interface RTTResponse {
  location?: {
    name: string;
    crs: string;
  };
  services?: Service[] | null;
  error?: string;
}
