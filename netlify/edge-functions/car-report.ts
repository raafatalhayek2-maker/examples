import type { Config } from "@netlify/edge-functions";

// Free public data from NHTSA (US National Highway Traffic Safety Administration)
const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles";
const NHTSA = "https://api.nhtsa.gov";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });

const getJson = async (url: string) => {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

export default async (request: Request) => {
  const vin = (new URL(request.url).searchParams.get("vin") || "")
    .trim()
    .toUpperCase();

  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    return json({ error: "رقم الشاصي (VIN) يجب أن يكون 17 خانة بدون الأحرف I و O و Q" }, 400);
  }

  const decoded = await getJson(
    `${VPIC}/DecodeVinValuesExtended/${vin}?format=json`,
  );
  const v = decoded?.Results?.[0];
  if (!v || !v.Make) {
    return json({ error: "لم يتم العثور على معلومات لهذا الرقم" }, 404);
  }

  const q = `make=${encodeURIComponent(v.Make)}&model=${encodeURIComponent(v.Model)}&modelYear=${encodeURIComponent(v.ModelYear)}`;
  const [recalls, complaints] = await Promise.all([
    getJson(`${NHTSA}/recalls/recallsByVehicle?${q}`),
    getJson(`${NHTSA}/complaints/complaintsByVehicle?${q}`),
  ]);

  return json({
    vin,
    vehicle: {
      make: v.Make,
      model: v.Model,
      year: v.ModelYear,
      trim: v.Trim,
      body: v.BodyClass,
      vehicleType: v.VehicleType,
      doors: v.Doors,
      engine: [v.EngineCylinders && `${v.EngineCylinders} سلندر`, v.DisplacementL && `${Number(v.DisplacementL).toFixed(1)}L`, v.EngineHP && `${v.EngineHP} حصان`]
        .filter(Boolean)
        .join(" · "),
      fuel: v.FuelTypePrimary,
      transmission: [v.TransmissionStyle, v.TransmissionSpeeds && `${v.TransmissionSpeeds} سرعات`].filter(Boolean).join(" · "),
      drive: v.DriveType,
      manufacturer: v.Manufacturer,
      plant: [v.PlantCity, v.PlantCountry].filter(Boolean).join("، "),
      airbags: v.AirBagLocFront,
      abs: v.ABS,
    },
    recalls: (recalls?.results || []).map((r: any) => ({
      id: r.NHTSACampaignNumber,
      date: r.ReportReceivedDate,
      component: r.Component,
      summary: r.Summary,
      consequence: r.Consequence,
      remedy: r.Remedy,
    })),
    complaintsCount: complaints?.count ?? (complaints?.results || []).length,
    topComplaintComponents: Object.entries(
      (complaints?.results || []).reduce((acc: Record<string, number>, c: any) => {
        for (const part of String(c.components || "").split(",")) {
          const k = part.trim();
          if (k) acc[k] = (acc[k] || 0) + 1;
        }
        return acc;
      }, {}),
    )
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 5),
  });
};

export const config: Config = {
  path: "/api/car-report",
};
