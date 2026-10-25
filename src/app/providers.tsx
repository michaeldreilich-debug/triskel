"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/toast";
import { makeQueryClient } from "@/lib/query-client";
import type { UiPrefs } from "@/lib/ui-prefs";
import { UiStoreProvider } from "@/lib/ui-store";

export function Providers({ ui, children }: { ui: UiPrefs; children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <UiStoreProvider initial={ui}>
        {children}
        <Toaster />
      </UiStoreProvider>
    </QueryClientProvider>
  );
}
