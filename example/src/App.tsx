import { type Route, ROUTES, useRoute } from "./route";
import { ErrorsScreen } from "./screens/ErrorsScreen";
import { RefreshScreen } from "./screens/RefreshScreen";

const REPOSITORY_URL = "https://github.com/axtew/tidyfetch";
const NPM_URL = "https://www.npmjs.com/package/tidyfetch";

const SCREENS = {
  refresh: RefreshScreen,
  errors: ErrorsScreen,
};

const TITLES: Record<Route, string> = {
  refresh: "Token refresh",
  errors: "Errors",
};

export function App() {
  const route = useRoute();
  const Screen = SCREENS[route];

  return (
    <div className="page">
      <header className="header">
        <div className="brand">
          <h1>tidyfetch</h1>
          <nav className="links">
            <a href={REPOSITORY_URL}>GitHub</a>
            <a href={NPM_URL}>npm</a>
          </nav>
        </div>
        <p className="tagline">
          A small HTTP client on fetch: typed errors, timeouts, one shared token refresh for
          parallel 401s, optional schema validation.
        </p>
        <p className="hint">
          Everything here runs in your browser: the server is a function passed to{" "}
          <code>createClient</code> as <code>fetch</code>.
        </p>
      </header>
      <nav className="tabs">
        {ROUTES.map((name) => (
          <a key={name} href={`#/${name}`} aria-current={name === route ? "page" : undefined}>
            {TITLES[name]}
          </a>
        ))}
      </nav>
      <main>
        <Screen />
      </main>
      <footer className="footer">
        The page and its fake server: <a href={`${REPOSITORY_URL}/tree/main/example`}>example/</a>
      </footer>
    </div>
  );
}
