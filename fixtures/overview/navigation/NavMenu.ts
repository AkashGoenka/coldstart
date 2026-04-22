import { ProfileMenu, ProfileMenuItem } from '../profiles';

export function buildNav(menus: ProfileMenu[]): ProfileMenuItem[] {
  return menus.flatMap(m => m.items);
}
