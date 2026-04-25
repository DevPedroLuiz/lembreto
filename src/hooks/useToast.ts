import { useState, useCallback } from 'react';

export interface ToastMessage {
  title: string;
  message: string;
}

export function useToast() {
  const [toastMsg, setToastMsg] = useState<ToastMessage | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
    return Notification.permission;
  });

  const showToast = useCallback((title: string, message: string) => {
    setToastMsg({ title, message });
    setTimeout(() => setToastMsg(null), 4000);
  }, []);

  const notify = useCallback(
    (title: string, body: string) => {
      if (notifPerm === 'granted' && 'Notification' in window) {
        new Notification(title, { body });
      }
      showToast(title, body);
    },
    [notifPerm, showToast]
  );

  const requestPermission = useCallback(async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      setNotifPerm(perm);
    } else if ('Notification' in window) {
      setNotifPerm(Notification.permission);
    }
  }, []);

  return { toastMsg, setToastMsg, notify, showToast, notifPerm, requestPermission };
}
