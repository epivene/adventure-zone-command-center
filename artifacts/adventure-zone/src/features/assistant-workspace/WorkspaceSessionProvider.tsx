import { createContext, useContext, type ReactNode } from "react";
import { useLocation } from "wouter";

type SessionActions = {
  openProfile(id: string, label?: string): Promise<void>;
  openConversation(id?: string): void;
  expand(): void;
  closePanel(): void;
};
const Context = createContext<SessionActions | null>(null);
export function useWorkspaceSession() {
  const value = useContext(Context);
  if (!value) throw new Error("Assistant session provider is missing");
  return value;
}

/** Preserve profile callers without loading the retired internal AI workspace. */
export function WorkspaceSessionProvider({ children }: { children: ReactNode }) {
  const [, navigate] = useLocation();
  const openConnection = () => navigate("/settings/chatgpt-connection");
  return (
    <Context.Provider value={{
      openProfile: async () => { openConnection(); },
      openConversation: openConnection,
      expand: openConnection,
      closePanel: () => {},
    }}>
      {children}
    </Context.Provider>
  );
}
