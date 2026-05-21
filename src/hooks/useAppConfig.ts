import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_NO_TIME_REMINDER_MINUTES,
  normalizeNoTimeReminderMinutes,
} from '../lib/taskDueDate';
import { LS, type AppConfig } from '../lib/storage';

type AppConfigPatch = Partial<{
  darkMode: boolean;
  notifications: boolean;
  desktopNotifications: boolean;
  sound: boolean;
  confirmDelete: boolean;
  showCompleted: boolean;
  noTimeReminderMinutes: number;
}>;

export function useAppConfig() {
  const [darkMode, setDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useState(false);
  const [configSound, setConfigSound] = useState(true);
  const [configConfirmDelete, setConfigConfirmDelete] = useState(true);
  const [configShowCompleted, setConfigShowCompleted] = useState(true);
  const [configNoTimeReminderMinutes, setConfigNoTimeReminderMinutes] = useState(DEFAULT_NO_TIME_REMINDER_MINUTES);

  useEffect(() => {
    const cfg = LS.getConfig();
    if (typeof cfg.darkMode === 'boolean') setDarkMode(cfg.darkMode);
    if (typeof cfg.notifications === 'boolean') setNotificationsEnabled(cfg.notifications);
    if (typeof cfg.desktopNotifications === 'boolean') setDesktopNotificationsEnabled(cfg.desktopNotifications);
    if (typeof cfg.sound === 'boolean') setConfigSound(cfg.sound);
    if (typeof cfg.confirmDelete === 'boolean') setConfigConfirmDelete(cfg.confirmDelete);
    if (typeof cfg.showCompleted === 'boolean') setConfigShowCompleted(cfg.showCompleted);
    setConfigNoTimeReminderMinutes(normalizeNoTimeReminderMinutes(cfg.noTimeReminderMinutes));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const saveConfig = useCallback((patch: AppConfigPatch) => {
    const persistedConfig = LS.getConfig();
    const current: AppConfig = {
      darkMode,
      notifications: notificationsEnabled,
      desktopNotifications: desktopNotificationsEnabled,
      sound: configSound,
      confirmDelete: configConfirmDelete,
      showCompleted: configShowCompleted,
      noTimeReminderMinutes: configNoTimeReminderMinutes,
    };
    const next = { ...persistedConfig, ...current, ...patch };

    LS.saveConfig(next);
    setDarkMode(next.darkMode ?? darkMode);
    setNotificationsEnabled(next.notifications ?? notificationsEnabled);
    setDesktopNotificationsEnabled(next.desktopNotifications ?? desktopNotificationsEnabled);
    setConfigSound(next.sound ?? configSound);
    setConfigConfirmDelete(next.confirmDelete ?? configConfirmDelete);
    setConfigShowCompleted(next.showCompleted ?? configShowCompleted);
    setConfigNoTimeReminderMinutes(normalizeNoTimeReminderMinutes(next.noTimeReminderMinutes));
  }, [
    configConfirmDelete,
    configNoTimeReminderMinutes,
    configShowCompleted,
    configSound,
    darkMode,
    desktopNotificationsEnabled,
    notificationsEnabled,
  ]);

  const toggleDarkMode = useCallback(() => {
    saveConfig({ darkMode: !darkMode });
  }, [darkMode, saveConfig]);

  return {
    darkMode,
    notificationsEnabled,
    setNotificationsEnabled,
    desktopNotificationsEnabled,
    configSound,
    configConfirmDelete,
    configShowCompleted,
    configNoTimeReminderMinutes,
    saveConfig,
    toggleDarkMode,
  };
}
