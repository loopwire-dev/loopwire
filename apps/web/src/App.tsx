import { useState } from "react";
import { useAuth } from "./features/auth/useAuth";
import { LandingPage } from "./features/landing/LandingPage";
import { AppRoutes } from "./routes";
import { useDaemonAvailable } from "./shared/hooks/useDaemonAvailable";
import {
	enableManualDiscovery,
	isManualDiscoveryEnabled,
} from "./shared/lib/config";

export function App() {
	// Initialize auth — handles URL token extraction
	useAuth();

	const [manualDiscoveryEnabled, setManualDiscoveryEnabled] = useState(
		isManualDiscoveryEnabled,
	);
	const daemonAvailable = useDaemonAvailable({
		allowDiscovery: manualDiscoveryEnabled,
	});

	const handleEnableDiscovery = () => {
		enableManualDiscovery();
		setManualDiscoveryEnabled(true);
	};

	// Show landing page when no daemon is reachable and no explicit backend is configured
	if (daemonAvailable === false) {
		return (
			<LandingPage
				onEnableDiscovery={handleEnableDiscovery}
				discoveryEnabled={manualDiscoveryEnabled}
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
