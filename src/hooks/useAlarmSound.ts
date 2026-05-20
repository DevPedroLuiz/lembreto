import { useCallback, useRef } from 'react';

export function useAlarmSound(soundEnabled: boolean) {
  const alarmSoundStopRef = useRef<(() => void) | null>(null);

  const playSuccessSound = useCallback(() => {
    if (!soundEnabled) return;

    try {
      const audioContext = window.AudioContext || (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

      if (!audioContext) return;

      const ctx = new audioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // best effort sound
    }
  }, [soundEnabled]);

  const stopAlarmSound = useCallback(() => {
    alarmSoundStopRef.current?.();
    alarmSoundStopRef.current = null;
  }, []);

  const startAlarmSound = useCallback(() => {
    stopAlarmSound();

    try {
      const audioContext = window.AudioContext || (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

      if (!audioContext) return;

      const ctx = new audioContext();
      let stopped = false;
      let activeOscillator: OscillatorNode | null = null;
      let activeGain: GainNode | null = null;

      const playPulse = () => {
        if (stopped) return;

        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => undefined);
        }

        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, ctx.currentTime);
        oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.16);
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.32, ctx.currentTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);

        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.5);
        activeOscillator = oscillator;
        activeGain = gain;
      };

      playPulse();
      const pulseInterval = window.setInterval(playPulse, 1000);

      alarmSoundStopRef.current = () => {
        stopped = true;
        window.clearInterval(pulseInterval);
        try {
          activeOscillator?.stop();
        } catch {
          // oscillator may already be stopped
        }
        activeOscillator?.disconnect();
        activeGain?.disconnect();
        void ctx.close().catch(() => undefined);
      };
    } catch {
      // alarm sound is best effort; the visible alarm stays available.
    }
  }, [stopAlarmSound]);

  return {
    playSuccessSound,
    startAlarmSound,
    stopAlarmSound,
  };
}
