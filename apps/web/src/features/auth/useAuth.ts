import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../shared/stores/app-store";
import { api } from "../../shared/lib/api";

export function useAuth() {
  const token = useAppStore((s) => s.token);
  const setToken = useAppStore((s) => s.setToken);
  const exchangingToken = useAppStore((s) => s.exchangingToken);
  const setExchangingToken = useAppStore((s) => s.setExchangingToken);
  const navigate = useNavigate();
  const exchangeStarted = useRef(false);

  useEffect(() => {
    // Guard against StrictMode double-firing
    if (exchangeStarted.current) return;

    const url = new URL(window.location.href);
    const bootstrapToken = url.searchParams.get("token");

    if (bootstrapToken) {
      exchangeStarted.current = true;
      setExchangingToken(true);

      // Remove token from URL
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.pathname + url.search);

      // Exchange bootstrap token for session token
      api
        .post<{ session_token: string }>("/auth/exchange", {
          bootstrap_token: bootstrapToken,
        })
        .then((res) => {
          setToken(res.session_token);
        })
        .catch((err) => {
          console.error("Token exchange failed:", err);
          exchangeStarted.current = false;
          setExchangingToken(false);
          navigate("/auth");
        });
    } else if (!token && !exchangingToken) {
      navigate("/auth");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    token,
    isAuthenticated: !!token,
    logout: async () => {
      try {
        await api.post("/auth/revoke");
      } catch {
        // Best effort
      }
      useAppStore.getState().logout();
      navigate("/auth");
    },
    rotate: async () => {
      const res = await api.post<{ session_token: string }>("/auth/rotate");
      setToken(res.session_token);
    },
  };
}
