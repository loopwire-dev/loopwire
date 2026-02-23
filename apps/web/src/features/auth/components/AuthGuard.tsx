import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAppStore } from "../../../shared/stores/app-store";

export function AuthGuard({ children }: { children: ReactNode }) {
	const token = useAppStore((s) => s.token);
	const exchangingToken = useAppStore((s) => s.exchangingToken);

	if (exchangingToken) {
		return null;
	}

	if (!token) {
		return <Navigate to="/auth" replace />;
	}

	return <>{children}</>;
}
