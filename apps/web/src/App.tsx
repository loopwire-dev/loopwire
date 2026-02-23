import { useState } from "react";
import { useAuth } from "./features/auth/hooks/useAuth";
import { LandingPage } from "./features/landing/components/LandingPage";
import { AppRoutes } from "./routes";
import { useDaemonAvailable } from "./shared/hooks/useDaemonAvailable";
import {
	enableManualDiscovery,
	isManualDiscoveryEnabled,
} from "./shared/lib/runtime/config";

function hasBootstrapTokenInUrl(): boolean {
	if (new URLSearchParams(window.location.search).has("token")) return true;
	const hash = window.location.hash || "";
	const queryIndex = hash.indexOf("?");
	if (queryIndex === -1) return false;
	return new URLSearchParams(hash.slice(queryIndex + 1)).has("token");
}

export function App() {
	const arrivedViaTokenLink = hasBootstrapTokenInUrl();
	const [manualDiscoveryEnabled, setManualDiscoveryEnabled] = useState(
		isManualDiscoveryEnabled,
	);
	const daemonAvailable = useDaemonAvailable({
		allowDiscovery: manualDiscoveryEnabled,
	});
	const pathname = window.location.pathname;
	const isAuthRoute = pathname === "/auth" || pathname === "/connect";

	// Initialize auth — handles URL token extraction.
	useAuth({ daemonAvailable });

	const handleEnableDiscovery = () => {
		enableManualDiscovery();
		setManualDiscoveryEnabled(true);
	};

	// Show landing page only for app routes when daemon is unreachable.
	if (daemonAvailable === false && !isAuthRoute) {
		return (
			<LandingPage
				onEnableDiscovery={handleEnableDiscovery}
				discoveryEnabled={manualDiscoveryEnabled}
				arrivedViaTokenLink={arrivedViaTokenLink}
			/>
		);
	}

	// While probing, render nothing to avoid flash
	if (daemonAvailable === null) {
		return null;
	}

	return (
		<div className="lw-platform h-full">
			<AppRoutes />
		</div>
	);
}
