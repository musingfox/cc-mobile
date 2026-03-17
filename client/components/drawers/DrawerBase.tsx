import type { ReactNode } from "react";
import { Drawer } from "vaul";

interface DrawerBaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  title?: string;
}

export default function DrawerBase({ open, onOpenChange, children, title }: DrawerBaseProps) {
  // Portal into .app div so CSS theme variables (--bg-primary etc.) are inherited
  const container =
    typeof document !== "undefined"
      ? (document.querySelector<HTMLElement>(".app") ?? undefined)
      : undefined;

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} container={container}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content">
          <Drawer.Handle className="drawer-handle" />
          {title && <Drawer.Title className="drawer-title">{title}</Drawer.Title>}
          <div className="drawer-body">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
