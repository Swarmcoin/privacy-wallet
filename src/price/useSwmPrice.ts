import { useEffect, useRef, useState } from "react";
import { price } from "../electronBridge";
import { SwmPricePoller, StorageLike } from "./swmPrice";
import { SWM_PRICE_OFF, SwmPriceState } from "./swmPriceTypes";

const browserStorage = (): StorageLike | null => {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
};

/**
 * The `swmPrice` slice, kept current while `enabled` holds.
 *
 * `enabled` is the caller's whole judgement — setting on, mainnet build,
 * mainnet wallet, wallet open, not locked — and when it is false the poller
 * is stopped and the state is OFF: no request leaves the machine. Within an
 * enabled stretch, polling follows the window: it stops when the document is
 * hidden (minimised, or covered where the OS reports it) and starts again,
 * with one request at once, when it comes back.
 */
export function useSwmPrice(enabled: boolean): SwmPriceState {
  const [state, setState] = useState<SwmPriceState>(SWM_PRICE_OFF);
  const pollerRef = useRef<SwmPricePoller | null>(null);
  if (!pollerRef.current) {
    pollerRef.current = new SwmPricePoller({
      fetchPrice: () => price.swm(),
      onChange: setState,
      storage: browserStorage(),
    });
  }

  useEffect(() => {
    const poller = pollerRef.current;
    if (!poller) return undefined;
    if (!enabled) {
      poller.stop();
      setState(SWM_PRICE_OFF);
      return undefined;
    }
    poller.restore();
    const follow = () => {
      if (document.visibilityState === "hidden") poller.stop();
      else poller.start();
    };
    follow();
    document.addEventListener("visibilitychange", follow);
    return () => {
      document.removeEventListener("visibilitychange", follow);
      poller.stop();
    };
  }, [enabled]);

  return state;
}

export default useSwmPrice;
