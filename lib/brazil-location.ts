export interface BrazilStateOption {
  code: string;
  name: string;
}

export const BRAZIL_STATES: BrazilStateOption[] = [
  { code: 'AC', name: 'Acre' },
  { code: 'AL', name: 'Alagoas' },
  { code: 'AP', name: 'Amapa' },
  { code: 'AM', name: 'Amazonas' },
  { code: 'BA', name: 'Bahia' },
  { code: 'CE', name: 'Ceara' },
  { code: 'DF', name: 'Distrito Federal' },
  { code: 'ES', name: 'Espirito Santo' },
  { code: 'GO', name: 'Goias' },
  { code: 'MA', name: 'Maranhão' },
  { code: 'MT', name: 'Mato Grosso' },
  { code: 'MS', name: 'Mato Grosso do Sul' },
  { code: 'MG', name: 'Minas Gerais' },
  { code: 'PA', name: 'Para' },
  { code: 'PB', name: 'Paraiba' },
  { code: 'PR', name: 'Parana' },
  { code: 'PE', name: 'Pernambuco' },
  { code: 'PI', name: 'Piaui' },
  { code: 'RJ', name: 'Rio de Janeiro' },
  { code: 'RN', name: 'Rio Grande do Norte' },
  { code: 'RS', name: 'Rio Grande do Sul' },
  { code: 'RO', name: 'Rondonia' },
  { code: 'RR', name: 'Roraima' },
  { code: 'SC', name: 'Santa Catarina' },
  { code: 'SP', name: 'São Paulo' },
  { code: 'SE', name: 'Sergipe' },
  { code: 'TO', name: 'Tocantins' },
];

export function normalizeBrazilText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeStateCode(value?: string | null) {
  return value?.trim().toUpperCase() || null;
}

export function getBrazilStateName(stateCode?: string | null) {
  const normalized = normalizeStateCode(stateCode);
  if (!normalized) return null;

  return BRAZIL_STATES.find((state) => state.code === normalized)?.name ?? null;
}

export function resolveStateCodeFromName(stateName?: string | null) {
  if (!stateName) return null;
  const normalized = normalizeBrazilText(stateName);

  const matched = BRAZIL_STATES.find((state) => normalizeBrazilText(state.name) === normalized);
  return matched?.code ?? null;
}
