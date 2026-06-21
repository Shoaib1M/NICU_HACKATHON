/**
 * src/hooks/useWebSocket.js — NICU Guardian
 *
 * Reconnecting WebSocket hook.
 * Used by:
 *   - useAudioPipeline  → /ws/audio  (send frames)
 *   - Dashboard         → /ws/stress (receive updates)
 *   - Dashboard         → /ws/alerts (receive agent alerts)
 *   - VisualPipeline    → /ws/visual (send frames)
 */

import { useEffect, useRef, useCallback, useState } from 'react';

const BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';
const RETRY_DELAY_MS = 2000;

/**
 * @param {string}   path          WebSocket path, e.g. '/ws/stress'
 * @param {function} onMessage     Called with parsed JSON on every non-ping message
 * @param {boolean}  [auto=true]   Connect automatically on mount
 * @returns {{ status: string, send: function, disconnect: function }}
 */
export function useWebSocket(path, onMessage, auto = true) {
  const wsRef    = useRef(null);
  const retryRef = useRef(null);
  const cbRef    = useRef(onMessage);  // keep latest callback without re-connecting

  const [status, setStatus] = useState('disconnected');

  // Keep callback ref fresh
  useEffect(() => { cbRef.current = onMessage; }, [onMessage]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    const url    = `${BASE}${path}`;
    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => {
      setStatus('connected');
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    };

    socket.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type !== 'ping') cbRef.current(msg);
      } catch { /* malformed JSON — ignore */ }
    };

    socket.onerror = (e) => console.error(`[WS] error on ${path}`, e);

    socket.onclose = ({ code }) => {
      setStatus('disconnected');
      if (code !== 1000) {
        // Abnormal close — schedule reconnect
        retryRef.current = setTimeout(connect, RETRY_DELAY_MS);
      }
    };
  }, [path]);

  const disconnect = useCallback(() => {
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    wsRef.current?.close(1000, 'unmount');
    setStatus('disconnected');
  }, []);

  const send = useCallback((payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    if (auto) connect();
    return disconnect;
  }, [auto, connect, disconnect]);

  return { status, send, connect, disconnect };
}
