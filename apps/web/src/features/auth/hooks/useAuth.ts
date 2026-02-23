import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
	authExchange,
	authRevoke,
	authRotate,
} from "../../../shared/lib/daemon/rest";
import { useAppStore } from "../../../shared/stores/app-store";

interface UseAuthOptions {
	daemonAvailable?: boolean | null;
}

function getBootstrapTokenFromUrl(): string | null {
	const fromSearch = new URLSearchParams(window.location.search).get("token");
	if (fromSearch) return fromSearch;

	// Support token links that may end up in hash-based URLs.
	const hash = window.location.hash || "";
	const queryIndex = hash.indexOf("?");
	if (queryIndex === -1) return null;
	return new URLSearchParams(hash.slice(queryIndex + 1)).get("token");
}

function removeBootstrapTokenFromUrl(): void {
	const url = new URL(window.location.href);
	let didChange = false;
	if (url.searchParams.has("token")) {
		url.searchParams.delete("token");
		didChange = true;
	}

	const hash = window.location.hash || "";
	const queryIndex = hash.indexOf("?");
	if (queryIndex !== -1) {
		const hashPath = hash.slice(0, queryIndex);
		const hashParams = new URLSearchParams(hash.slice(queryIndex + 1));
		if (hashParams.has("token")) {
			hashParams.delete("token");
			const nextHashQuery = hashParams.toString();
			url.hash = nextHashQuery ? `${hashPath}?${nextHashQuery}` : hashPath;
			didChange = true;
		}
	}

	if (didChange) {
		window.history.replaceState({}, "", url.pathname + url.search + url.hash);
	}
}

export function useAuth(options: UseAuthOptions = {}) {
	const { daemonAvailable = true } = options;
	const token = useAppStore((s) => s.token);
	const setToken = useAppStore((s) => s.setToken);
	const exchangingToken = useAppStore((s) => s.exchangingToken);
	const setExchangingToken = useAppStore((s) => s.setExchangingToken);
	const navigate = useNavigate();
	const exchangeStarted = useRef(false);
	const lastAttemptedBootstrapToken = useRef<string | null>(null);

	useEffect(() => {
		const pathname = window.location.pathname;
		const inConnectFlow = pathname === "/connect";
		const bootstrapToken = getBootstrapTokenFromUrl();

		if (bootstrapToken && daemonAvailable !== true) {
			// Keep waiting on landing/discovery until daemon becomes reachable.
			setExchangingToken(true);
			return;
		}

		if (
			bootstrapToken &&
			!exchangeStarted.current &&
			lastAttemptedBootstrapToken.current !== bootstrapToken
		) {
			exchangeStarted.current = true;
			lastAttemptedBootstrapToken.current = bootstrapToken;
			setExchangingToken(true);

			// Exchange bootstrap token for session token
			authExchange(bootstrapToken)
				.then((res) => {
					setToken(res.session_token);
					removeBootstrapTokenFromUrl();
					if (pathname === "/auth") {
						navigate("/");
					}
				})
				.catch((err) => {
					console.error("Token exchange failed:", err);
					exchangeStarted.current = false;
					setExchangingToken(false);
					if (!inConnectFlow) {
						navigate("/auth");
					}
				});
		} else if (
			!token &&
			!exchangingToken &&
			!inConnectFlow &&
			!bootstrapToken &&
			daemonAvailable === true
		) {
			navigate("/auth");
		}
	}, [
		daemonAvailable,
		exchangingToken,
		navigate,
		setExchangingToken,
		setToken,
		token,
	]);

	return {
		token,
		isAuthenticated: !!token,
		logout: async () => {
			try {
				await authRevoke();
			} catch {
				// Best effort
			}
			useAppStore.getState().logout();
			navigate("/auth");
		},
		rotate: async () => {
			const res = await authRotate();
			setToken(res.session_token);
		},
	};
}
