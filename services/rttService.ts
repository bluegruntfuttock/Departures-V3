
import { RTTResponse, Service, ServiceDetail } from "../types";

// RTT API Credentials
const USERNAME = 'rttapi_bluegruntfuttock@gmail.com';
const PASSWORD = '7c5b8634ff592fe4969a2ae5f4f00303b1c7cc04';

const getAuthHeader = () => {
  return 'Basic ' + btoa(`${USERNAME}:${PASSWORD}`);
};

function getSortTime(timeStr: string, refMinutes: number): number {
  const hours = parseInt(timeStr.slice(0, 2), 10);
  const mins = parseInt(timeStr.slice(2, 4), 10);
  let totalMins = hours * 60 + mins;
  if (totalMins < refMinutes - 120) totalMins += 1440; 
  return totalMins;
}

/**
 * Fetches data from the local Express backend to avoid CORS issues and unreliable proxies.
 */
async function fetchFromBackend(endpoint: string): Promise<Response> {
  const response = await fetch(endpoint);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Backend error: ${response.statusText}`);
  }
  return response;
}

export async function fetchDepartures(crs: string): Promise<RTTResponse> {
  const cleanCrs = crs.trim().toUpperCase();
  const endpoint = `/api/rtt/departures/${cleanCrs}`;
  
  try {
    const response = await fetchFromBackend(endpoint);
    const data: RTTResponse = await response.json();
    
    if (data.error) throw new Error(`RTT: ${data.error}`);

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    if (data.services && Array.isArray(data.services)) {
      data.services = data.services.filter(s => {
        if (!s.locationDetail.realtimeDepartureActual) return true;
        const depTime = s.locationDetail.realtimeDeparture || s.locationDetail.gbttBookedDeparture;
        if (!depTime) return true;
        const depMins = getSortTime(depTime, currentMinutes);
        return (currentMinutes - depMins) <= 15;
      });

      data.services.sort((a, b) => {
        const timeA = a.locationDetail?.gbttBookedDeparture || a.locationDetail?.realtimeDeparture || "0000";
        const timeB = b.locationDetail?.gbttBookedDeparture || b.locationDetail?.realtimeDeparture || "0000";
        return getSortTime(timeA, currentMinutes) - getSortTime(timeB, currentMinutes);
      });
    } else {
      data.services = [];
    }

    return data;
  } catch (error: any) {
    throw error;
  }
}

export async function fetchServiceDetails(serviceUid: string, runDate: string): Promise<ServiceDetail> {
  const endpoint = `/api/rtt/service/${serviceUid}/${runDate}`;

  try {
    const response = await fetchFromBackend(endpoint);
    return await response.json();
  } catch (error: any) {
    throw error;
  }
}
