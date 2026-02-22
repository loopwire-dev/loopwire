import { Route, Routes } from "react-router-dom";
import { AuthGuard } from "./features/auth/AuthGuard";
import { AuthPage } from "./features/auth/AuthPage";
import { ConnectPage } from "./features/auth/ConnectPage";
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
