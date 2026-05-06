import { DEFAULT_CATEGORIES } from '../types';

export function normalizeTaxonomyValue(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function isDefaultCategory(value: string) {
  return DEFAULT_CATEGORIES.some(
    (category) => category.localeCompare(value, 'pt-BR', { sensitivity: 'accent' }) === 0,
  );
}
