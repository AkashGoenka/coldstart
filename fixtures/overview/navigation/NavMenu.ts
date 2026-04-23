import { GroupHubMenu, GroupHubMenuItem } from '../grouphubs';

export function buildNav(menus: GroupHubMenu[]): GroupHubMenuItem[] {
  return menus.flatMap(m => m.items);
}
