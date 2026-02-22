import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../shared/lib/api";
import { useAppStore } from "../../shared/stores/app-store";
import { Button } from "../../shared/ui/Button";
import { LoopwireSpinner } from "../../shared/ui/LoopwireSpinner";

const TRUSTED_DEVICES_KEY = "loopwire_trusted_devices";

interface InviteBootstrapResponse {
	host_id: string;
	pin_required: boolean;
	expires_at: string;
}

interface InviteExchangeResponse {
	session_token: string;
	trusted_device_token?: string;
	trusted_device_expires_at?: string;
}

interface TrustedDeviceEntry {
	token: string;
	expiresAt: string;
}

function loadTrustedDevices(): Record<string, TrustedDeviceEntry> {
	try {
		const raw = localStorage.getItem(TRUSTED_DEVICES_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return {};
		return parsed as Record<string, TrustedDeviceEntry>;
	} catch {
		return {};
	}
}

function persistTrustedDevices(devices: Record<string, TrustedDeviceEntry>) {
	localStorage.setItem(TRUSTED_DEVICES_KEY, JSON.stringify(devices));
}

function getTrustedDeviceToken(hostId: string): string | null {
	const devices = loadTrustedDevices();
	const entry = devices[hostId];
	if (!entry?.token || !entry.expiresAt) return null;

	const expiresAt = Date.parse(entry.expiresAt);
	if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
		delete devices[hostId];
		persistTrustedDevices(devices);
		return null;
	}

	return entry.token;
}

function storeTrustedDeviceToken(
	hostId: string,
	token: string,
	expiresAt: string,
) {
	const devices = loadTrustedDevices();
	devices[hostId] = { token, expiresAt };
	persistTrustedDevices(devices);
}

export function ConnectPage() {
	const navigate = useNavigate();
	const setToken = useAppStore((s) => s.setToken);

	const params = useMemo(() => new URLSearchParams(window.location.search), []);
	const inviteToken = params.get("invite")?.trim() ?? "";

	const [hostId, setHostId] = useState<string | null>(null);
	const [pinRequired, setPinRequired] = useState(false);
	const [pin, setPin] = useState("");
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!inviteToken) {
			setError("Missing invite token in the connection link.");
			setLoading(false);
			return;
		}

		let cancelled = false;

		const run = async () => {
			setLoading(true);
			setError(null);
			try {
				const bootstrap = await api.post<InviteBootstrapResponse>(
					"/remote/invite/bootstrap",
					{ invite_token: inviteToken },
				);

				if (cancelled) return;

				setHostId(bootstrap.host_id);
				setPinRequired(bootstrap.pin_required);

				if (bootstrap.pin_required) {
					const trusted = getTrustedDeviceToken(bootstrap.host_id);
					if (trusted) {
						await exchange(inviteToken, bootstrap.host_id, null, trusted);
						return;
					}
					setLoading(false);
					return;
				}

				await exchange(inviteToken, bootstrap.host_id, null, null);
			} catch (err) {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Failed to connect");
				setLoading(false);
			}
		};

		void run();

		return () => {
			cancelled = true;
		};
	}, [inviteToken]);

	async function exchange(
		invite: string,
		currentHostId: string,
		providedPin: string | null,
		trustedToken: string | null,
	) {
		setSubmitting(true);
		setError(null);

		try {
			const response = await api.post<InviteExchangeResponse>(
				"/remote/invite/exchange",
				{
					invite_token: invite,
					pin: providedPin,
					trusted_device_token: trustedToken,
				},
			);

			if (
				response.trusted_device_token &&
				response.trusted_device_expires_at &&
				currentHostId
			) {
				storeTrustedDeviceToken(
					currentHostId,
					response.trusted_device_token,
					response.trusted_device_expires_at,
				);
			}

			setToken(response.session_token);
			navigate("/", { replace: true });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to authenticate");
			setSubmitting(false);
			setLoading(false);
		}
	}

	const showPinForm = !loading && pinRequired;

	return (
		<div className="flex items-center justify-center h-full">
			<div className="w-full max-w-sm p-6">
				<h2 className="text-xl font-semibold mb-2">Connect to Loopwire</h2>
				{loading && (
					<div className="mb-3 inline-flex items-center gap-2 text-sm text-muted">
						<LoopwireSpinner size={18} label="Validating connection link" />
						<span>Validating your connection link...</span>
					</div>
				)}
				<p className="text-sm text-muted mb-6">
					{loading
						? "Secure handshake in progress."
						: "Enter the connection PIN if required to finish linking this device."}
				</p>

				{showPinForm && (
					<form
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (!hostId) return;
							void exchange(inviteToken, hostId, pin, null);
						}}
					>
						<div>
							<label htmlFor="pin" className="block text-sm font-medium mb-1.5">
								Connection PIN
							</label>
							<input
								id="pin"
								type="password"
								value={pin}
								onChange={(e) => setPin(e.target.value)}
								placeholder="Enter PIN"
								className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-2 focus:outline-accent"
							/>
						</div>
						<Button
							type="submit"
							disabled={!pin.trim() || submitting}
							className="w-full"
						>
							{submitting ? (
								<span className="inline-flex items-center gap-2">
									<LoopwireSpinner size={14} decorative />
									<span>Connecting...</span>
								</span>
							) : (
								"Connect"
							)}
						</Button>
					</form>
				)}

				{error && (
					<p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>
				)}
			</div>
		</div>
	);
}
