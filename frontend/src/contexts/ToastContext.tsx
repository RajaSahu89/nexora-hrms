import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, XCircle } from 'lucide-react';

type T = { id: number; type: 'success' | 'error' | 'info'; msg: string };
const Ctx = createContext<{ toast: (type: T['type'], msg: string) => void }>({ toast: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const toast = useCallback((type: T['type'], msg: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, type, msg }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4000);
  }, []);
  const Icon = { success: CheckCircle2, error: XCircle, info: Info };
  const color = { success: 'text-emerald-500', error: 'text-accent', info: 'text-sky-500' };
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-[min(92vw,22rem)]">
        <AnimatePresence>
          {items.map((t) => {
            const I = Icon[t.type];
            return (
              <motion.div key={t.id} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} className="glass glass-strong px-4 py-3 flex gap-3 items-start text-sm">
                <I className={`w-5 h-5 shrink-0 ${color[t.type]}`} /><span>{t.msg}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
