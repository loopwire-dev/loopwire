import { Route, Routes } from "react-router-dom";
import { AuthGuard } from "./features/auth/components/AuthGuard";
import { AuthPage } from "./features/auth/components/AuthPage";
import { ConnectPage } from "./features/auth/components/ConnectPage";
import { AppLayout } from "./shared/layout/AppLayout";

export function AppRoutes() {
	return (
		<Routes>
			<Route path="/auth" element={<AuthPage />} />
			<Route path="/connect" element={<ConnectPage />} />
			<Route
				path="*"
				element={
					<AuthGuard>
						<AppLayout />
					</AuthGuard>
				}
			/>
		</Routes>
	);
}
