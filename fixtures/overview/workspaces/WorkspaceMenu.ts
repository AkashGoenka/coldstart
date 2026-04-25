export interface WorkspaceMenu {
  title: string;
  items: WorkspaceMenuItem[];
}

export interface WorkspaceMenuItem {
  label: string;
  href: string;
}
