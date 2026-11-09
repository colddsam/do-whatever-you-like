import type Lenis from "lenis";

/** The page's single Lenis instance, so menus can pause smooth scrolling while open. */
let instance: Lenis | null = null;

export const setLenis = (lenis: Lenis | null) => {
  instance = lenis;
};

export const getLenis = () => instance;
