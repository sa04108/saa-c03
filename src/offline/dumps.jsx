import { createRoot } from "react-dom/client";
import { ThemeProvider } from "../components/theme-provider";
import { AccountProvider } from "../components/account-provider";
import { DumpsPage } from "../components/study/dumps-page";
let embedded;
try {
  embedded = JSON.parse(document.getElementById("saved-progress").textContent);
} catch {}
createRoot(document.getElementById("offline-root")).render(
  <ThemeProvider>
    <AccountProvider offline>
      <DumpsPage embedded={embedded} />
    </AccountProvider>
  </ThemeProvider>,
);
