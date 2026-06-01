"use client";

import { useEffect, useState } from "react";

export interface Me {
  id: string;
  email: string;
  name: string | null;
}

/** Client hook for the current user. `me === undefined` while loading. */
export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => alive && setMe(d.user ?? null))
      .catch(() => alive && setMe(null));
    return () => {
      alive = false;
    };
  }, []);

  return me;
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.assign("/");
}
