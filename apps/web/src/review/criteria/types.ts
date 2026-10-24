export interface CriterionOption {
  id: string;
  label: string;
  description: string;
  selected: boolean;
  hits: number;
  unchecked: number;
  custom?: boolean;
  earlier?: boolean;
  noRoom?: boolean;
  selectionBlocked?: boolean;
}
export interface CriteriaModel {
  options: readonly CriterionOption[];
  level: 0 | 1 | 2;
  ownLabel: string;
  ownDescription: string;
  ownError?: string;
  limitOffer?: string;
  suggested: number;
  held: number;
  busy?: boolean;
  ownRoom?: boolean;
  editingId?: string;
  selectionLimit?: string;
}
export interface KeepRuleModel {
  id: string;
  kind: 'top-tenth' | 'likes' | 'reposts' | 'date';
  enabled: boolean;
  value: string;
  held: number;
  unknown?: boolean;
  error?: string;
}
