import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/** Whether the side menu is showing. One place, so the top bar's button and the menu itself agree. */
const NavContext = createContext({ open: false, show() {}, hide() {}, toggle() {} });

export function NavProvider({ children }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []), hide = useCallback(() => setOpen(false), []), toggle = useCallback(() => setOpen(v => !v), []);
  const value = useMemo(() => ({ open, show, hide, toggle }), [open, show, hide, toggle]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export const useNav = () => useContext(NavContext);
