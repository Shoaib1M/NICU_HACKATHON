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
const MAX_RETRY_DELAY_MS = 15000;

/**
 * @param {string}   path          WebSocket path, e.g. '/ws/stress'
 * @param {function} onMessage     Called with parsed JSON on every non-ping message
 * @param {boolean}  [auto=true]   Connect automatically on mount
 * @returns {{ status: string, send: function, disconnect: function }}
 */
export function useWebSocket(path, onMessage, auto = true) {
  const wsRef        = useRef(null);
  const retryRef     = useRef(null);
  const connectingRef = useRef(false);  // prevent stacked connection attempts
  const retryDelay   = useRef(RETRY_DELAY_MS);
  const unmountedRef = useRef(false);
  const cbRef        = useRef(onMessage);  // keep latest callback without re-connecting

  const [status, setStatus] = useState('disconnected');

  // Keep callback ref fresh
  useEffect(() => { cbRef.current = onMessage; }, [onMessage]);

  const connect = useCallback(() => {
    // Guard: don't stack connection attempts
    if (unmountedRef.current) return;
    if (connectingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    connectingRef.current = true;

    // Clear any pending retry timer
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }

    setStatus('connecting');
    const url = `${BASE}${path}`;

    let socket;
    try {
      socket = new WebSocket(url);
    } catch (err) {
      console.error(`[WS] Failed to create WebSocket for ${path}:`, err);
      connectingRef.current = false;
      setStatus('disconnected');
      // Schedule retry with backoff
      retryRef.current = setTimeout(connect, retryDelay.current);
      retryDelay.current = Math.min(retryDelay.current * 1.5, MAX_RETRY_DELAY_MS);
      return;
    }

    wsRef.current = socket;

    socket.onopen = () => {
      if (unmountedRef.current) { socket.close(1000); return; }
      connectingRef.current = false;
      retryDelay.current = RETRY_DELAY_MS;  // reset backoff on success
      setStatus('connected');
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    };

    socket.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type !== 'ping') cbRef.current(msg);
      } catch { /* malformed JSON — ignore */ }
    };

    socket.onerror = () => {
      // onerror is always followed by onclose — actual retry happens there
    };

    socket.onclose = ({ code }) => {
      connectingRef.current = false;
      wsRef.current = null;  // clear stale ref so guards work correctly
      if (unmountedRef.current) return;
      setStatus('disconnected');
      if (code !== 1000) {
        // Abnormal close or connection failure — schedule reconnect with backoff
        retryRef.current = setTimeout(connect, retryDelay.current);
        retryDelay.current = Math.min(retryDelay.current * 1.5, MAX_RETRY_DELAY_MS);
      }
    };
  }, [path]);

  const disconnect = useCallback(() => {
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    connectingRef.current = false;
    if (wsRef.current) {
      wsRef.current.close(1000, 'unmount');
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  const send = useCallback((payload) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    if (auto) connect();
    return () => {
      unmountedRef.current = true;
      disconnect();
    };
  }, [auto, connect, disconnect]);

  return { status, send, connect, disconnect };
}
