import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../shared/lib/api";
import { useAppStore } from "../../shared/stores/app-store";

export function useAuth() {
	const token = useAppStore((s) => s.token);
	const setToken = useAppStore((s) => s.setToken);
	const exchangingToken = useAppStore((s) => s.exchangingToken);
	const setExchangingToken = useAppStore((s) => s.setExchangingToken);
	const navigate = useNavigate();
	const exchangeStarted = useRef(false);

	useEffect(() => {
		const pathname = window.location.pathname;
		const inConnectFlow = pathname === "/connect";

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
					if (!inConnectFlow) {
						navigate("/auth");
					}
				});
		} else if (!token && !exchangingToken && !inConnectFlow) {
			navigate("/auth");
		}
	}, [exchangingToken, navigate, setExchangingToken, setToken, token]);

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
