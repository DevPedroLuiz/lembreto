import { addMinutes, formatDateOnly, isDateOnlyDueDate, LEMBRETO_TIME_ZONE } from './eventPayload.js';
import type {
  CalendarEventInput,
  CalendarProviderClient,
  CalendarTokenSet,
  ExternalCalendarEvent,
} from './types.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleEventResponse {
  id?: string;
  error?: {
    message?: string;
  };
}

interface GoogleListEventsResponse {
  items?: Array<{
    id?: string;
    status?: string;
    summary?: string;
    description?: string;
    start?: {
      date?: string;
      dateTime?: string;
    };
  }>;
  nextPageToken?: string;
  error?: {
    message?: string;
  };
}

function getGoogleCalendarConfig() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CALENDAR_NOT_CONFIGURED');
  }

  return { clientId, clientSecret };
}

function buildGoogleEventPayload(event: CalendarEventInput) {
  const dueDate = new Date(event.dueDate);
  const endDate = event.endDate ? new Date(event.endDate) : null;
  const safeEndDate = endDate && !Number.isNaN(endDate.getTime()) && endDate > dueDate
    ? endDate
    : addMinutes(dueDate, 30);

  if (isDateOnlyDueDate(event.dueDate)) {
    return {
      summary: event.title,
      description: event.description,
      start: { date: formatDateOnly(dueDate) },
      end: { date: formatDateOnly(addMinutes(dueDate, 24 * 60)) },
      reminders: event.reminders ?? {
        useDefault: false,
        overrides: [],
      },
      extendedProperties: {
        private: {
          source: 'lembreto',
        },
      },
    };
  }

  return {
    summary: event.title,
    description: event.description,
    start: {
      dateTime: dueDate.toISOString(),
      timeZone: LEMBRETO_TIME_ZONE,
    },
    end: {
      dateTime: safeEndDate.toISOString(),
      timeZone: LEMBRETO_TIME_ZONE,
    },
    reminders: {
      useDefault: false,
      overrides: [],
    },
    extendedProperties: {
      private: {
        source: 'lembreto',
      },
    },
  };
}

async function parseGoogleTokenResponse(response: Response): Promise<CalendarTokenSet> {
  const data = await response.json().catch(() => ({})) as GoogleTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'GOOGLE_CALENDAR_TOKEN_FAILED');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? '',
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
  };
}

async function parseGoogleEventResponse(response: Response): Promise<string> {
  const data = await response.json().catch(() => ({})) as GoogleEventResponse;
  if (!response.ok || !data.id) {
    throw new Error(data.error?.message || 'GOOGLE_CALENDAR_EVENT_FAILED');
  }

  return data.id;
}

function buildDateOnlyDueDate(value: string): string {
  return new Date(`${value}T23:59:00-03:00`).toISOString();
}

function normalizeGoogleEvent(item: NonNullable<GoogleListEventsResponse['items']>[number]): ExternalCalendarEvent | null {
  if (!item.id || item.status === 'cancelled') return null;

  const allDayDate = item.start?.date;
  const dateTime = item.start?.dateTime;
  const dueDate = allDayDate
    ? buildDateOnlyDueDate(allDayDate)
    : dateTime
      ? new Date(dateTime).toISOString()
      : null;

  if (!dueDate || Number.isNaN(new Date(dueDate).getTime())) return null;

  return {
    id: item.id,
    title: item.summary?.trim() || 'Evento sem título',
    description: item.description?.trim() || '',
    dueDate,
    isAllDay: Boolean(allDayDate),
  };
}

export function buildGoogleCalendarAuthorizationUrl(options: {
  state: string;
  redirectUri: string;
}): string {
  const { clientId } = getGoogleCalendarConfig();
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_CALENDAR_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', options.state);
  return url.toString();
}

export const googleCalendarClient: CalendarProviderClient = {
  async exchangeCode(code, redirectUri) {
    const { clientId, clientSecret } = getGoogleCalendarConfig();
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });

    const tokenSet = await parseGoogleTokenResponse(response);
    if (!tokenSet.refreshToken) {
      throw new Error('GOOGLE_CALENDAR_REFRESH_TOKEN_MISSING');
    }

    return tokenSet;
  },

  async refreshTokens(refreshToken) {
    const { clientId, clientSecret } = getGoogleCalendarConfig();
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const tokenSet = await parseGoogleTokenResponse(response);
    return {
      ...tokenSet,
      refreshToken: tokenSet.refreshToken || refreshToken,
    };
  },

  async createEvent(accessToken, calendarId, event) {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API_URL}/calendars/${encodeURIComponent(calendarId || 'primary')}/events`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildGoogleEventPayload(event)),
      },
    );

    return parseGoogleEventResponse(response);
  },

  async updateEvent(accessToken, calendarId, eventId, event) {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API_URL}/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildGoogleEventPayload(event)),
      },
    );

    return parseGoogleEventResponse(response);
  },

  async deleteEvent(accessToken, calendarId, eventId) {
    const response = await fetch(
      `${GOOGLE_CALENDAR_API_URL}/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${encodeURIComponent(eventId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const data = await response.json().catch(() => ({})) as GoogleEventResponse;
      throw new Error(data.error?.message || 'GOOGLE_CALENDAR_DELETE_FAILED');
    }
  },

  async listEvents(accessToken, calendarId, timeMin) {
    const events: ExternalCalendarEvent[] = [];
    let pageToken: string | null = null;

    do {
      const url = new URL(
        `${GOOGLE_CALENDAR_API_URL}/calendars/${encodeURIComponent(calendarId || 'primary')}/events`,
      );
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('showDeleted', 'false');
      url.searchParams.set('maxResults', '250');
      if (timeMin) url.searchParams.set('timeMin', timeMin);
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await response.json().catch(() => ({})) as GoogleListEventsResponse;

      if (!response.ok) {
        throw new Error(data.error?.message || 'GOOGLE_CALENDAR_LIST_FAILED');
      }

      for (const item of data.items ?? []) {
        const event = normalizeGoogleEvent(item);
        if (event) events.push(event);
      }

      pageToken = data.nextPageToken ?? null;
    } while (pageToken && events.length < 500);

    return events;
  },
};
