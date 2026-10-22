import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPEECH_EXAMPLE,
  findDestinationMatches,
  findHourMentions,
  normalizeSpeechText,
  parseSpanishCommand,
} from '../public/voice.js';

test('normaliza la transcripción sin acentos ni signos, conservando los dos puntos', () => {
  assert.equal(normalizeSpeechText('Prepara el anuncio, ¡LOS ESPARTANOS!'), 'prepara el anuncio los espartanos');
  assert.equal(normalizeSpeechText('a las 08:30'), 'a las 08:30');
  assert.equal(normalizeSpeechText('  '), '');
});

test('reconoce los cuatro equipos y rechaza equipos inventados', () => {
  for (const [phrase, id, name] of [
    ['los champions a las ocho para telares', 'champions', 'Los Champions'],
    ['los espartanos a las ocho para telares', 'espartanos', 'Los Espartanos'],
    ['super guerreros a las ocho para telares', 'super-guerreros', 'Los Super Guerreros'],
    ['los indestructibles a las ocho para telares', 'indestructibles', 'Los Indestructibles'],
  ]) {
    const proposal = parseSpanishCommand(phrase);
    assert.equal(proposal.profileId, id);
    assert.equal(proposal.profileName, name);
  }
  const unknown = parseSpanishCommand('los navajeros a las ocho para telares');
  assert.equal(unknown.profileId, null);
  assert.deepEqual(unknown.missing, ['equipo']);
});

test('interpreta horas 08/09, HH:mm, palabras y cuartos', () => {
  assert.deepEqual(findHourMentions('a las 08:00').map((item) => item.hour), ['08:00']);
  assert.deepEqual(findHourMentions('a las 9').map((item) => item.hour), ['09:00']);
  assert.deepEqual(findHourMentions('a las nueve').map((item) => item.hour), ['09:00']);
  assert.deepEqual(findHourMentions('a las ocho y media').map((item) => item.hour), ['08:30']);
  assert.deepEqual(findHourMentions('a las nueve menos cuarto').map((item) => item.hour), ['08:45']);
  assert.deepEqual(findHourMentions('a las ocho de la noche').map((item) => item.hour), ['20:00']);
  assert.deepEqual(
    findHourMentions('a las ocho y a las nueve').map((item) => item.hour),
    ['08:00', '09:00'],
  );
  assert.deepEqual(findHourMentions('sin hora'), []);
});

test('no trunca los minutos naturales: ocho treinta no es 08:00', () => {
  assert.deepEqual(findHourMentions('a las ocho treinta').map((item) => item.hour), ['08:30']);
  assert.deepEqual(findHourMentions('a las ocho y treinta').map((item) => item.hour), ['08:30']);
  assert.deepEqual(
    findHourMentions('a las ocho treinta y cinco').map((item) => item.hour),
    ['08:35'],
  );
  const proposal = parseSpanishCommand('los espartanos a las ocho treinta para telares');
  assert.equal(proposal.ok, true);
  assert.equal(proposal.hour, '08:30');
});

test('una cancelación o negación no prepara ninguna propuesta', () => {
  for (const phrase of [
    'Cancela el envío de los espartanos a las ocho para Telares',
    'No envíes a los espartanos a las ocho para Telares',
    'No prepares el anuncio de los espartanos a las ocho para Telares',
  ]) {
    const proposal = parseSpanishCommand(phrase);
    assert.equal(proposal.ok, false, phrase);
    assert.equal(proposal.cancelled, true, phrase);
    assert.equal(proposal.profileId, null, phrase);
    assert.equal(proposal.hour, null, phrase);
    assert.deepEqual(proposal.targetLabels, [], phrase);
    assert.deepEqual(proposal.missing, [], phrase);
    assert.deepEqual(proposal.ambiguities, [], phrase);
  }
});

test('encuentra destinos configurados sin confundir subcadenas', () => {
  assert.deepEqual(findDestinationMatches('para telares y extrusión'), ['Telares', 'Extrusión']);
  assert.deepEqual(findDestinationMatches('para telares', ['Telares', 'Extrusión']), ['Telares']);
  assert.deepEqual(findDestinationMatches('para telares', ['Telar']), []);
  assert.deepEqual(findDestinationMatches('para telares', ['Telares', 'telares']), ['Telares']);
});

test('la frase de ejemplo produce una propuesta revisable y completa', () => {
  const proposal = parseSpanishCommand(SPEECH_EXAMPLE);
  assert.equal(proposal.ok, true);
  assert.equal(proposal.profileId, 'espartanos');
  assert.equal(proposal.profileName, 'Los Espartanos');
  assert.equal(proposal.hour, '08:00');
  assert.deepEqual(proposal.targetLabels, ['Telares']);
  assert.equal(proposal.transcript, SPEECH_EXAMPLE);
  assert.match(proposal.summary, /Los Espartanos · 08:00 · Telares/);
});

test('no inventa propuesta si falta equipo, hora o destino', () => {
  const noTeam = parseSpanishCommand('a las ocho para telares');
  assert.equal(noTeam.ok, false);
  assert.deepEqual(noTeam.missing, ['equipo']);

  const noHour = parseSpanishCommand('los champions para telares');
  assert.equal(noHour.ok, false);
  assert.deepEqual(noHour.missing, ['hora']);

  const noTarget = parseSpanishCommand('los champions a las ocho');
  assert.equal(noTarget.ok, false);
  assert.deepEqual(noTarget.missing, ['destino']);
  assert.deepEqual(noTarget.targetLabels, []);

  const empty = parseSpanishCommand('   ');
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.missing, ['texto']);
});

test('marca ambigüedad si hay más de un equipo u hora', () => {
  const teams = parseSpanishCommand('champions y espartanos a las ocho para telares');
  assert.equal(teams.ok, false);
  assert.deepEqual(teams.ambiguities, ['equipo']);

  const hours = parseSpanishCommand('los champions a las ocho y a las nueve para telares');
  assert.equal(hours.ok, false);
  assert.deepEqual(hours.ambiguities, ['hora']);
});

test('usa los destinos configurados y no acepta destinos ajenos', () => {
  const configured = parseSpanishCommand('los champions a las ocho para telares', {
    targets: ['Telares'],
  });
  assert.equal(configured.ok, true);

  const missing = parseSpanishCommand('los champions a las ocho para telares', {
    targets: ['Extrusión'],
  });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['destino']);
});
