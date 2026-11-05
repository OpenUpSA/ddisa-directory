import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function findExpression(source, start) {
  const objectStart = source.indexOf('{', start);
  const arrayStart = source.indexOf('[', start);
  const opening = [objectStart, arrayStart]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (!Number.isInteger(opening)) throw new Error('Could not locate a JavaScript data expression.');
  let depth = 0;
  let quote = null;
  let escaped = false;
  let templateDepth = 0;

  for (let index = opening; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (quote === '`' && character === '$' && source[index + 1] === '{') {
        templateDepth += 1;
        index += 1;
      } else if (quote === '`' && character === '}' && templateDepth > 0) {
        templateDepth -= 1;
      } else if (templateDepth === 0 && character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === '{' || character === '[') {
      depth += 1;
    } else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth === 0) {
        return { opening, closing: index, text: source.slice(opening, index + 1) };
      }
    }
  }

  throw new Error('Unterminated JavaScript data expression.');
}

export function extractExpression(source, start) {
  return findExpression(source, start).text;
}

export function extractDirectoryData(root) {
  const htmlPath = resolve(root, 'DDISA - Grantee Directory.html');
  const source = readFileSync(htmlPath, 'utf8');
  const dataStart = source.indexOf('const data=');
  const updatesStart = source.indexOf('const researchedProfileUpdates=');
  const focusStart = source.indexOf('const focusGroups=');
  const offeringsStart = source.indexOf('const offeringsByName=');

  if (dataStart < 0 || updatesStart < 0 || focusStart < 0 || offeringsStart < 0) {
    throw new Error('The directory data declarations could not be found.');
  }

  const dataExpression = extractExpression(source, dataStart);
  const updatesExpression = extractExpression(source, updatesStart);
  const focusExpression = extractExpression(source, focusStart);
  const offeringsExpression = extractExpression(source, offeringsStart);
  const load = new Function(
    `return {data:${dataExpression},updates:${updatesExpression},focusGroups:${focusExpression},offeringsByName:${offeringsExpression}};`,
  );
  const directory = load();
  directory.data.forEach((record) => Object.assign(record, directory.updates[record.name] || {}));
  delete directory.updates;

  return directory;
}
