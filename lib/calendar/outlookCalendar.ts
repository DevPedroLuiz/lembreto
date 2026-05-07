import { addMinutes, formatDateOnly, isDateOnlyDueDate, LEMBRETO_TIME_ZONE } from './eventPayload.js';
import type {
  CalendarEventInput,
  CalendarProviderClient,
  CalendarTokenSet,
  ExternalCalendarEvent,
} from './types.js';

const OUTLOOK_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const OUTLOOK_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MICROSOFT_GRAPH_URL = 'https://graph.microsoft.com/v1.0';
const OUTLOOK_CALENDAR_SCOPE = 'offline_access Calendars.ReadWrite';

interface OutlookTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface OutlookEventResponse {
  id?: string;
  error?: {
    message?: string;
  };
}

interface OutlookListEventsResponse {
  value?: Array<{
    id?: string;
    subject?: string;
    bodyPreview?: string;
    isCancelled?: boolean;
    isAllDay?: boolean;
    start?: {
      dateTime?: string;
      timeZone?: string;
    };
  }>;
  '@odata.nextLink'?: string;
  error?: {
    message?: string;
  };
}

function getOutlookConfig() {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('OUTLOOK_CALENDAR_NOT_CONFIGURED');
  }

  return { clientId, clientSecret };
}

function buildOutlookEventPayload(event: CalendarEventInput) {
  const dueDate = new Date(event.dueDate);
  const endDate = event.endDate ? new Date(event.endDate) : null;
  const safeEndDate = endDate && !Number.isNaN(endDate.getTime()) && endDate > dueDate
    ? endDate
    : addMinutes(dueDate, 30);

  if (isDateOnlyDueDate(event.dueDate)) {
    return {
      subject: event.title,
      body: {
        contentType: 'text',
        content: event.description,
      },
      isAllDay: true,
      start: {
        dateTime: `${formatDateOnly(dueDate)}T00:00:00`,
        timeZone: LEMBRETO_TIME_ZONE,
      },
      end: {
        dateTime: `${formatDateOnly(addMinutes(dueDate, 24 * 60))}T00:00:00`,
        timeZone: LEMBRETO_TIME_ZONE,
      },
      categories: [event.category, ...event.tags].filter(Boolean),
      reminderMinutesBeforeStart: 15,
      isReminderOn: false,
    };
  }

  return {
    subject: event.title,
    body: {
      contentType: 'text',
      content: event.description,
    },
    start: {
      dateTime: dueDate.toISOString(),
      timeZone: 'UTC',
    },
    end: {
      dateTime: safeEndDate.toISOString(),
      timeZone: 'UTC',
    },
    categories: [event.category, ...event.tags].filter(Boolean),
    reminderMinutesBeforeStart: 15,
    isReminderOn: true,
  };
}

async function parseOutlookTokenResponse(response: Response): Promise<CalendarTokenSet> {
  const data = await response.json().catch(() => ({})) as OutlookTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'OUTLOOK_CALENDAR_TOKEN_FAILED');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? '',
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
  };
}

async function parseOutlookEventResponse(response: Response): Promise<string> {
  const data = await response.json().catch(() => ({})) as OutlookEventResponse;
  if (!response.ok || !data.id) {
    throw new Error(data.error?.message || 'OUTLOOK_CALENDAR_EVENT_FAILED');
  }

  return data.id;
}

function getEventsUrl(calendarId: string, eventId?: string) {
  const base = calendarId && calendarId !== 'primary'
    ? `${MICROSOFT_GRAPH_URL}/me/calendars/${encodeURIComponent(calendarId)}/events`
    : `${MICROSOFT_GRAPH_URL}/me/events`;

  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

function buildDateOnlyDueDate(value: string): string {
  return new Date(`${value.slice(0, 10)}T23:59:00-03:00`).toISOString();
}

function normalizeOutlookDateTime(value: string): string {
  return /(?:z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`;
}

function normalizeOutlookEvent(item: NonNullable<OutlookListEventsResponse['value']>[number]): ExternalCalendarEvent | null {
  if (!item.id || item.isCancelled) return null;

  const rawDateTime = item.start?.dateTime;
  if (!rawDateTime) return null;

  const dueDate = item.isAllDay
    ? buildDateOnlyDueDate(rawDateTime)
    : new Date(normalizeOutlookDateTime(rawDateTime)).toISOString();

  if (Number.isNaN(new Date(dueDate).getTime())) return null;

  return {
    id: item.id,
    title: item.subject?.trim() || 'Evento sem título',
    description: item.bodyPreview?.trim() || '',
    dueDate,
    isAllDay: Boolean(item.isAllDay),
  };
}

export function buildOutlookCalendarAuthorizationUrl(options: {
  state: string;
  redirectUri: string;
}): string {
  const { clientId } = getOutlookConfig();
  const url = new URL(OUTLOOK_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', OUTLOOK_CALENDAR_SCOPE);
  url.searchParams.set('state', options.state);
  return url.toString();
}

export const outlookCalendarClient: CalendarProviderClient = {
  async exchangeCode(code, redirectUri) {
    const { clientId, clientSecret } = getOutlookConfig();
    const response = await fetch(OUTLOOK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        scope: OUTLOOK_CALENDAR_SCOPE,
      }),
    });

    const tokenSet = await parseOutlookTokenResponse(response);
    if (!tokenSet.refreshToken) {
      throw new Error('OUTLOOK_CALENDAR_REFRESH_TOKEN_MISSING');
    }

    return tokenSet;
  },

  async refreshTokens(refreshToken) {
    const { clientId, clientSecret } = getOutlookConfig();
    const response = await fetch(OUTLOOK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: OUTLOOK_CALENDAR_SCOPE,
      }),
    });

    const tokenSet = await parseOutlookTokenResponse(response);
    return {
      ...tokenSet,
      refreshToken: tokenSet.refreshToken || refreshToken,
    };
  },

  async createEvent(accessToken, calendarId, event) {
    const response = await fetch(getEventsUrl(calendarId), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildOutlookEventPayload(event)),
    });

    return parseOutlookEventResponse(response);
  },

  async updateEvent(accessToken, calendarId, eventId, event) {
    const response = await fetch(getEventsUrl(calendarId, eventId), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildOutlookEventPayload(event)),
    });

    return parseOutlookEventResponse(response);
  },

  async deleteEvent(accessToken, calendarId, eventId) {
    const response = await fetch(getEventsUrl(calendarId, eventId), {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const data = await response.json().catch(() => ({})) as OutlookEventResponse;
      throw new Error(data.error?.message || 'OUTLOOK_CALENDAR_DELETE_FAILED');
    }
  },

  async listEvents(accessToken, calendarId, timeMin) {
    const events: ExternalCalendarEvent[] = [];
    let url: string | null = getEventsUrl(calendarId);
    const params = new URLSearchParams({ $top: '50' });
    if (timeMin) {
      params.set('$filter', `start/dateTime ge '${timeMin}'`);
      params.set('$orderby', 'start/dateTime');
    }
    url += `${url.includes('?') ? '&' : '?'}${params.toString()}`;

    while (url && events.length < 500) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: `outlook.timezone="${LEMBRETO_TIME_ZONE}"`,
        },
      });
      const data = await response.json().catch(() => ({})) as OutlookListEventsResponse;

      if (!response.ok) {
        throw new Error(data.error?.message || 'OUTLOOK_CALENDAR_LIST_FAILED');
      }

      for (const item of data.value ?? []) {
        const event = normalizeOutlookEvent(item);
        if (event) events.push(event);
      }

      url = data['@odata.nextLink'] ?? null;
    }

    return events;
  },
};
