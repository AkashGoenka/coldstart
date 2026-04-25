import { WorkspaceMenu, WorkspaceMenuItem } from '../workspaces';

export function buildNav(menus: WorkspaceMenu[]): WorkspaceMenuItem[] {
  return menus.flatMap(m => m.items);
}
