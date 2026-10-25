import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCard } from "@/features/auth/components/auth-card";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Anmelden" };

export default function LoginPage() {
  const configured = getSupabaseConfig() !== null;

  return (
    <AuthCard
      title="Anmelden"
      description="Mit E-Mail und Passwort, danach mit dem zweiten Faktor."
    >
      <Suspense>
        <LoginForm configured={configured} />
      </Suspense>
    </AuthCard>
  );
}
