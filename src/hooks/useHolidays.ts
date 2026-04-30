import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../api/client';
import type { HolidayCalendarPayload, User } from '../types';

export function useHolidays(token: string | null, user: User | null) {
  const [calendar, setCalendar] = useState<HolidayCalendarPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async (requestToken = token) => {
    if (!requestToken) {
      setCalendar(null);
      return null;
    }

    setIsLoading(true);
    try {
      const data = await apiGet<HolidayCalendarPayload>('/api/tasks/holidays', requestToken);
      setCalendar(data);
      return data;
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token || !user) {
      setCalendar(null);
      return;
    }

    void refresh(token).catch(() => {
      setCalendar(null);
    });
  }, [refresh, token, user?.id, user?.stateCode, user?.cityName, user?.holidayRegionCode]);

  return {
    calendar,
    isLoading,
    refresh,
    setCalendar,
  };
}
