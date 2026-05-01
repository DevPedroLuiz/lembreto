import Holidays from 'date-holidays';
import { isSameDay, isSameMonth, isSameYear, startOfDay } from 'date-fns';
import {
  BRAZIL_STATES,
  getBrazilStateName,
  normalizeBrazilText,
  normalizeStateCode,
  resolveStateCodeFromName,
} from './brazil-location.js';
import type { SqlClient } from './handlers/core.js';

const BRAZIL_CODE = 'BR';

export interface HolidayRegionOption {
  code: string;
  name: string;
}

export interface HolidayLocationInfo {
  stateCode: string | null;
  stateName: string | null;
  cityName: string | null;
  regionCode: string | null;
  matchedRegionName: string | null;
  municipalSupported: boolean;
}

export interface HolidayEntry {
  id: string;
  name: string;
  date: string;
  type: string;
  scope: 'national' | 'state' | 'city';
}

export interface HolidayCalendarPayload {
  location: HolidayLocationInfo;
  today: HolidayEntry[];
  upcoming: HolidayEntry[];
  commemorative: HolidayEntry[];
  monthHighlights: HolidayEntry[];
  allEntries: HolidayEntry[];
  supportedCities: HolidayRegionOption[];
}

function createHolidayEngine(stateCode?: string | null, regionCode?: string | null) {
  if (stateCode && regionCode) return new Holidays(BRAZIL_CODE, stateCode, regionCode);
  if (stateCode) return new Holidays(BRAZIL_CODE, stateCode);
  return new Holidays(BRAZIL_CODE);
}

function extractDateKey(value: string) {
  return value.slice(0, 10);
}

function buildEntryKey(entry: { date: string; name: string; type?: string }) {
  return `${entry.date}|${entry.name}|${entry.type ?? 'public'}`;
}

function sortEntries(entries: HolidayEntry[]) {
  return [...entries].sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
}

function mapHolidayEntries(
  entries: Array<Record<string, unknown>>,
  scope: HolidayEntry['scope'],
) {
  return entries
    .filter((entry) => typeof entry.date === 'string' && typeof entry.name === 'string')
    .map((entry) => ({
      id: buildEntryKey({
        date: String(entry.date),
        name: String(entry.name),
        type: typeof entry.type === 'string' ? entry.type : 'public',
      }),
      name: String(entry.name),
      date: String(entry.date),
      type: typeof entry.type === 'string' ? entry.type : 'public',
      scope,
    }));
}

function toDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

export async function ensureHolidayLocationSchema(sql: SqlClient) {
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS state_code TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS city_name TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS holiday_region_code TEXT`;
}

export function getBrazilStates() {
  return BRAZIL_STATES;
}

export function getHolidayRegionsByState(stateCode?: string | null): HolidayRegionOption[] {
  const normalizedState = normalizeStateCode(stateCode);
  if (!normalizedState) return [];

  const engine = new Holidays(BRAZIL_CODE);
  const regions = engine.getRegions(BRAZIL_CODE, normalizedState) ?? {};

  return Object.entries(regions)
    .map(([code, name]) => ({ code, name }))
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' }));
}

export function resolveHolidayLocation(
  stateCode?: string | null,
  cityName?: string | null,
): HolidayLocationInfo {
  const normalizedState = normalizeStateCode(stateCode);
  const normalizedCity = cityName?.trim() || null;
  const supportedCities = getHolidayRegionsByState(normalizedState);

  if (!normalizedState) {
    return {
      stateCode: null,
      stateName: null,
      cityName: normalizedCity,
      regionCode: null,
      matchedRegionName: null,
      municipalSupported: false,
    };
  }

  if (!normalizedCity) {
    return {
      stateCode: normalizedState,
      stateName: getBrazilStateName(normalizedState),
      cityName: null,
      regionCode: null,
      matchedRegionName: null,
      municipalSupported: false,
    };
  }

  const normalizedCityName = normalizeBrazilText(normalizedCity);
  const matchedRegion =
    supportedCities.find((region) => normalizeBrazilText(region.name) === normalizedCityName) ??
    supportedCities.find((region) => normalizeBrazilText(region.name).includes(normalizedCityName)) ??
    supportedCities.find((region) => normalizedCityName.includes(normalizeBrazilText(region.name)));

  return {
    stateCode: normalizedState,
    stateName: getBrazilStateName(normalizedState),
    cityName: normalizedCity,
    regionCode: matchedRegion?.code ?? null,
    matchedRegionName: matchedRegion?.name ?? null,
    municipalSupported: Boolean(matchedRegion),
  };
}

function extractUniqueEntries(
  sourceEntries: HolidayEntry[],
  existingKeys: Set<string>,
) {
  const uniqueEntries: HolidayEntry[] = [];

  for (const entry of sourceEntries) {
    if (existingKeys.has(entry.id)) continue;
    existingKeys.add(entry.id);
    uniqueEntries.push(entry);
  }

  return uniqueEntries;
}

export function buildHolidayCalendar(
  location: Pick<HolidayLocationInfo, 'stateCode' | 'cityName' | 'regionCode'>,
  referenceDate = new Date(),
): HolidayCalendarPayload {
  const resolvedLocation = resolveHolidayLocation(location.stateCode, location.cityName);
  const years = [referenceDate.getFullYear(), referenceDate.getFullYear() + 1];

  const nationalEntries = years.flatMap((year) =>
    mapHolidayEntries(createHolidayEngine().getHolidays(year) as unknown as Array<Record<string, unknown>>, 'national'),
  );

  const stateEntries = resolvedLocation.stateCode
    ? years.flatMap((year) =>
        mapHolidayEntries(
          createHolidayEngine(resolvedLocation.stateCode).getHolidays(year) as unknown as Array<Record<string, unknown>>,
          'state',
        ),
      )
    : [];

  const cityEntries = resolvedLocation.stateCode && resolvedLocation.regionCode
    ? years.flatMap((year) =>
        mapHolidayEntries(
          createHolidayEngine(resolvedLocation.stateCode, resolvedLocation.regionCode).getHolidays(year) as unknown as Array<Record<string, unknown>>,
          'city',
        ),
      )
    : [];

  const seenNational = new Set<string>();
  const nationalUnique = extractUniqueEntries(nationalEntries, seenNational);
  const seenState = new Set<string>(seenNational);
  const stateUnique = extractUniqueEntries(stateEntries, seenState).map((entry) => ({ ...entry, scope: 'state' as const }));
  const seenCity = new Set<string>(seenState);
  const cityUnique = extractUniqueEntries(cityEntries, seenCity).map((entry) => ({ ...entry, scope: 'city' as const }));

  const allEntries = sortEntries([
    ...nationalUnique.map((entry) => ({ ...entry, scope: 'national' as const })),
    ...stateUnique,
    ...cityUnique,
  ]);

  const startOfToday = startOfDay(referenceDate);
  const today = allEntries.filter((entry) => {
    const date = toDate(entry.date);
    return date ? isSameDay(date, referenceDate) : false;
  });

  const upcoming = allEntries.filter((entry) => {
    const date = toDate(entry.date);
    return date ? date >= startOfToday : false;
  }).slice(0, 14);

  const commemorative = allEntries.filter((entry) => {
    const date = toDate(entry.date);
    return date
      ? entry.type !== 'public' && entry.type !== 'bank' && date >= startOfToday
      : false;
  }).slice(0, 10);

  const monthHighlights = allEntries.filter((entry) => {
    const date = toDate(entry.date);
    return date ? isSameMonth(date, referenceDate) && isSameYear(date, referenceDate) : false;
  });

  return {
    location: resolvedLocation,
    today,
    upcoming,
    commemorative,
    monthHighlights,
    allEntries,
    supportedCities: getHolidayRegionsByState(resolvedLocation.stateCode),
  };
}

export function isHolidayForLocationOnDate(
  location: Pick<HolidayLocationInfo, 'stateCode' | 'cityName' | 'regionCode'>,
  targetDate: Date,
): boolean {
  if (Number.isNaN(targetDate.getTime())) return false;

  const resolvedLocation = resolveHolidayLocation(location.stateCode, location.cityName);
  const year = targetDate.getFullYear();
  const dateKey = extractDateKey(targetDate.toISOString());

  const nationalEntries = mapHolidayEntries(
    createHolidayEngine().getHolidays(year) as unknown as Array<Record<string, unknown>>,
    'national',
  );
  const stateEntries = resolvedLocation.stateCode
    ? mapHolidayEntries(
        createHolidayEngine(resolvedLocation.stateCode).getHolidays(year) as unknown as Array<Record<string, unknown>>,
        'state',
      )
    : [];
  const cityEntries = resolvedLocation.stateCode && resolvedLocation.regionCode
    ? mapHolidayEntries(
        createHolidayEngine(resolvedLocation.stateCode, resolvedLocation.regionCode).getHolidays(year) as unknown as Array<Record<string, unknown>>,
        'city',
      )
    : [];

  return [...nationalEntries, ...stateEntries, ...cityEntries].some((entry) => extractDateKey(entry.date) === dateKey);
}

export interface ReverseDetectedLocation {
  stateCode: string | null;
  stateName: string | null;
  cityName: string | null;
  municipalSupported: boolean;
  regionCode: string | null;
  matchedRegionName: string | null;
}

export async function detectBrazilLocationFromCoordinates(
  latitude: number,
  longitude: number,
): Promise<ReverseDetectedLocation> {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(latitude),
    lon: String(longitude),
    zoom: '10',
    addressdetails: '1',
    'accept-language': 'pt-BR',
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
    headers: {
      'User-Agent': 'Lembreto/1.0',
    },
  });

  if (!response.ok) {
    throw new Error('Nao foi possivel identificar sua localizacao agora.');
  }

  const payload = await response.json() as {
    address?: {
      country_code?: string;
      state?: string;
      municipality?: string;
      city?: string;
      town?: string;
      village?: string;
      county?: string;
      ['ISO3166-2-lvl4']?: string;
    };
  };

  const countryCode = payload.address?.country_code?.toLowerCase();
  if (countryCode && countryCode !== 'br') {
    throw new Error('A localizacao detectada esta fora do Brasil.');
  }

  const stateCode =
    normalizeStateCode(payload.address?.['ISO3166-2-lvl4']?.replace('BR-', '')) ??
    resolveStateCodeFromName(payload.address?.state ?? null);
  const cityName =
    payload.address?.municipality ??
    payload.address?.city ??
    payload.address?.town ??
    payload.address?.village ??
    payload.address?.county ??
    null;

  const resolved = resolveHolidayLocation(stateCode, cityName);
  return {
    stateCode: resolved.stateCode,
    stateName: resolved.stateName,
    cityName: resolved.cityName,
    municipalSupported: resolved.municipalSupported,
    regionCode: resolved.regionCode,
    matchedRegionName: resolved.matchedRegionName,
  };
}
