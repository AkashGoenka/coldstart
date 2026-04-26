// Fixture: React-style component with nested handlers.
// Used to test that nested functions one level inside a component body
// are extracted as symbols (e.g. SettingsMenu.handleError).

export interface ActionItem {
  label: string;
  onClick: () => void;
}

// Arrow function component with nested handlers
export const SettingsMenu = ({ items }: { items: ActionItem[] }) => {
  const handleError = (err: Error) => {
    console.error(err);
  };

  function handleClose() {
    handleError(new Error('closed'));
  }

  return null;
};

// Classic function declaration component with nested handlers
export function ProfileMenu() {
  const handleDelete = () => {
    doDelete();
  };

  function handleConfirm() {
    confirm();
  }

  return null;
}

function doDelete() {}
function confirm() {}
