import { useCallback, useEffect, useState } from 'react';

type InstallOutcome = 'accepted' | 'dismissed';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: InstallOutcome; platform: string }>;
  prompt: () => Promise<void>;
}

function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;

  const standaloneMedia = window.matchMedia('(display-mode: standalone)').matches;
  const navigatorStandalone = 'standalone' in window.navigator
    && Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

  return standaloneMedia || navigatorStandalone;
}

function isIosLike() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function getInstallHelpText() {
  if (isStandaloneDisplay()) return 'O Lembreto ja esta instalado neste dispositivo.';

  if (isIosLike()) {
    return 'No Safari, toque em Compartilhar e depois em Adicionar a Tela de Inicio.';
  }

  return 'Se o botao nao aparecer, use o menu do navegador e escolha Instalar app ou Adicionar a tela inicial.';
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(isStandaloneDisplay);
  const [installHelpText, setInstallHelpText] = useState(getInstallHelpText);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setInstallHelpText('Este navegador permite instalar o Lembreto como app.');
    };

    const handleInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
      setInstallHelpText('O Lembreto foi instalado neste dispositivo.');
    };

    const refreshInstallState = () => {
      setIsInstalled(isStandaloneDisplay());
      setInstallHelpText(getInstallHelpText());
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('focus', refreshInstallState);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('focus', refreshInstallState);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;

    if (choice.outcome === 'accepted') {
      setIsInstalled(true);
      setInstallHelpText('O Lembreto foi instalado neste dispositivo.');
    }

    setDeferredPrompt(null);
    return choice.outcome === 'accepted';
  }, [deferredPrompt]);

  return {
    canInstall: Boolean(deferredPrompt),
    isInstalled,
    installHelpText,
    promptInstall,
  };
}
