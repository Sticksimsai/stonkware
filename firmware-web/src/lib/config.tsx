"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useApi } from "./hooks";
import { setCluster } from "./api";
import type { Config } from "./types";

const Ctx = createContext<Config | null>(null);
export function ConfigProvider({ children }: { children: ReactNode }) {
  const { data } = useApi<Config>("/api/config");
  setCluster(data?.cluster);
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}
export const useConfig = () => useContext(Ctx);
