export interface Button {
  label: string;
  onClick: () => void;
}

export interface ButtonGroup {
  buttons: Button[];
}
