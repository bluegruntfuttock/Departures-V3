
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Station, Service, ServiceDetail, LocationDetail } from './types';
import { fetchDepartures, fetchServiceDetails } from './services/rttService';
import { findStationCrs, getRouteCallingPoints, RouteStops } from './services/geminiService';
import { MAJOR_STATIONS, Icons } from './constants';
import { APP_VERSION } from './version';

const RECENT_STATIONS_KEY = 'uk_rail_recent_stations_v4_stable';

const formatTime = (timeStr?: string) => {
  if (!timeStr || timeStr.length < 4) return "--:--";
  return `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
};

const calculateStatus = (location: LocationDetail) => {
  const planned = location.gbttBookedDeparture || location.gbttBookedArrival;
  const actual = location.realtimeDeparture || location.realtimeArrival;
  const isDeparted = location.realtimeDepartureActual === true;
  const isArrivedOnly = location.realtimeArrivalActual === true && !isDeparted;
  
  if (location.displayAs === 'CANCELLED_CALL') {
    return { text: "STOP CANCELLED", displayStatus: "CANCELLED", color: "text-rose-500", bg: "bg-rose-500/20", isDeparted: false, isArrivedOnly: false, isCancelled: true };
  }

  if (!planned) return { text: "Scheduled", displayStatus: "Scheduled", color: "text-blue-400", bg: "bg-blue-400/10", isDeparted, isArrivedOnly, isCancelled: false };

  let diffText = "On Time";
  let statusColor = "text-emerald-400";
  let statusBg = "bg-emerald-400/10";
  let diff = 0;

  if (actual && actual !== planned) {
    const pMin = parseInt(planned.slice(0, 2), 10) * 60 + parseInt(planned.slice(2, 4), 10);
    const aMin = parseInt(actual.slice(0, 2), 10) * 60 + parseInt(actual.slice(2, 4), 10);
    const estTime = formatTime(actual);
    diff = aMin - pMin;
    if (diff < -1200) diff += 1440;
    if (diff > 1200) diff -= 1440;

    if (diff > 0) { 
      diffText = `${diff}m Late (${estTime})`; 
      statusColor = "text-rose-400"; 
      statusBg = "bg-rose-400/10"; 
    } else if (diff < 0) { 
      diffText = `${Math.abs(diff)}m Early (${estTime})`; 
      statusColor = "text-emerald-400"; 
      statusBg = "bg-emerald-400/10"; 
    }
  }
  
  let finalStatusText = diffText;
  if (isDeparted) {
    if (diff > 0) finalStatusText = `Departed ${diff}m Late`;
    else if (diff < 0) finalStatusText = `Departed ${Math.abs(diff)}m Early`;
    else finalStatusText = "Departed On Time";
  } else if (isArrivedOnly) {
    if (diff > 0) finalStatusText = `Arrived ${diff}m Late`;
    else if (diff < 0) finalStatusText = `Arrived ${Math.abs(diff)}m Early`;
    else finalStatusText = "Arrived On Time";
  }

  return { 
    text: finalStatusText, 
    displayStatus: diffText, 
    color: statusColor, 
    bg: statusBg, 
    isDeparted, 
    isArrivedOnly,
    isCancelled: false
  };
};

const getFullDestinationName = (service: Service | ServiceDetail): string => {
  const dest = 'locationDetail' in service ? (service.destination || service.locationDetail?.destination) : (service.destination || null);
  if (Array.isArray(dest)) return dest[0]?.description || "Check Board";
  return (dest as any)?.description || "Check Board";
};

const App: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Station[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [departures, setDepartures] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<ServiceDetail | null>(null);
  const [isServiceLoading, setIsServiceLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTechnical, setShowTechnical] = useState(false);
  const [isRefreshError, setIsRefreshError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [recentStations, setRecentStations] = useState<Station[]>([]);
  const [isStale, setIsStale] = useState(false);
  
  const latestQueryRef = useRef('');

  useEffect(() => {
    const checkStale = () => {
      if (!lastUpdated) return;
      const diff = new Date().getTime() - lastUpdated.getTime();
      setIsStale(diff > 60000); // 1 minute
    };
    
    const interval = setInterval(checkStale, 5000); // Check every 5 seconds
    checkStale();
    return () => clearInterval(interval);
  }, [lastUpdated]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(RECENT_STATIONS_KEY);
      if (saved) setRecentStations(JSON.parse(saved));
    } catch (e) { setRecentStations([]); }
  }, []);

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  };

  useEffect(() => {
    latestQueryRef.current = searchQuery;
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    
    const timer = setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const results = await findStationCrs(searchQuery);
        if (latestQueryRef.current === searchQuery) {
          setSearchResults(results || []);
          if (!results || results.length === 0) setSearchError("No stations found");
        }
      } catch (err: any) {
        if (latestQueryRef.current === searchQuery) setSearchError("Lookup Unavailable");
      } finally {
        if (latestQueryRef.current === searchQuery) setIsSearching(false);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadStationData = useCallback(async (station: Station, silent: boolean = false) => {
    if (!station?.crs) return;
    if (!silent) { setLoading(true); setError(null); }
    
    setSelectedStation(station);
    setSelectedService(null);
    setSearchQuery('');

    try {
      const data = await fetchDepartures(station.crs);
      const services = data.services || [];
      
      setDepartures(prev => services.map(s => {
        const match = prev.find(p => p.serviceUid === s.serviceUid);
        return match ? { ...s, callingPoints: match.callingPoints } : s;
      }));
      
      setLastUpdated(new Date());
      setError(null);
      setIsRefreshError(false);

      if (!silent) {
        setRecentStations(prev => {
          const filtered = prev.filter(s => s.crs !== station.crs);
          const updated = [station, ...filtered].slice(0, 12);
          try { localStorage.setItem(RECENT_STATIONS_KEY, JSON.stringify(updated)); } catch (e) {}
          return updated;
        });
      }

      if (services.length > 0 && !silent) {
        setEnriching(true);
        const uniqueRoutes = services.slice(0, 8).map(s => ({
          origin: "Origin", destination: getFullDestinationName(s), via: data.location?.name || station.name
        })).filter((v, i, a) => a.findIndex(t => t.destination === v.destination) === i);

        getRouteCallingPoints(uniqueRoutes).then((enrichedResults: RouteStops[]) => {
          if (!enrichedResults) return;
          setDepartures(prev => prev.map(s => {
            const destName = getFullDestinationName(s).toLowerCase();
            const match = enrichedResults.find(r => r.destination.toLowerCase().includes(destName) || destName.includes(r.destination.toLowerCase()));
            return match && match.stops.length > 0 ? { ...s, callingPoints: match.stops } : s;
          }));
        }).finally(() => setEnriching(false));
      }
    } catch (err: any) {
      setIsRefreshError(true);
      if (departures.length === 0 || !silent) setError(err.message || "Data flow interrupted.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [departures.length]);

  const handleServiceClick = useCallback(async (service: Service | { serviceUid: string, runDate: string }, silent: boolean = false) => {
    if (!silent) { setIsServiceLoading(true); setError(null); }
    try {
      const details = await fetchServiceDetails(service.serviceUid, service.runDate);
      setSelectedService(details);
      setLastUpdated(new Date());
      setError(null);
      setIsRefreshError(false);
    } catch (err: any) {
      setIsRefreshError(true);
      if (!selectedService || !silent) setError("Timeline fetch failed. Check connection.");
    } finally {
      if (!silent) setIsServiceLoading(false);
    }
  }, [selectedService]);

  const handleManualRefresh = () => {
    if (selectedService) handleServiceClick(selectedService, false);
    else if (selectedStation) loadStationData(selectedStation, false);
  };

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const scheduleRefresh = () => {
      const now = new Date();
      const seconds = now.getSeconds();
      const ms = now.getMilliseconds();
      
      // Calculate milliseconds until the next :00 or :30 mark
      const delay = (30 - (seconds % 30)) * 1000 - ms;

      timeoutId = setTimeout(() => {
        if (selectedService) handleServiceClick(selectedService, true);
        else if (selectedStation) loadStationData(selectedStation, true);
        scheduleRefresh();
      }, delay + 100); // Small buffer to ensure we cross the threshold
    };

    scheduleRefresh();
    return () => clearTimeout(timeoutId);
  }, [selectedStation, selectedService, handleServiceClick, loadStationData]);

  if (!selectedStation) {
    const stations = recentStations.length > 0 ? recentStations : MAJOR_STATIONS;
    return (
      <div className="h-screen w-screen bg-slate-950 text-slate-200 flex flex-col items-center pt-16 md:pt-24 p-6 overflow-y-auto custom-scrollbar relative">
        <div className="w-full max-w-xl animate-in">
          <header className="mb-10 text-center">
            <h1 className="text-4xl md:text-5xl font-black text-white italic uppercase tracking-tighter mb-2">UK Rail Live</h1>
            <p className="text-slate-500 text-[10px] uppercase tracking-[0.4em]">Advanced Departure Tracker</p>
          </header>
          
          <form onSubmit={(e) => { e.preventDefault(); if (searchResults.length > 0) loadStationData(searchResults[0]); }} className="bg-slate-900 border border-slate-800 rounded-2xl p-1 shadow-2xl mb-12">
            <div className="flex items-center px-4">
              <div className="text-slate-500 mr-3">
                {isSearching ? <div className="h-4 w-4 border-2 border-blue-500 border-t-transparent animate-spin rounded-full" /> : <Icons.Search />}
              </div>
              <input type="text" className="w-full py-4 bg-transparent focus:outline-none text-white font-bold text-lg" placeholder="Enter station name..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            {searchResults.length > 0 && (
              <div className="border-t border-slate-800 max-h-60 overflow-y-auto custom-scrollbar">
                {searchResults.map(s => (
                  <button type="button" key={s.crs} onClick={() => loadStationData(s)} className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors group text-left">
                    <span className="font-bold text-white group-hover:text-blue-400">{s.name}</span>
                    <span className="text-[10px] font-black bg-slate-800 px-2 py-1 rounded text-slate-400 uppercase tracking-widest">{s.crs}</span>
                  </button>
                ))}
              </div>
            )}
            {searchError && <div className="p-4 text-[10px] text-rose-500 font-black uppercase tracking-widest text-center border-t border-slate-800">{searchError}</div>}
          </form>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {stations.map(s => (
              <button key={s.crs} onClick={() => loadStationData(s)} className="p-3 bg-slate-900/40 border border-slate-800 hover:border-blue-500 rounded-xl text-[10px] font-bold text-slate-400 hover:text-white transition-all truncate text-center uppercase tracking-wider">
                {s.name}
              </button>
            ))}
          </div>
          <div className="mt-8 text-center text-[10px] font-black text-slate-800 uppercase tracking-[0.3em]">v{APP_VERSION}</div>
        </div>

        <div className="fixed bottom-6 right-6 z-[100]">
          <button 
            onClick={toggleFullscreen} 
            className="p-3 bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl text-slate-400 hover:text-white hover:border-blue-500 transition-all shadow-2xl active:scale-95"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Icons.FullscreenExit /> : <Icons.Fullscreen />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-black text-slate-100 flex flex-col overflow-hidden">
      <nav className="h-16 bg-black border-b border-white/5 px-4 md:px-8 flex items-center justify-between shrink-0 z-50 relative">
        <div className="flex items-center gap-1 shrink-0 z-10">
          <button onClick={() => { setSelectedStation(null); setSelectedService(null); }} className="p-2 text-slate-500 hover:text-white"><Icons.ChevronDoubleLeft /></button>
          {selectedService && <button onClick={() => setSelectedService(null)} className="p-2 text-slate-400 hover:text-white"><Icons.ChevronLeft /></button>}
        </div>

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-16">
          <div className="flex flex-col items-center pointer-events-auto">
            <div className="bg-blue-600 border-2 border-white rounded-full px-4 py-1.5 md:px-6 md:py-2 shadow-[0_0_25px_rgba(37,99,235,0.5)] flex items-center gap-2 max-w-[200px] sm:max-w-[300px] md:max-w-md">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${(isRefreshError || isStale) ? 'animate-pulse-red' : 'animate-pulse-green'}`} />
              <h1 className="text-[10px] md:text-sm font-black uppercase tracking-widest text-white truncate leading-none">
                {selectedService ? getFullDestinationName(selectedService) : selectedStation.name}
              </h1>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4 shrink-0 z-10">
          <div className="flex flex-col items-end">
            <span className={`text-[6px] md:text-[8px] font-black uppercase tracking-[0.4em] mb-0.5 ${(isRefreshError || isStale) ? 'text-rose-500/60' : 'text-emerald-500/60'}`}>
              {(isRefreshError || isStale) ? 'STALE_DATA' : 'LAST_UPDATE'}
            </span>
            <span className={`mono text-xs md:text-base font-bold tracking-wider ${(isRefreshError || isStale) ? 'text-rose-500' : 'text-emerald-400'}`}>
              {lastUpdated ? lastUpdated.toLocaleTimeString('en-GB') : "--:--"}
            </span>
          </div>
          <button onClick={handleManualRefresh} className={`p-2 bg-white/5 rounded-lg ${loading || isServiceLoading ? 'animate-spin text-blue-500' : ''}`}><Icons.Refresh /></button>
        </div>
      </nav>

      <main className="flex-1 p-1 md:p-4 flex flex-col overflow-hidden max-w-[1800px] mx-auto w-full">
        <div className="flex-1 bg-zinc-950 border border-white/5 rounded-2xl shadow-2xl flex flex-col overflow-hidden relative">
          {!selectedService ? (
            <div className="flex-1 flex flex-col overflow-hidden h-full">
              <div className="px-3 py-1.5 bg-zinc-900 border-b border-white/5 flex items-center justify-between shrink-0">
                <span className="text-[10px] font-bold text-blue-500 uppercase">Board Output</span>
                <div className="text-[7px] font-bold text-zinc-600 uppercase tracking-widest">v{APP_VERSION} STABLE</div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-white/5">
                {loading && departures.length === 0 && !error ? (
                  <div className="h-full flex flex-col items-center justify-center gap-4">
                    <div className="h-10 w-10 border-4 border-blue-500/10 border-t-blue-500 animate-spin rounded-full" />
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Establishing Data Link...</span>
                  </div>
                ) : (departures.length === 0 && error) ? (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-sm mx-auto">
                    <div className="text-3xl font-black italic uppercase text-zinc-800 mb-4">Feed Error</div>
                    <p className="text-[11px] text-zinc-400 font-medium mb-6 leading-relaxed uppercase tracking-tight">{error}</p>
                    
                    <button onClick={() => setShowTechnical(!showTechnical)} className="text-[9px] font-bold text-blue-900 hover:text-blue-500 uppercase tracking-widest mb-4 transition-colors">
                      {showTechnical ? 'Hide Diagnostics' : 'Show Diagnostics'}
                    </button>
                    
                    {showTechnical && (
                      <div className="w-full p-3 bg-black/40 rounded-lg border border-white/5 mb-6 text-left">
                        <p className="text-[8px] font-mono text-zinc-600 mb-1">NETWORK_ERROR_CODE: CORB_OR_PREFLIGHT_FAIL</p>
                        <p className="text-[8px] font-mono text-zinc-600">CLIENT_ENVIRONMENT: MOBILE_BROWSER_RESTRICTIVE</p>
                      </div>
                    )}
                    
                    <button onClick={handleManualRefresh} className="w-full py-4 bg-blue-600 text-white font-black uppercase tracking-widest text-[11px] rounded-xl hover:bg-blue-500 transition-all shadow-xl active:scale-95">Force Data Re-Sync</button>
                  </div>
                ) : (
                  departures.map((s, idx) => {
                    const status = calculateStatus(s.locationDetail);
                    const isGone = status.isDeparted;
                    return (
                      <button key={`${s.serviceUid}-${idx}`} onClick={() => handleServiceClick(s)} className={`w-full py-3 px-4 md:py-4 md:px-6 grid grid-cols-12 gap-3 md:gap-4 hover:bg-white/[0.03] active:bg-white/5 transition-colors text-left group ${isGone ? 'opacity-30' : ''}`}>
                        <div className="col-span-3 md:col-span-2 flex flex-col justify-center">
                          <span className={`text-xl md:text-3xl font-black mono tracking-tighter transition-colors leading-none ${isGone ? 'text-orange-500' : status.isArrivedOnly ? 'text-pink-500' : 'text-white'}`}>
                            {formatTime(s.locationDetail.gbttBookedDeparture || s.locationDetail.realtimeDeparture)}
                          </span>
                          <span className={`text-[7px] md:text-[9px] font-black uppercase px-1.5 py-0.5 mt-1.5 rounded w-fit ${status.bg} ${status.color}`}>
                            {status.text}
                          </span>
                        </div>
                        <div className="col-span-9 md:col-span-10 flex flex-col justify-center min-w-0">
                          <h3 className={`text-sm md:text-2xl font-black uppercase tracking-tighter leading-tight truncate ${isGone ? 'text-orange-500' : 'text-slate-100'}`}>{getFullDestinationName(s)}</h3>
                          <div className="flex items-center gap-1.5 mt-1 overflow-hidden whitespace-nowrap">
                            {s.callingPoints ? s.callingPoints.slice(0, 5).map((p, pIdx) => (
                              <React.Fragment key={pIdx}>
                                <span className="text-[9px] md:text-[11px] font-medium text-white/70 truncate">{p}</span>
                                {pIdx < 4 && <span className="text-zinc-800 text-[8px]">•</span>}
                              </React.Fragment>
                            )) : <span className="text-[7px] font-black text-zinc-800 uppercase tracking-widest">{enriching ? 'SCANNING ROUTE...' : 'DIRECT SERVICE'}</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col animate-in h-full">
              <div className="px-3 py-1.5 bg-zinc-900 border-b border-white/5 flex items-center justify-between shrink-0">
                <span className="text-[10px] font-bold text-blue-500 uppercase">Service Detail</span>
                <div className="text-[7px] font-bold text-zinc-600 uppercase tracking-widest">{selectedService.atocName}</div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-8">
                <div className="max-w-xl mx-auto space-y-6 relative pb-24">
                  <div className="absolute left-[29px] top-4 bottom-24 w-0.5 bg-zinc-900" />
                  {selectedService.locations.map((loc, lIdx) => {
                    const status = calculateStatus(loc);
                    const isFinal = lIdx === selectedService.locations.length - 1;
                    const isGone = loc.realtimeDepartureActual === true || (isFinal && loc.realtimeArrivalActual === true);
                    return (
                      <div key={lIdx} className="flex gap-4 items-start relative z-10">
                        <div className="flex flex-col items-center w-14 shrink-0">
                          <span className={`mono text-[10px] font-bold ${isGone ? 'text-zinc-700' : 'text-slate-400'}`}>
                            {formatTime(loc.gbttBookedArrival || loc.gbttBookedDeparture)}
                          </span>
                          <div className={`w-3 h-3 rounded-full border-2 mt-2 transition-all ${isGone ? 'bg-zinc-900 border-zinc-700' : status.isArrivedOnly ? 'bg-pink-500 border-pink-500 scale-110 animate-pulse' : 'bg-black border-blue-600'}`} />
                        </div>
                        <button 
                          onClick={() => {
                            if (loc.crs) {
                              loadStationData({ name: loc.description, crs: loc.crs });
                              setSelectedService(null);
                            }
                          }}
                          className="flex-1 min-w-0 text-left group/loc"
                        >
                          <div className="flex items-center gap-2">
                            <span className={`text-base font-black uppercase tracking-tight truncate group-hover/loc:text-blue-400 transition-colors ${isGone ? 'text-zinc-700' : status.isArrivedOnly ? 'text-pink-500' : 'text-white'}`}>{loc.description}</span>
                            <span className="text-[8px] font-black text-zinc-700 uppercase tracking-widest group-hover/loc:text-blue-900">{loc.crs}</span>
                          </div>
                          <div className="flex gap-2 mt-1">
                            <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${status.bg} ${status.color}`}>{status.text.toUpperCase()}</span>
                            {loc.platform && <span className="text-[8px] font-black bg-zinc-900 text-zinc-500 px-1.5 py-0.5 rounded">PLAT {loc.platform}</span>}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="h-8 border-t border-white/5 px-4 md:px-8 flex items-center justify-between opacity-40 shrink-0">
        <span className="text-[7px] font-black uppercase tracking-widest flex items-center gap-2">
          <div className={`w-1 h-1 rounded-full ${isRefreshError ? 'bg-rose-500' : 'bg-emerald-500'}`} />
          {isRefreshError ? 'LINK_BROKEN' : 'LIVE_SYNC_READY'}
        </span>
        <span className="text-[7px] font-black uppercase tracking-widest text-zinc-800">v{APP_VERSION}</span>
      </footer>

      <div className="fixed bottom-6 right-6 z-[100]">
        <button 
          onClick={toggleFullscreen} 
          className="p-3 bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl text-slate-400 hover:text-white hover:border-blue-500 transition-all shadow-2xl active:scale-95"
          title="Toggle Fullscreen"
        >
          {isFullscreen ? <Icons.FullscreenExit /> : <Icons.Fullscreen />}
        </button>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 10px; }
        .animate-in { animation: fadeIn 0.2s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse-green-blue {
          0%, 100% { background-color: #34d399; }
          50% { background-color: #2563eb; }
        }
        @keyframes pulse-red-blue {
          0%, 100% { background-color: #f43f5e; }
          50% { background-color: #2563eb; }
        }
        .animate-pulse-green { animation: pulse-green-blue 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        .animate-pulse-red { animation: pulse-red-blue 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
        * { -webkit-tap-highlight-color: transparent; outline: none; }
      `}</style>
    </div>
  );
};

export default App;
