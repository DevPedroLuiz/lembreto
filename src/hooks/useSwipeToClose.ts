import { useCallback, useMemo, useRef, useState, type PointerEvent } from 'react';

type SwipeDirection = 'down' | 'right';

interface SwipeToCloseOptions {
  enabled: boolean;
  direction: SwipeDirection;
  onClose: () => void;
  locked?: boolean;
  threshold?: number;
}

function isTouchPointer(event: PointerEvent<HTMLElement>) {
  return event.pointerType === 'touch' || event.pointerType === 'pen';
}

export function useSwipeToClose({
  enabled,
  direction,
  onClose,
  locked = false,
  threshold = 84,
}: SwipeToCloseOptions) {
  const pointerIdRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const mobileEnabled = useMemo(() => {
    if (!enabled || typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  }, [enabled]);

  const reset = useCallback(() => {
    pointerIdRef.current = null;
    startRef.current = null;
    setOffset(0);
    setIsDragging(false);
  }, []);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!mobileEnabled || locked || !isTouchPointer(event)) return;

    pointerIdRef.current = event.pointerId;
    startRef.current = direction === 'down' ? event.clientY : event.clientX;
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [direction, locked, mobileEnabled]);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (
      !mobileEnabled ||
      locked ||
      pointerIdRef.current !== event.pointerId ||
      startRef.current === null
    ) {
      return;
    }

    const rawDelta = direction === 'down'
      ? event.clientY - startRef.current
      : event.clientX - startRef.current;

    if (rawDelta <= 0) {
      setOffset(0);
      return;
    }

    setOffset(rawDelta);
  }, [direction, locked, mobileEnabled]);

  const handlePointerEnd = useCallback((event: PointerEvent<HTMLElement>) => {
    if (pointerIdRef.current !== event.pointerId) return;

    const shouldClose = offset >= threshold;
    reset();
    if (shouldClose && !locked) onClose();
  }, [locked, offset, onClose, reset, threshold]);

  return {
    offset,
    isDragging,
    mobileEnabled,
    bind: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerEnd,
      onPointerCancel: handlePointerEnd,
    },
  };
}
