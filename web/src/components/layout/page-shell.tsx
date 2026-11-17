import type { ReactNode } from "react";
import { DesktopAppBar, type DesktopNavigation } from "@/components/layout/desktop-app-bar";
import { DesktopFooter } from "@/components/layout/desktop-footer";

type PageShellProps = {
  /** Mobile and tablet header; it hides itself from 1024px unless it is the screen's only header. */
  header: ReactNode;
  /** Mobile and tablet tab bar; it hides itself from 1024px. Omitted where the screen has none. */
  nav?: ReactNode;
  /** The desktop app bar's tabs and current tab, or null where the screen has no navigation (Processing). */
  desktop: DesktopNavigation | null;
  /** The page's existing <main> classes; the tab bar's bottom padding is dropped on desktop. */
  mainClassName: string;
  children: ReactNode;
};

/**
 * Every ingest and story screen's frame. Below 1024px: the mobile header,
 * main and the mobile tab bar. From 1024px: the desktop app bar with
 * `desktop`'s tabs, main and the desktop footer (each shell hides itself at
 * the other breakpoints). With `desktop` null there is no desktop bar or
 * footer and `header` stays the only header at every width. The mobile
 * header comes first in DOM order.
 */
export function PageShell({ header, nav, desktop, mainClassName, children }: PageShellProps) {
  return (
    <>
      {header}
      {desktop && <DesktopAppBar navigation={desktop} />}
      <main className={`${mainClassName} lg:pb-0`}>{children}</main>
      {desktop && <DesktopFooter />}
      {nav}
    </>
  );
}
