import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authExchange } from "../../shared/lib/daemon/rest";
import { useAppStore } from "../../shared/stores/app-store";
import { Button } from "../../shared/ui/Button";

export function AuthPage() {
	const [bootstrapToken, setBootstrapToken] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const setToken = useAppStore((s) => s.setToken);
	const navigate = useNavigate();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setLoading(true);

		try {
			const res = await authExchange(bootstrapToken);
			setToken(res.session_token);
			navigate("/");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to authenticate");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="flex items-center justify-center h-full">
			<div className="w-full max-w-sm p-6">
				<h2 className="text-xl font-semibold mb-2">Connect to Loopwire</h2>
				<p className="text-sm text-muted mb-6">
					Enter the bootstrap token from the daemon output, or open the URL it
					printed directly.
				</p>
				<form onSubmit={handleSubmit} className="space-y-4">
					<div>
						<label htmlFor="token" className="block text-sm font-medium mb-1.5">
							Bootstrap Token
						</label>
						<input
							id="token"
							type="text"
							value={bootstrapToken}
							onChange={(e) => setBootstrapToken(e.target.value)}
							placeholder="Paste token here..."
							className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-2 focus:outline-accent"
						/>
					</div>
					{error && (
						<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
					)}
					<Button
						type="submit"
						disabled={!bootstrapToken.trim() || loading}
						className="w-full"
					>
						{loading ? "Connecting..." : "Connect"}
					</Button>
				</form>
			</div>
		</div>
	);
}
