
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { Station } from "../types";

export async function findStationCrs(query: string): Promise<Station[]> {
  const apiKey = (window as any).GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY;
  const ai = new GoogleGenAI({ apiKey: apiKey as string });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Find official UK National Rail stations for: "${query}". 
      Return the 3-letter CRS codes and names. 
      
      CRITICAL INSTRUCTIONS:
      1. ONLY return National Rail stations.
      2. If the user provides a region in brackets (e.g., "Rainham (Essex)"), you MUST return that specific station.
      3. DISAMBIGUATION MAP (Priority):
         - "Rainham (Essex)" -> Name: "Rainham (Essex)", CRS: "RNM"
         - "Rainham (Kent)" -> Name: "Rainham (Kent)", CRS: "RAI"
         - "Richmond (London)" -> Name: "Richmond (London)", CRS: "RMD"
         - "Richmond (Yorks)" -> Name: "Richmond (Yorks)", CRS: "RIC"
         - "West Ham" -> Name: "West Ham", CRS: "WEH"
      4. For any other duplicate names, include the county or area in brackets.
      5. Ensure the 3-letter CRS code is accurate. Do not guess.
      6. Limit to the 5 most relevant results.`,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              crs: { type: Type.STRING }
            },
            required: ["name", "crs"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    try {
      const results = JSON.parse(text);
      return results.map((r: any) => ({
        ...r,
        crs: r.crs.toUpperCase().trim()
      }));
    } catch (e) {
      console.error("JSON parse error in station search:", text);
      return [];
    }
  } catch (err: any) {
    console.error("Station search error:", err);
    const msg = err?.message || "";
    if (msg.includes("API_KEY_INVALID") || msg.includes("API key not found")) {
      throw new Error("Station lookup configuration error (API Key).");
    }
    throw new Error(`Station lookup unavailable: ${msg.slice(0, 50)}`);
  }
}

export interface RouteStops {
  destination: string;
  stops: string[];
}

export async function getRouteCallingPoints(routes: {origin: string, via: string, destination: string}[]): Promise<RouteStops[]> {
  if (routes.length === 0) return [];
  
  const apiKey = (window as any).GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY;
  const ai = new GoogleGenAI({ apiKey: apiKey as string });
  const viaStation = routes[0].via;
  const routeList = routes.map(r => `- To ${r.destination}`).join('\n');
  
  const prompt = `For a train at "${viaStation}", list 3-5 major intermediate calling points it will stop at BEFORE reaching the following destinations.
Destinations:
${routeList}

Instructions:
1. ONLY include stops between "${viaStation}" and the final Destination.
2. Return a list of objects containing the "destination" and the array of "stops".`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              destination: { type: Type.STRING },
              stops: { 
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["destination", "stops"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    try {
      return JSON.parse(text);
    } catch (e) {
      return [];
    }
  } catch (err) {
    console.error("Calling points enrichment error:", err);
    return [];
  }
}
