import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Baud rate for the scale indicator's serial output.
 *
 * OPERATORS: edit this value to match your indicator's configuration.
 * Most indicators (Rice Lake, Cardinal, Avery Weigh-Tronix…) ship at
 * 9600 8N1 in continuous ASCII mode — see the repo's Startup Guide.
 */
export const SCALE_BAUD_RATE = 9600;

/** How many recent readings are compared to decide "stable". */
const STABLE_WINDOW = 5;
/** Max spread (lbs) across the stable window to flag a stable reading. */
const STABLE_TOLERANCE_LBS = 5;
/** Simulator default: a loaded truck on the scale. */
const SIMULATOR_DEFAULT_BASE_LBS = 45_000;
/** Simulator tick interval (ms). */
const SIMULATOR_TICK_MS = 300;
/** Simulator random-walk band around the base weight (± lbs). */
const SIMULATOR_BAND_LBS = 60;

/* Minimal structural types for the Web Serial API. The DOM lib in this
 * repo does not ship full Web Serial typings and we must not add type
 * packages, so we narrow via these local shapes. */
interface SerialOpenOptions {
  baudRate: number;
  dataBits: number;
  parity: "none" | "even" | "odd";
  stopBits: number;
}

interface SerialPortLike {
  open(options: SerialOpenOptions): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
}

interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}

function getSerial(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { serial?: SerialLike };
  return nav.serial ?? null;
}

/**
 * Extract a weight from one line of indicator output. Handles continuous
 * ASCII frames like `NT 12500 lb`, `ST,GS,+ 12500 lb`, or bare numbers:
 * the LAST numeric token on the line wins. Negatives and zero-padding-only
 * tokens are ignored (a truck never weighs 0 or less).
 */
function parseWeightFromLine(line: string): number | null {
  const tokens = line.match(/[+-]?\d[\d,]*(?:\.\d+)?/g);
  if (!tokens || tokens.length === 0) return null;
  const last = tokens[tokens.length - 1].replace(/,/g, "");
  const value = Number.parseFloat(last);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

export interface ScaleSimulator {
  active: boolean;
  start(): void;
  stop(): void;
  setBaseLbs(lbs: number): void;
}

export interface UseScale {
  /** Browser exposes the Web Serial API (Chrome/Edge, secure context). */
  supported: boolean;
  /** Port request/open handshake in progress. */
  connecting: boolean;
  /** Port open and streaming. */
  connected: boolean;
  /** Latest parsed weight in whole pounds, null before any reading. */
  weightLbs: number | null;
  /** Last ~5 readings within ±5 lbs of each other. */
  stable: boolean;
  /** Human-readable error from the last connect/read failure. */
  error: string | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  simulator: ScaleSimulator;
}

/**
 * Web Serial scale reader + simulator, the heart of the weigh flow.
 * Mount once (e.g. in Dashboard) and feed `weightLbs` into weigh buttons.
 */
export function useScale(): UseScale {
  const supported = getSerial() !== null;

  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [weightLbs, setWeightLbs] = useState<number | null>(null);
  const [stable, setStable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simActive, setSimActive] = useState(false);

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<string> | null>(null);
  const stopReadingRef = useRef(false);
  const readingsRef = useRef<number[]>([]);
  const simTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simBaseRef = useRef(SIMULATOR_DEFAULT_BASE_LBS);
  const simValueRef = useRef(SIMULATOR_DEFAULT_BASE_LBS);

  const pushReading = useCallback((lbs: number) => {
    const history = readingsRef.current;
    history.push(lbs);
    if (history.length > STABLE_WINDOW) history.shift();
    setWeightLbs(lbs);
    if (history.length >= STABLE_WINDOW) {
      const min = Math.min(...history);
      const max = Math.max(...history);
      setStable(max - min <= STABLE_TOLERANCE_LBS);
    } else {
      setStable(false);
    }
  }, []);

  const resetReadings = useCallback(() => {
    readingsRef.current = [];
    setWeightLbs(null);
    setStable(false);
  }, []);

  const disconnect = useCallback(async () => {
    stopReadingRef.current = true;
    const reader = readerRef.current;
    readerRef.current = null;
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        /* stream already torn down */
      }
      try {
        reader.releaseLock();
      } catch {
        /* lock already released */
      }
    }
    const port = portRef.current;
    portRef.current = null;
    if (port) {
      try {
        await port.close();
      } catch {
        /* port already closed */
      }
    }
    setConnected(false);
    setConnecting(false);
  }, []);

  const connect = useCallback(async () => {
    const serial = getSerial();
    if (!serial) {
      setError("Web Serial is not available in this browser. Use Chrome/Edge on HTTPS or localhost.");
      return;
    }
    if (connecting || connected) return;
    setConnecting(true);
    setError(null);
    try {
      const port = await serial.requestPort();
      await port.open({
        baudRate: SCALE_BAUD_RATE,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
      });
      portRef.current = port;
      setConnected(true);
      resetReadings();
      stopReadingRef.current = false;

      if (!port.readable) {
        throw new Error("Scale port opened but is not readable.");
      }
      // TextDecoderStream's BufferSource writable is wider than Uint8Array;
      // the cast is safe — serial only ever delivers Uint8Array chunks.
      const textStream = port.readable.pipeThrough(
        new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>,
      );
      const reader = textStream.getReader();
      readerRef.current = reader;

      // Read loop: buffer raw text, split on newlines, parse each line.
      let buffer = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || stopReadingRef.current) break;
          if (!value) continue;
          buffer += value;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const lbs = parseWeightFromLine(line);
            if (lbs !== null) pushReading(lbs);
          }
        }
      } catch (readErr) {
        if (!stopReadingRef.current) {
          setError(
            readErr instanceof Error
              ? readErr.message
              : "Lost the scale connection.",
          );
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* already released */
        }
        if (!stopReadingRef.current) {
          // Stream ended unexpectedly (cable pulled, device reset).
          portRef.current = null;
          setConnected(false);
          void port.close().catch(() => undefined);
        }
      }
    } catch (err) {
      portRef.current = null;
      setConnected(false);
      if (err instanceof DOMException && err.name === "NotFoundError") {
        // Operator dismissed the port picker — not an error state.
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Failed to connect to the scale.");
      }
    } finally {
      setConnecting(false);
    }
  }, [connecting, connected, pushReading, resetReadings]);

  const simStart = useCallback(() => {
    if (simTimerRef.current !== null) return;
    simValueRef.current = simBaseRef.current;
    setSimActive(true);
    simTimerRef.current = setInterval(() => {
      // Random walk within ±SIMULATOR_BAND_LBS of the base weight.
      const drift = (Math.random() - 0.5) * 14;
      let next = simValueRef.current + drift;
      const lo = simBaseRef.current - SIMULATOR_BAND_LBS;
      const hi = simBaseRef.current + SIMULATOR_BAND_LBS;
      if (next < lo) next = lo + Math.random() * 6;
      if (next > hi) next = hi - Math.random() * 6;
      simValueRef.current = next;
      pushReading(Math.round(next));
    }, SIMULATOR_TICK_MS);
  }, [pushReading]);

  const simStop = useCallback(() => {
    if (simTimerRef.current !== null) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    setSimActive(false);
    setStable(false);
  }, []);

  const simSetBaseLbs = useCallback(
    (lbs: number) => {
      if (!Number.isFinite(lbs) || lbs <= 0) return;
      simBaseRef.current = Math.round(lbs);
    },
    [],
  );

  // Tear everything down on unmount.
  useEffect(() => {
    return () => {
      stopReadingRef.current = true;
      if (simTimerRef.current !== null) {
        clearInterval(simTimerRef.current);
        simTimerRef.current = null;
      }
      const reader = readerRef.current;
      readerRef.current = null;
      if (reader) {
        void reader.cancel().catch(() => undefined);
      }
      const port = portRef.current;
      portRef.current = null;
      if (port) {
        void port.close().catch(() => undefined);
      }
    };
  }, []);

  return {
    supported,
    connecting,
    connected,
    weightLbs,
    stable,
    error,
    connect,
    disconnect,
    simulator: {
      active: simActive,
      start: simStart,
      stop: simStop,
      setBaseLbs: simSetBaseLbs,
    },
  };
}
