import React from 'react';
import {
  CalendarDays,
  Compass,
  Loader2,
  MapPin,
  PartyPopper,
  RefreshCcw,
  Sparkles,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { HolidayCalendarPayload, HolidayEntry } from '../types';

interface HolidaysPanelProps {
  calendar: HolidayCalendarPayload | null;
  isLoading: boolean;
  isDetectingLocation: boolean;
  onRefresh: () => void;
  onDetectLocation: () => void;
  onOpenLocationSettings: () => void;
}

function formatHolidayDate(value: string) {
  try {
    return format(parseISO(value), "dd 'de' MMMM", { locale: ptBR });
  } catch {
    return value;
  }
}

function scopeLabel(entry: HolidayEntry) {
  if (entry.scope === 'city') return 'Municipal';
  if (entry.scope === 'state') return 'Estadual';
  return 'Nacional';
}

function typeLabel(entry: HolidayEntry) {
  if (entry.type === 'public') return 'Feriado';
  if (entry.type === 'optional') return 'Data opcional';
  if (entry.type === 'observance') return 'Comemorativa';
  if (entry.type === 'bank') return 'Bancário';
  return 'Especial';
}

function HolidayList({
  title,
  description,
  entries,
  emptyLabel,
}: {
  title: string;
  description: string;
  entries: HolidayEntry[];
  emptyLabel: string;
}) {
  return (
    <section className="surface-panel p-5 md:p-6">
      <div className="mb-4">
        <h4 className="text-lg font-semibold text-slate-950 dark:text-white">{title}</h4>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      </div>

      {entries.length > 0 ? (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 px-4 py-4 dark:border-white/10 dark:bg-white/[0.04]"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950 dark:text-white">{entry.name}</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    {formatHolidayDate(entry.date)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300">
                    {scopeLabel(entry)}
                  </span>
                  <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                    {typeLabel(entry)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
          {emptyLabel}
        </div>
      )}
    </section>
  );
}

export function HolidaysPanel({
  calendar,
  isLoading,
  isDetectingLocation,
  onRefresh,
  onDetectLocation,
  onOpenLocationSettings,
}: HolidaysPanelProps) {
  const locationLabel = calendar?.location.stateName
    ? calendar.location.cityName
      ? `${calendar.location.cityName}, ${calendar.location.stateName}`
      : calendar.location.stateName
    : 'Brasil';

  return (
    <div className="space-y-6">
      <section className="surface-panel p-5 md:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <span className="section-eyebrow">
              <CalendarDays size={14} />
              Feriados e datas
            </span>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              Planeje seus lembretes olhando também para o calendário real.
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500 dark:text-slate-400">
              Mostramos os feriados nacionais para todos e, quando sua região está configurada, adicionamos os feriados estaduais e municipais que ajudam a antecipar a rotina.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={onDetectLocation}
              disabled={isDetectingLocation}
              className="action-secondary min-h-[48px] justify-center whitespace-nowrap px-5 disabled:cursor-wait disabled:opacity-70"
            >
              {isDetectingLocation ? <Loader2 size={16} className="animate-spin" /> : <Compass size={16} />}
              Usar minha localização
            </button>
            <button
              type="button"
              onClick={onOpenLocationSettings}
              className="action-secondary min-h-[48px] justify-center whitespace-nowrap px-5"
            >
              <MapPin size={16} />
              Ajustar região
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="action-secondary min-h-[48px] justify-center whitespace-nowrap px-5 disabled:cursor-wait disabled:opacity-70"
            >
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
              Atualizar
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,0.7fr))]">
          <div className="surface-soft p-5">
            <div className="flex items-start gap-3">
              <span className="icon-slot h-11 w-11 rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
                <MapPin size={18} />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                  Região ativa
                </p>
                <h4 className="mt-2 text-lg font-semibold text-slate-950 dark:text-white">{locationLabel}</h4>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  {calendar?.location.municipalSupported
                    ? `A base atual reconheceu ${calendar.location.matchedRegionName ?? calendar.location.cityName} para feriados municipais.`
                    : calendar?.location.stateCode
                      ? 'Os feriados nacionais e estaduais já estão ativos. Os municipais dependem da cobertura disponível para a cidade.'
                      : 'Configure seu estado e cidade para incluir os feriados regionais.'}
                </p>
              </div>
            </div>
          </div>

          <div className="surface-soft p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              Hoje
            </p>
            <p className="mt-3 text-4xl font-semibold text-slate-950 dark:text-white">
              {calendar?.today.length ?? 0}
            </p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Eventos do dia que ja podem impactar a agenda.
            </p>
          </div>

          <div className="surface-soft p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              Neste mês
            </p>
            <p className="mt-3 text-4xl font-semibold text-slate-950 dark:text-white">
              {calendar?.monthHighlights.length ?? 0}
            </p>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Feriados e datas relevantes no calendário atual.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
        <HolidayList
          title="Próximos feriados"
          description="Uma visão clara do que pode alterar expediente, deslocamento ou disponibilidade."
          entries={calendar?.upcoming.filter((entry) => entry.type === 'public' || entry.type === 'bank') ?? []}
          emptyLabel="Nenhum feriado oficial encontrado para o periodo consultado."
        />

        <HolidayList
          title="Datas comemorativas"
          description="Datas observadas e comemorativas que tambem podem orientar seu planejamento."
          entries={calendar?.commemorative ?? []}
          emptyLabel="Não encontramos datas comemorativas relevantes para este recorte."
        />
      </div>

      <HolidayList
        title="Destaques do mês"
        description="Tudo o que aparece neste mês para você encaixar lembretes, reuniões e descansos com mais contexto."
        entries={calendar?.monthHighlights ?? []}
        emptyLabel="Este mês não tem eventos registrados na base atual."
      />

      {!calendar?.location.stateCode && (
        <section className="surface-panel p-5 md:p-6">
          <div className="flex items-start gap-3">
            <span className="icon-slot h-11 w-11 rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              <PartyPopper size={18} />
            </span>
            <div>
              <h4 className="text-lg font-semibold text-slate-950 dark:text-white">Quer feriados regionais?</h4>
              <p className="mt-2 text-sm leading-7 text-slate-500 dark:text-slate-400">
                Neste momento estamos mostrando apenas os feriados nacionais. Para incluir os estaduais e municipais, use sua localização ou ajuste sua região em Configurações.
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
