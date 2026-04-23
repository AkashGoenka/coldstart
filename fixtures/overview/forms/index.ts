export interface FormField {
  name: string;
  value: string;
}

export interface FormGroup {
  fields: FormField[];
}

export type FormAction = 'submit' | 'reset' | 'validate';
