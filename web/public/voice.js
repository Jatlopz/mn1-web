/*
 * MN1 · parser determinista de comandos en español para el dictado.
 *
 * No ejecuta envíos, no usa IA y no adivina: si falta o sobra información devuelve
 * `ok:false` con `missing`/`ambiguities` para que la UI pida completar. Las cancelaciones
 * y negaciones devuelven `ok:false` con `cancelled:true` y nunca preparan una propuesta.
 * La interpretación vive en WEB; Android sólo devuelve la transcripción.
 */

import {
  DEFAULT_TARGETS,
  PROFILE_CATALOG,
} from './profiles.js';

export const SPEECH_EXAMPLE =
  'Prepara el anuncio de los espartanos a las ocho para Telares';

export const PROFILE_ALIASES = Object.freeze({
  champions: Object.freeze(['champions', 'los champions']),
  espartanos: Object.freeze(['espartanos', 'los espartanos']),
  'super-guerreros': Object.freeze(['super guerreros', 'los super guerreros', 'superguerreros']),
  indestructibles: Object.freeze(['indestructibles', 'los indestructibles']),
});

const HOUR_WORDS = Object.freeze({
  cero: 0,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintiun: 21,
  veintidos: 22,
  veintitres: 23,
});

const MINUTE_WORD_VALUES = Object.freeze({
  cero: 0,
  cinco: 5,
  diez: 10,
  cuarto: 15,
  quince: 15,
  veinte: 20,
  veinticinco: 25,
  media: 30,
  treinta: 30,
  'treinta y cinco': 35,
  cuarenta: 40,
  'cuarenta y cinco': 45,
  cincuenta: 50,
  'cincuenta y cinco': 55,
});

const HOUR_WORD_ALTERNATION = Object.keys(HOUR_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|');

const MINUTE_WORD_ALTERNATION = Object.keys(MINUTE_WORD_VALUES)
  .sort((a, b) => b.length - a.length)
  .join('|');

const CANCELLATION_PATTERNS = Object.freeze([
  /\bcancel(?:a|ar|acion|en|ad|alo|ala|elos|elas)\b/,
  /\b(?:anula|anular|anulalo|aborta|abortar|abortalo)\b/,
  /\bno\s+(?:(?:lo|la|los|las|me|se)\s+)?(?:envies|envie|envien|envia|envian|enviar|mandes|mande|manden|manda|mandan|mandar|prepares|prepare|preparen|prepara|preparan|preparar|compartas|comparta|compartan|comparte|comparten|compartir|publiques|publique|publiquen|publica|publican|publicar|hagas|haga|hagan|hacer)\b/,
]);

function isCancellation(text) {
  return CANCELLATION_PATTERNS.some((pattern) => pattern.test(text));
}

export function normalizeSpeechText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAlias(paddedText, alias) {
  return paddedText.includes(` ${alias} `);
}

function findProfiles(text) {
  const padded = ` ${text} `;
  const found = [];
  for (const profile of PROFILE_CATALOG) {
    const aliases = PROFILE_ALIASES[profile.id] ?? [];
    if (aliases.some((alias) => containsAlias(padded, alias))) found.push(profile);
  }
  return found;
}

function pushHour(list, hour, minutes, index) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) return;
  list.push({
    hour: `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    index,
  });
}

function parseWordHour(token) {
  if (/^[0-9]{1,2}$/.test(token)) {
    const value = Number(token);
    return Number.isInteger(value) && value >= 0 && value <= 23 ? value : null;
  }
  return Object.prototype.hasOwnProperty.call(HOUR_WORDS, token) ? HOUR_WORDS[token] : null;
}

export function findHourMentions(text) {
  const mentions = [];
  const numeric = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
  for (const match of text.matchAll(numeric)) {
    pushHour(mentions, Number(match[1]), Number(match[2]), match.index ?? 0);
  }

  const words = new RegExp(
    `\\ba\\s+las?\\s+(${HOUR_WORD_ALTERNATION}|[01]?\\d|2[0-3])(?!\\s*:)\\b`
      + `(?:\\s+(?:(y|menos)\\s+)?(${MINUTE_WORD_ALTERNATION}))?`
      + '(?:\\s+(de\\s+la\\s+manana|de\\s+la\\s+tarde|de\\s+la\\s+noche|en\\s+punto|horas?|hrs?))?',
    'g',
  );
  for (const match of text.matchAll(words)) {
    let hour = parseWordHour(match[1]);
    if (hour === null) continue;
    let minutes = 0;
    if (match[2] && match[3]) {
      const amount = MINUTE_WORD_VALUES[match[3]] ?? 0;
      if (match[2] === 'y') {
        minutes = amount;
      } else {
        hour -= 1;
        minutes = 60 - amount;
      }
    } else if (match[3]) {
      minutes = MINUTE_WORD_VALUES[match[3]] ?? 0;
    }
    const suffix = match[4] ?? '';
    if ((suffix.includes('tarde') || suffix.includes('noche')) && hour < 12) hour += 12;
    pushHour(mentions, hour, minutes, match.index ?? 0);
  }

  return mentions.sort((a, b) => a.index - b.index);
}

export function findDestinationMatches(text, targets = DEFAULT_TARGETS) {
  const padded = ` ${normalizeSpeechText(text)} `;
  const matches = [];
  for (const target of targets) {
    if (typeof target !== 'string') continue;
    const normalized = normalizeSpeechText(target);
    if (normalized.length === 0) continue;
    const index = padded.indexOf(` ${normalized} `);
    if (index >= 0) matches.push({ label: target.trim(), index, normalized });
  }
  matches.sort((a, b) => a.index - b.index);
  const seen = new Set();
  return matches
    .filter((match) => {
      if (seen.has(match.normalized)) return false;
      seen.add(match.normalized);
      return true;
    })
    .map((match) => match.label);
}

function unique(list) {
  return [...new Set(list)];
}

/**
 * Interpreta una transcripción. Devuelve una propuesta revisable; nunca la aplica.
 * `ok` sólo es true cuando hay exactamente un equipo, una hora y al menos un destino
 * configurado, sin ambigüedades.
 */
export function parseSpanishCommand(transcript, options = {}) {
  const raw = typeof transcript === 'string' ? transcript.trim() : '';
  const text = normalizeSpeechText(raw);
  const targets = Array.isArray(options.targets) && options.targets.length > 0
    ? options.targets
    : [...DEFAULT_TARGETS];
  const missing = [];
  const ambiguities = [];

  if (text.length === 0) {
    return {
      ok: false,
      cancelled: false,
      transcript: raw,
      profileId: null,
      profileName: '',
      hour: null,
      targetLabels: [],
      missing: ['texto'],
      ambiguities: [],
      summary: 'No se reconoció ninguna frase.',
    };
  }

  if (isCancellation(text)) {
    return {
      ok: false,
      cancelled: true,
      transcript: raw,
      profileId: null,
      profileName: '',
      hour: null,
      targetLabels: [],
      missing: [],
      ambiguities: [],
      summary: '',
    };
  }

  const profiles = findProfiles(text);
  let profile = null;
  if (profiles.length === 0) {
    missing.push('equipo');
  } else if (profiles.length > 1) {
    ambiguities.push('equipo');
  } else {
    profile = profiles[0];
  }

  const hourMentions = findHourMentions(text);
  const distinctHours = unique(hourMentions.map((mention) => mention.hour));
  let hour = null;
  if (distinctHours.length === 0) {
    missing.push('hora');
  } else if (distinctHours.length > 1) {
    ambiguities.push('hora');
  } else {
    [hour] = distinctHours;
  }

  const destinations = findDestinationMatches(text, targets);
  let targetLabels = destinations;
  if (destinations.length === 0) {
    missing.push('destino');
    targetLabels = [];
  } else if (destinations.length > 10) {
    ambiguities.push('destino');
    targetLabels = [];
  }

  const ok = missing.length === 0 && ambiguities.length === 0;
  const summary = ok
    ? `${profile.name} · ${hour} · ${targetLabels.join(', ')}`
    : '';

  return {
    ok,
    cancelled: false,
    transcript: raw,
    profileId: profile?.id ?? null,
    profileName: profile?.name ?? '',
    hour,
    targetLabels,
    missing,
    ambiguities,
    summary,
  };
}
