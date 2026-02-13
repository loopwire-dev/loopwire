import { useAuth } from "./features/auth/useAuth";
import { AppRoutes } from "./routes";

export function App() {
	// Initialize auth — handles URL token extraction
	useAuth();

	return <AppRoutes />;
}
