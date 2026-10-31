"use client";
import { ThemeProvider } from "./theme-provider";
import { AccountProvider } from "./account-provider";
import { AssistantProvider } from "./assistant/assistant-provider";
export function Providers({ children }) {
  return (
    <ThemeProvider>
      <AccountProvider>
        <AssistantProvider>{children}</AssistantProvider>
      </AccountProvider>
    </ThemeProvider>
  );
}
