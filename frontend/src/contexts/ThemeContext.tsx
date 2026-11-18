import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

const Ctx = createContext<{ dark: boolean; toggle: () => void; setDark: (v: boolean) => void }>({ dark: false, toggle: () => {}, setDark: () => {} });
export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    const s = localStorage.getItem('nexora-theme');
    return s ? s === 'dark' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('nexora-theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [dark]);
  return <Ctx.Provider value={{ dark, toggle: () => setDark((d) => !d), setDark }}>{children}</Ctx.Provider>;
}
