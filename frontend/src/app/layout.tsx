export interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return <>{children}</>;
}

export default Layout;
